/**
 * Owner feature toggles: a team override wins over the global switch, an
 * unregistered key is never gated, only the owner can flip them, messaging
 * off refuses chat over REST and the socket without touching history, and
 * What's new off empties the release feed for that team only.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import WebSocket from "ws";
import { startTestServer, seedTeam, seedMember, type TestServer } from "./helpers/testServer";
import { FeatureFlags, FEATURES } from "../features";

vi.setConfig({ testTimeout: 30_000 });

let t: TestServer;
let teamA = 0, teamB = 0, memberA = 0;
let owner = "", alice = "", bob = "";
const dbAll = async (sql: string, ...args: any[]) => (await t.db.execute({ sql, args })).rows as any[];
const count = async (sql: string, ...args: any[]) => Number((await dbAll(sql, ...args))[0].n);

beforeAll(async () => {
  t = await startTestServer("cp-features-", { OWNER_EMAILS: "owner@ft.test" });
  teamA = await seedTeam(t.db, "Alpha");
  teamB = await seedTeam(t.db, "Bravo");
  owner = await t.session(await seedMember(t.db, teamB, "Owner", "owner@ft.test", "admin"));
  memberA = await seedMember(t.db, teamA, "Alice", "alice@ft.test", "admin");
  alice = await t.session(memberA);
  bob = await t.session(await seedMember(t.db, teamB, "Bob", "bob@ft.test"));
  // Each team gets its default channels on first read.
  await t.api("/api/chat/channels", { session: alice });
  await t.api("/api/chat/channels", { session: bob });
}, 120_000);
afterAll(async () => { await t?.stop(); });

const setGlobal = (key: string, enabled: any, session = owner) => t.patch(`/api/owner/features/${key}`, { enabled }, session);
const setTeam = (key: string, team: number, enabled: any, session = owner) => t.patch(`/api/owner/features/${key}/teams/${team}`, { enabled }, session);

/** Open a socket as `session`, send one chat message, and collect what comes back. */
async function sendChat(session: string, content: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${t.port}`);
  const seen: any[] = [];
  ws.on("message", (d) => { try { seen.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  ws.send(JSON.stringify({ type: "hello", sessionId: session }));
  await new Promise((r) => setTimeout(r, 400));
  ws.send(JSON.stringify({ type: "chat", content, client_id: "c-1" }));
  await new Promise((r) => setTimeout(r, 600));
  ws.close();
  return seen;
}

describe("resolution", () => {
  it("follows the matrix: none → on, global off → off, override wins either way, unknown → on", async () => {
    const flags = new FeatureFlags(t.db);
    expect(await flags.isEnabled(teamA, "messaging")).toBe(true);
    await t.db.execute("DELETE FROM feature_flags WHERE key = 'messaging'");
    expect(await flags.isEnabled(teamA, "messaging")).toBe(true);

    await flags.setGlobal("messaging", false, 0);
    expect(await flags.isEnabled(teamA, "messaging")).toBe(false);
    await flags.setTeam(teamA, "messaging", true, 0);
    expect(await flags.isEnabled(teamA, "messaging")).toBe(true);
    expect(await flags.isEnabled(teamB, "messaging")).toBe(false);

    await flags.setGlobal("messaging", true, 0);
    await flags.setTeam(teamA, "messaging", false, 0);
    expect(await flags.isEnabled(teamA, "messaging")).toBe(false);
    expect(await flags.isEnabled(teamB, "messaging")).toBe(true);

    expect(await flags.isEnabled(teamA, "voice")).toBe(true);
    await t.db.execute("INSERT OR REPLACE INTO feature_flags (key, enabled) VALUES ('voice', 0)");
    expect(await flags.isEnabled(teamA, "voice")).toBe(true);

    await flags.setTeam(teamA, "messaging", null, 0);
    expect(await flags.isEnabled(teamA, "messaging")).toBe(true);
  });

  it("the migration seeded the gated features as on", async () => {
    const rows = await dbAll("SELECT key, enabled FROM feature_flags WHERE key IN ('messaging', 'whats_new') ORDER BY key");
    expect(rows.map((r) => r.key)).toEqual(["messaging", "whats_new"]);
    expect(FEATURES.map((f) => f.key)).toEqual(["messaging", "whats_new"]);
  });
});

describe("owner endpoints", () => {
  it("are owner only", async () => {
    for (const s of [alice, bob]) {
      expect((await t.api("/api/owner/features", { session: s })).status).toBe(403);
      expect((await setGlobal("messaging", false, s)).status).toBe(403);
      expect((await setTeam("messaging", teamA, false, s)).status).toBe(403);
      expect((await t.api("/api/owner/feature-audit", { session: s })).status).toBe(403);
    }
    expect((await t.api("/api/owner/features")).status).toBe(401);
  });

  it("validate the key, the workspace and the value", async () => {
    expect((await setGlobal("voice", false)).status).toBe(404);
    expect((await setGlobal("messaging", "no")).status).toBe(400);
    expect((await setTeam("messaging", 999999, false)).status).toBe(404);
    expect((await setTeam("messaging", teamA, "off")).status).toBe(400);
  });

  it("list features with overrides and workspaces, and audit every flip", async () => {
    expect((await setTeam("messaging", teamA, false)).body).toMatchObject({ enabled: false, effective: false });
    const list = (await t.api("/api/owner/features", { session: owner })).body;
    const m = list.features.find((f: any) => f.key === "messaging");
    expect(m).toMatchObject({ label: "Messaging", enabled: true, overrides: [{ team_id: teamA, enabled: false }] });
    expect(list.teams.map((x: any) => x.name)).toEqual(expect.arrayContaining(["Alpha", "Bravo"]));
    const audit = (await t.api("/api/owner/feature-audit?limit=5", { session: owner })).body;
    expect(audit[0]).toMatchObject({ key: "messaging", scope: "team", team_id: teamA, team_name: "Alpha", enabled: false, changed_by_name: "Owner" });
    expect(audit.length).toBeLessThanOrEqual(5);
    expect((await setTeam("messaging", teamA, null)).body).toMatchObject({ enabled: null, effective: true });
    expect((await t.api("/api/owner/feature-audit?limit=1", { session: owner })).body[0]).toMatchObject({ scope: "inherit", enabled: true });
  });
});

describe("messaging off for one team", () => {
  it("refuses chat for that team only, keeps history, and comes back intact", async () => {
    // History before the switch.
    expect((await sendChat(alice, "before the switch")).some((m) => m.type === "chat")).toBe(true);
    const before = await dbAll("SELECT id, content FROM messages WHERE team_id = ? ORDER BY id", teamA);
    const channels = await dbAll("SELECT id, name FROM chat_channels WHERE team_id = ? ORDER BY id", teamA);
    expect(before.length).toBeGreaterThan(0);
    expect(channels.length).toBeGreaterThan(0);

    expect((await setTeam("messaging", teamA, false)).status).toBe(200);
    expect((await t.api("/api/features", { session: alice })).body).toMatchObject({ messaging: false, whats_new: true });
    expect((await t.api("/api/features", { session: bob })).body).toMatchObject({ messaging: true });

    // REST: reads and writes are refused.
    const off = { error: "feature_disabled", feature: "messaging" };
    for (const [path, method] of [
      ["/api/messages", "GET"], [`/api/messages/${before[0].id}`, "PATCH"], [`/api/messages/${before[0].id}`, "DELETE"],
      [`/api/messages/${before[0].id}/reactions`, "POST"], ["/api/messages/upload", "POST"],
      ["/api/chat/channels", "GET"], ["/api/chat/channels", "POST"], [`/api/chat/channels/${channels[0].id}`, "PATCH"], [`/api/chat/channels/${channels[0].id}`, "DELETE"],
      ["/api/chat/categories", "GET"], ["/api/chat/categories", "POST"],
    ] as const) {
      const r = await t.api(path, { method, session: alice, ...(method === "GET" ? {} : { body: JSON.stringify({ content: "x", name: "x", emoji: "👍" }) }) });
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.body).toEqual(off);
    }
    // Socket: denied, nothing stored or broadcast.
    const seen = await sendChat(alice, "while off");
    expect(seen).toContainEqual({ type: "chat_denied", client_id: "c-1", error: "Messaging is turned off for your team" });
    expect(seen.some((m) => m.type === "chat")).toBe(false);
    expect(await count("SELECT COUNT(*) AS n FROM messages WHERE content = 'while off'")).toBe(0);

    // The other team is unaffected in the same run.
    expect((await t.api("/api/messages", { session: bob })).status).toBe(200);
    expect((await sendChat(bob, "bravo still talks")).some((m) => m.type === "chat")).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM messages WHERE content = 'bravo still talks' AND team_id = ?", teamB)).toBe(1);
    // The owner console still works.
    expect((await t.api("/api/owner/overview", { session: owner })).status).toBe(200);

    // Back on: everything exactly as it was.
    expect((await setTeam("messaging", teamA, true)).status).toBe(200);
    expect(await dbAll("SELECT id, content FROM messages WHERE team_id = ? ORDER BY id", teamA)).toEqual(before);
    expect(await dbAll("SELECT id, name FROM chat_channels WHERE team_id = ? ORDER BY id", teamA)).toEqual(channels);
    const r = await t.api("/api/messages", { session: alice });
    expect(r.status).toBe(200);
    expect(r.body.map((m: any) => m.content)).toContain("before the switch");
    await setTeam("messaging", teamA, null);
  });

  it("a global switch-off reaches every team without an override", async () => {
    await setTeam("messaging", teamB, true);
    expect((await setGlobal("messaging", false)).status).toBe(200);
    expect((await t.api("/api/messages", { session: alice })).status).toBe(403);
    expect((await t.api("/api/messages", { session: bob })).status).toBe(200);
    expect((await setGlobal("messaging", true)).status).toBe(200);
    await setTeam("messaging", teamB, null);
    expect((await t.api("/api/messages", { session: alice })).status).toBe(200);
  });
});

describe("What's new off for one team", () => {
  it("empties the release feed for that team only", async () => {
    const all = (await t.api("/api/changelog")).body;
    expect(all.length).toBeGreaterThan(0);
    expect((await setTeam("whats_new", teamA, false)).status).toBe(200);
    expect((await t.api("/api/changelog", { session: alice })).body).toEqual([]);
    expect((await t.api("/api/changelog", { session: bob })).body).toEqual(all);
    expect((await t.api("/api/changelog")).body).toEqual(all);
    expect((await t.api("/api/features", { session: alice })).body).toMatchObject({ messaging: true, whats_new: false });
    // The owner still edits releases.
    expect((await t.api("/api/owner/changelog", { session: owner })).status).toBe(200);
    await setTeam("whats_new", teamA, null);
    expect((await t.api("/api/changelog", { session: alice })).body).toEqual(all);
  });
});

describe("workspace delete", () => {
  it("drops the team's overrides and keeps its audit rows", async () => {
    const team = await seedTeam(t.db, "Doomed");
    const admin = await t.session(await seedMember(t.db, team, "Dee", "dee@ft.test", "admin"));
    await setTeam("messaging", team, false);
    const r = await t.api(`/api/teams/${team}`, { method: "DELETE", session: admin });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM team_feature_overrides WHERE team_id = ?", team)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM feature_flag_audit WHERE team_id = ?", team)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM teams WHERE id = ?", team)).toBe(0);
  });
});
