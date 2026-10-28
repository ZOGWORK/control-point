/**
 * "I'm 18 or older" (an honesty system): said at signup or in Settings, kept
 * per account email, and returned on /api/auth/me so the app knows whether
 * hidden swear words may be tapped open.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startTestServer, seedTeam, seedMember, type TestServer } from "./helpers/testServer";

vi.setConfig({ testTimeout: 60_000 });

let t: TestServer;
let session = "";
beforeAll(async () => {
  t = await startTestServer("cp-age-", { RESEND_API_KEY: "" });
  const team = await seedTeam(t.db, "Robo");
  session = await t.session(await seedMember(t.db, team, "Ada", "Ada@Age.Test", "student"));
}, 120_000);
afterAll(async () => { await t?.stop(); });

const me = async () => (await t.api("/api/auth/me", { session })).body.user;
const put = (body: any) => t.api("/api/auth/adult", { method: "PUT", body: JSON.stringify(body), session });
const rows = async (email: string) => (await t.db.execute({ sql: "SELECT email FROM age_confirmations WHERE email = ?", args: [email] })).rows.length;

describe("18 or older", () => {
  it("is off until the member says so, and Settings can turn it on and off", async () => {
    expect((await me()).adult).toBe(false);
    expect((await put({ adult: true })).status).toBe(200);
    expect((await me()).adult).toBe(true);
    expect(await rows("ada@age.test")).toBe(1);
    expect((await put({ adult: false })).status).toBe(200);
    expect((await me()).adult).toBe(false);
  });

  it("only takes true or false, and needs a session", async () => {
    expect((await put({ adult: "yes" })).status).toBe(400);
    expect((await t.api("/api/auth/adult", { method: "PUT", body: JSON.stringify({ adult: true }) })).status).toBe(401);
  });

  it("a signup records the answer for a new account", async () => {
    await t.post("/api/auth/signup", { accountType: "admin", name: "Grown", email: "Grown@Age.Test", password: "a-strong-pass-123!", teamName: "Team Grown", adult: true });
    expect(await rows("grown@age.test")).toBe(1);
    await t.post("/api/auth/signup", { accountType: "admin", name: "Kid", email: "kid@age.test", password: "a-strong-pass-123!", teamName: "Team Kid" });
    expect(await rows("kid@age.test")).toBe(0);
  });
});
