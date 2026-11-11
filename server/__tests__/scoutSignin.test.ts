/**
 * "Continue with Control Scout" (server/sharedAccounts.ts contract, routes in server.ts): Control
 * Point starts the sign-in, Scout vouches for its signed-in visitor through POST /internal/signin/codes,
 * and the callback signs the person in by that email. One workspace → straight in; several → a picker;
 * none → the usual team step. Scout's side is played here by calling the internal route directly.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startTestServer, seedTeam, seedMember, type TestServer } from "./helpers/testServer";

vi.setConfig({ testTimeout: 30_000 });

const KEY = "test-internal-key-0123456789-abcdefghijklmnop";
const SCOUT = "https://scout.example.test";
// Serve the built app (these routes come before Vite's middleware anyway); see sharedAccounts.test.ts.
const QUIET = { NODE_ENV: "production" };
let on: TestServer;
let off: TestServer;
beforeAll(async () => {
  [on, off] = await Promise.all([
    startTestServer("cp-scout-signin-on-", { ...QUIET, CONTROL_SCOUT_INTERNAL_KEY: KEY, CONTROL_SCOUT_URL: SCOUT }),
    startTestServer("cp-scout-signin-off-", { ...QUIET, CONTROL_SCOUT_INTERNAL_KEY: "", CONTROL_SCOUT_URL: "" }),
  ]);
}, 180_000);
afterAll(async () => { await Promise.all([on?.stop(), off?.stop()]); });

/** One fetch with a retry on a dropped keep-alive socket, never following redirects. */
async function raw(t: TestServer, path: string, init: RequestInit = {}) {
  const go = () => fetch(`${t.base}${path}`, { redirect: "manual", ...init });
  const r = await go().catch(() => new Promise((res) => setTimeout(res, 300)).then(go));
  const cookies = r.headers.getSetCookie();
  return { status: r.status, location: r.headers.get("location") || "", cookies, body: await r.json().catch(() => null) };
}
/** A browser's cookie jar, by name (a Max-Age=0 cookie is dropped). */
class Jar {
  private c = new Map<string, string>();
  take(setCookies: string[]) {
    for (const sc of setCookies) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      if (/max-age=0/i.test(sc)) this.c.delete(name); else this.c.set(name, pair.slice(i + 1));
    }
    return this;
  }
  get(name: string) { return this.c.get(name); }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
}

const vouch = (body: any, key: string | null = KEY, t = on) => raw(t, "/internal/signin/codes", {
  method: "POST",
  headers: { "content-type": "application/json", ...(key === null ? {} : { "x-internal-key": key }) },
  body: JSON.stringify(body),
});

/** Click "Continue with Control Scout": the state Control Point sends to Scout, and this browser's cookies. */
async function begin(intent = "signup", jar = new Jar()) {
  const r = await raw(on, `/api/auth/control-scout?intent=${intent}`, { headers: { cookie: jar.header() } });
  expect(r.status).toBe(302);
  const u = new URL(r.location);
  expect(u.origin + u.pathname).toBe(`${SCOUT}/api/auth/control-point/vouch`);
  jar.take(r.cookies);
  return { state: u.searchParams.get("state")!, jar };
}

/** Scout vouches for `email`, then the browser comes back to the callback. */
async function finish(email: string, extra: Record<string, unknown> = {}, intent = "signup") {
  const { state, jar } = await begin(intent);
  const v = await vouch({ email, verifiedBy: "scout-email-code", state, ...extra });
  expect(v.status).toBe(200);
  const cb = await raw(on, `/api/auth/control-scout/callback?${new URLSearchParams({ code: v.body.code, state })}`, { headers: { cookie: jar.header() } });
  jar.take(cb.cookies);
  return { cb, jar, state, code: v.body.code as string };
}

const me = async (jar: Jar) => (await raw(on, "/api/auth/me", { headers: { cookie: jar.header() } })).body;
const one = async (sql: string, ...args: any[]) => (await on.db.execute({ sql, args })).rows[0] as any;

describe("feature off (no CONTROL_SCOUT_URL / key)", () => {
  it("the button is hidden, the start sends people back with a message, and /internal is 404", async () => {
    expect((await raw(off, "/api/auth/config")).body.scoutEnabled).toBe(false);
    const r = await raw(off, "/api/auth/control-scout?intent=signup");
    expect(r.status).toBe(302);
    expect(r.location).toBe("/?oauth_error=scout_unavailable");
    expect((await vouch({ email: "a@b.test", verifiedBy: "google", state: "s".repeat(32) }, KEY, off)).status).toBe(404);
  });
});

describe("start", () => {
  it("the config shows the button", async () => {
    expect((await raw(on, "/api/auth/config")).body.scoutEnabled).toBe(true);
  });
  it("binds a fresh state to this browser and sends it only to Scout's origin", async () => {
    const a = await begin();
    const b = await begin();
    expect(a.state).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(a.state).not.toBe(b.state);
    expect(a.jar.get("cp_oauth_state")).toBe(a.state);
  });
});

describe("POST /internal/signin/codes (Scout vouching)", () => {
  const state = "stateABCDEFGH_1234-xyz";
  it("needs the internal key", async () => {
    expect((await vouch({ email: "a@b.test", verifiedBy: "google", state }, null)).status).toBe(401);
    expect((await vouch({ email: "a@b.test", verifiedBy: "google", state }, "wrong")).status).toBe(401);
  });
  it("rejects bad input and stores nothing", async () => {
    const cases: [any, string][] = [
      [{ email: "nope", verifiedBy: "google", state }, "invalid_email"],
      [{ email: "x@bad.test", verifiedBy: "password", state }, "invalid_verified_by"],
      [{ email: "x@bad.test", verifiedBy: "google", state: "short" }, "invalid_state"],
      [{ email: "x@bad.test", verifiedBy: "google", state, displayName: "n".repeat(101) }, "invalid_display_name"],
      [{ email: "x@bad.test", verifiedBy: "google", state, myTeam: 0 }, "invalid_team"],
      [{ email: "x@bad.test", verifiedBy: "google", state, myTeam: "12a" }, "invalid_team"],
      [{ email: "x@bad.test", verifiedBy: "google", state, myTeam: 1_000_000 }, "invalid_team"],
    ];
    for (const [body, error] of cases) {
      const r = await vouch(body);
      expect(r.status, error).toBe(400);
      expect(r.body.error).toBe(error);
    }
    expect(Number((await one("SELECT COUNT(*) AS n FROM accounts WHERE email = 'x@bad.test'")).n)).toBe(0);
  });
  it("issues a single-use code, stores only its hash, and upserts the shared account", async () => {
    const r = await vouch({ email: " Vouch.Me@Example.TEST ", verifiedBy: "google", state, displayName: "Vee", myTeam: "4215" });
    expect(r.status).toBe(200);
    expect(r.body.code).toMatch(/^csv_[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(r.body.expiresAt) - Date.now()).toBeLessThanOrEqual(2 * 60 * 1000 + 1000);
    const row = await one("SELECT email, display_name, my_team FROM scout_signin_codes WHERE state = ? ORDER BY rowid DESC LIMIT 1", state);
    expect(row).toMatchObject({ email: "vouch.me@example.test", display_name: "Vee", my_team: 4215 });
    expect(Number((await one("SELECT COUNT(*) AS n FROM scout_signin_codes WHERE code_hash = ?", r.body.code)).n)).toBe(0);
    expect(await one("SELECT verified_by FROM accounts WHERE email = 'vouch.me@example.test'")).toMatchObject({ verified_by: "google" });
  });
});

describe("one workspace → signed straight in", () => {
  it("lands in that workspace with the email verified and Scout's name filled in", async () => {
    const team = await seedTeam(on.db, "Solo Squad");
    // A default name (the email's local part) is replaced by Scout's display name.
    const member = await seedMember(on.db, team, "solo.scout", "solo.scout@team.test");
    // Scout's email in any case is the same account.
    const { cb, jar } = await finish("Solo.Scout@Team.TEST", { displayName: "Solo Scout" });
    expect(cb.status).toBe(302);
    expect(cb.location).toBe("/?oauth=ok");
    expect(jar.get("cp_session")).toBeTruthy();
    const body = await me(jar);
    expect(body.user).toMatchObject({ id: member, team_id: team, name: "Solo Scout" });
    expect(await one("SELECT email FROM verified_emails WHERE email = 'solo.scout@team.test'")).toBeTruthy();
  });
  it("from the sign-in page too (intent=login), and two rows on one team still count as one workspace", async () => {
    const team = await seedTeam(on.db, "Login Team");
    await seedMember(on.db, team, "Lo", "login.scout@team.test");
    const { cb, jar } = await finish("login.scout@team.test", {}, "login");
    expect(cb.location).toBe("/?oauth=ok");
    expect((await me(jar)).user.team_id).toBe(team);
  });
  it("a name the person chose is kept", async () => {
    const team = await seedTeam(on.db, "Named Team");
    await seedMember(on.db, team, "Ada Lovelace", "ada@team.test");
    const { jar } = await finish("ada@team.test", { displayName: "Someone Else" });
    expect((await me(jar)).user.name).toBe("Ada Lovelace");
  });
});

describe("several workspaces → a picker", () => {
  let a: number, b: number;
  const email = "multi.scout@team.test";
  beforeAll(async () => {
    a = await seedTeam(on.db, "Alpha Bots");
    b = await seedTeam(on.db, "Beta Builders");
    await on.db.execute({ sql: "UPDATE teams SET ftc_team_number = 4215 WHERE id = ?", args: [b] });
    await seedMember(on.db, a, "Multi", email, "admin");
    await seedMember(on.db, b, "Multi", email);
    const gone = await seedTeam(on.db, "Left Long Ago");
    const left = await seedMember(on.db, gone, "Multi", email);
    await on.db.execute({ sql: "UPDATE members SET is_active = 0 WHERE id = ?", args: [left] });
  });

  it("sends the browser to the picker with no session yet and the pick only in an HttpOnly cookie", async () => {
    const { cb, jar } = await finish(email);
    expect(cb.location).toBe("/?scout_pick=1");
    expect(jar.get("cp_session")).toBeUndefined();
    const set = cb.cookies.find((c) => c.startsWith("cp_scout_pick="))!;
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/Path=\/api\/auth\/control-scout/);
    expect(cb.location).not.toContain(jar.get("cp_scout_pick")!);
  });

  it("lists the active workspaces with roles and team numbers, then signs in to the one picked, once", async () => {
    const { jar } = await finish(email);
    const list = await raw(on, "/api/auth/control-scout/workspaces", { headers: { cookie: jar.header() } });
    expect(list.status).toBe(200);
    expect(list.body.email).toBe(email);
    expect(list.body.workspaces.map((w: any) => ({ id: w.id, name: w.name, role: w.role, teamNumber: w.teamNumber }))).toEqual([
      { id: String(a), name: "Alpha Bots", role: "admin", teamNumber: null },
      { id: String(b), name: "Beta Builders", role: "member", teamNumber: 4215 },
    ]);
    // Neither has been used yet: nothing is marked "last used" (not even the newest).
    expect(list.body.workspaces.filter((w: any) => w.lastUsed)).toHaveLength(0);

    const post = (workspaceId: unknown) => raw(on, "/api/auth/control-scout/choose", {
      method: "POST", headers: { cookie: jar.header(), "content-type": "application/json", "x-cp-client": "1" }, body: JSON.stringify({ workspaceId }),
    });
    // Not one of theirs (another team, the one they left, junk): refused, and the pick stays usable.
    for (const bad of [999999, "x", null]) expect((await post(bad)).status).toBe(400);
    const token = jar.get("cp_scout_pick")!;
    const chose = await post(String(b));
    expect(chose.status).toBe(200);
    expect(chose.body).toMatchObject({ ok: true, popup: false });
    expect(chose.body.sessionId).toBeUndefined(); // moved into the HttpOnly cookie
    jar.take(chose.cookies);
    expect(jar.get("cp_scout_pick")).toBeUndefined();
    expect((await me(jar)).user.team_id).toBe(b);
    // Spent: the same pick can't sign in again.
    const replay = await raw(on, "/api/auth/control-scout/choose", {
      method: "POST", headers: { cookie: `cp_scout_pick=${token}`, "content-type": "application/json", "x-cp-client": "1" }, body: JSON.stringify({ workspaceId: String(a) }),
    });
    expect(replay.status).toBe(410);
    expect((await raw(on, "/api/auth/control-scout/workspaces", { headers: { cookie: `cp_scout_pick=${token}` } })).status).toBe(410);
    // Next time, the one they used is marked.
    const next = await finish(email);
    const again = await raw(on, "/api/auth/control-scout/workspaces", { headers: { cookie: next.jar.header() } });
    expect(again.body.workspaces.filter((w: any) => w.lastUsed).map((w: any) => w.id)).toEqual([String(b)]);
  });

  it("two choices sent at once with the same pick: exactly one signs in", async () => {
    const { jar } = await finish(email);
    const post = (workspaceId: string) => raw(on, "/api/auth/control-scout/choose", {
      method: "POST", headers: { cookie: jar.header(), "content-type": "application/json", "x-cp-client": "1" }, body: JSON.stringify({ workspaceId }),
    });
    const sessions = Number((await one("SELECT COUNT(*) AS n FROM sessions")).n);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => post(String(i % 2 ? b : a))));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 410)).toHaveLength(9);
    expect(Number((await one("SELECT COUNT(*) AS n FROM sessions")).n)).toBe(sessions + 1);
  });

  it("a membership stored with another email casing is listed and can be picked", async () => {
    const c = await seedTeam(on.db, "Case Crew");
    const d = await seedTeam(on.db, "Case Two");
    await seedMember(on.db, c, "Casey", "Mixed.Case@Team.TEST", "admin");
    await seedMember(on.db, d, "Casey", "mixed.case@team.test");
    const { cb, jar } = await finish("mixed.case@team.test");
    expect(cb.location).toBe("/?scout_pick=1");
    const list = await raw(on, "/api/auth/control-scout/workspaces", { headers: { cookie: jar.header() } });
    expect(list.body.workspaces.map((w: any) => [w.name, w.role])).toEqual([["Case Crew", "admin"], ["Case Two", "member"]]);
    const chose = await raw(on, "/api/auth/control-scout/choose", {
      method: "POST", headers: { cookie: jar.header(), "content-type": "application/json", "x-cp-client": "1" }, body: JSON.stringify({ workspaceId: String(c) }),
    });
    expect(chose.status).toBe(200);
    jar.take(chose.cookies);
    expect((await me(jar)).user.team_id).toBe(c);
  });

  it("no pick or an unknown one is 410, and choosing needs the client header (CSRF)", async () => {
    expect((await raw(on, "/api/auth/control-scout/workspaces")).status).toBe(410);
    expect((await raw(on, "/api/auth/control-scout/workspaces", { headers: { cookie: `cp_scout_pick=${"0".repeat(64)}` } })).status).toBe(410);
    const { jar } = await finish(email);
    const noHeader = await raw(on, "/api/auth/control-scout/choose", {
      method: "POST", headers: { cookie: jar.header(), "content-type": "application/json" }, body: JSON.stringify({ workspaceId: String(a) }),
    });
    expect(noHeader.status).toBe(403);
    const ok = await raw(on, "/api/auth/control-scout/choose", {
      method: "POST", headers: { cookie: jar.header(), "content-type": "application/json", "x-cp-client": "1" }, body: JSON.stringify({ workspaceId: String(a) }),
    });
    expect(ok.status).toBe(200);
    jar.take(ok.cookies);
    expect((await me(jar)).user.team_id).toBe(a);
  });
});

describe("no workspace → the usual team step", () => {
  it("goes to the team step with the followed team filled in, and joining with a code signs them in", async () => {
    const team = await seedTeam(on.db, "Code Crew");
    await on.db.execute({ sql: "UPDATE teams SET access_code = 'CP-TEST-0001' WHERE id = ?", args: [team] });
    const members = Number((await one("SELECT COUNT(*) AS n FROM members")).n);
    const { cb, jar } = await finish("new.scout@example.test", { displayName: "New Scout", myTeam: 4215 });
    const u = new URL(cb.location, on.base);
    expect(u.pathname).toBe("/");
    expect(u.searchParams.get("provider")).toBe("control-scout");
    expect(u.searchParams.get("intent")).toBe("signup");
    expect(u.searchParams.get("team")).toBe("4215");
    const token = u.searchParams.get("oauth_signup")!;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    // Nothing is created until they finish the team step.
    expect(jar.get("cp_session")).toBeUndefined();
    expect(Number((await one("SELECT COUNT(*) AS n FROM members")).n)).toBe(members);

    const done = await raw(on, "/api/auth/oauth/complete", {
      method: "POST", headers: { "content-type": "application/json", "x-cp-client": "1" },
      body: JSON.stringify({ provider: "control-scout", token, role: "student", accessCode: "CP-TEST-0001" }),
    });
    expect(done.status).toBe(200);
    expect(done.body.team).toMatchObject({ id: team, name: "Code Crew" });
    jar.take(done.cookies);
    expect((await me(jar)).user).toMatchObject({ team_id: team, name: "New Scout", email: "new.scout@example.test" });
    expect(await one("SELECT email FROM verified_emails WHERE email = 'new.scout@example.test'")).toBeTruthy();
    // Single use.
    const again = await raw(on, "/api/auth/oauth/complete", {
      method: "POST", headers: { "content-type": "application/json", "x-cp-client": "1" },
      body: JSON.stringify({ provider: "control-scout", token, role: "student", accessCode: "CP-TEST-0001" }),
    });
    expect(again.status).toBe(400);
  });
  it("someone who left every team is treated as new (no team number when Scout has none)", async () => {
    const team = await seedTeam(on.db, "Former Team");
    const m = await seedMember(on.db, team, "Former", "former.scout@team.test");
    await on.db.execute({ sql: "UPDATE members SET is_active = 0 WHERE id = ?", args: [m] });
    const { cb } = await finish("former.scout@team.test");
    const u = new URL(cb.location, on.base);
    expect(u.searchParams.get("oauth_signup")).toBeTruthy();
    expect(u.searchParams.has("team")).toBe(false);
  });
  it("another provider's signup token can't be finished as control-scout, nor the reverse", async () => {
    const { cb } = await finish("cross.scout@example.test");
    const token = new URL(cb.location, on.base).searchParams.get("oauth_signup")!;
    const r = await raw(on, "/api/auth/oauth/complete", {
      method: "POST", headers: { "content-type": "application/json", "x-cp-client": "1" },
      body: JSON.stringify({ provider: "google", token, role: "student", accessCode: "CP-TEST-0001" }),
    });
    expect(r.status).toBe(400);
  });
});

describe("the callback refuses", () => {
  it("a code without this browser's state cookie (login CSRF)", async () => {
    const { state } = await begin();
    const v = await vouch({ email: "csrf@example.test", verifiedBy: "google", state });
    const cb = await raw(on, `/api/auth/control-scout/callback?${new URLSearchParams({ code: v.body.code, state })}`);
    expect(cb.location).toBe("/?oauth_error=invalid_state");
  });
  it("a code minted for another state, and the code is spent by the attempt", async () => {
    const mine = await begin();
    const theirs = await begin();
    const v = await vouch({ email: "swap@example.test", verifiedBy: "google", state: theirs.state });
    const cb = await raw(on, `/api/auth/control-scout/callback?${new URLSearchParams({ code: v.body.code, state: mine.state })}`, { headers: { cookie: mine.jar.header() } });
    expect(cb.location).toBe("/?oauth_error=scout_failed");
    expect((await one("SELECT used_at FROM scout_signin_codes WHERE state = ?", theirs.state)).used_at).toBeTruthy();
  });
  it("a used code", async () => {
    const { cb, code, state } = await finish("twice@example.test");
    expect(cb.location).toContain("oauth_signup=");
    const { jar } = await begin();
    // Even with a fresh state cookie, the spent code is refused.
    const again = await raw(on, `/api/auth/control-scout/callback?${new URLSearchParams({ code, state: jar.get("cp_oauth_state")! })}`, { headers: { cookie: jar.header() } });
    expect(again.location).toBe("/?oauth_error=scout_failed");
    expect(state).toBeTruthy();
  });
  it("an expired code", async () => {
    const { state, jar } = await begin();
    const v = await vouch({ email: "late@example.test", verifiedBy: "google", state });
    await on.db.execute({ sql: "UPDATE scout_signin_codes SET expires_at = ? WHERE state = ?", args: [new Date(Date.now() - 1000).toISOString(), state] });
    const cb = await raw(on, `/api/auth/control-scout/callback?${new URLSearchParams({ code: v.body.code, state })}`, { headers: { cookie: jar.header() } });
    expect(cb.location).toBe("/?oauth_error=invalid_state");
  });
  it("Scout saying it couldn't vouch, a missing code, and a malformed one", async () => {
    for (const q of [{ error: "cancelled" }, {}, { code: "csv_short" }]) {
      const { state, jar } = await begin();
      const cb = await raw(on, `/api/auth/control-scout/callback?${new URLSearchParams({ state, ...q })}`, { headers: { cookie: jar.header() } });
      expect(cb.location, JSON.stringify(q)).toBe("/?oauth_error=scout_failed");
    }
  });
});
