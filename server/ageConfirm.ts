/**
 * "I'm 18 or older" (an honesty system: nothing is verified). Kept per
 * account email in age_confirmations, so every workspace of a multi-team
 * account agrees. Members who haven't said so see swear words hidden
 * (src/utils/profanity.ts); members who have can tap to show them.
 */
type Db = {
  dbGet: (sql: string, ...args: any[]) => Promise<any>;
  dbRun: (sql: string, ...args: any[]) => Promise<any>;
};

const key = (email: string) => String(email || "").trim().toLowerCase();

export async function isAdult(db: Pick<Db, "dbGet">, email: string): Promise<boolean> {
  if (!key(email)) return false;
  return !!(await db.dbGet("SELECT 1 AS ok FROM age_confirmations WHERE email = ?", key(email)));
}

export async function setAdult(db: Pick<Db, "dbRun">, email: string, adult: boolean): Promise<void> {
  if (!key(email)) return;
  if (adult) {
    await db.dbRun("INSERT OR IGNORE INTO age_confirmations (email, confirmed_at) VALUES (?, ?)", key(email), new Date().toISOString());
  } else {
    await db.dbRun("DELETE FROM age_confirmations WHERE email = ?", key(email));
  }
}

/** Goes with the account when it's deleted. */
export const deleteAgeSql = (email: string) => ({ sql: "DELETE FROM age_confirmations WHERE email = ?", args: [key(email)] });
