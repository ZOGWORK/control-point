/**
 * One profile picture per shared account (server/sharedAccounts.ts, migration 158): the `avatar`
 * field on the account payload, GET/PUT/DELETE /internal/accounts/:id/avatar for Control Scout,
 * and Control Point's own picture changes applying account-wide.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startTestServer, seedTeam, seedMember, type TestServer } from "./helpers/testServer";
import { withSession } from "./helpers/session";
import { imageMagicMatches, localFileId } from "../sharedAccounts";

vi.setConfig({ testTimeout: 30_000 });

const KEY = "test-internal-key-0123456789-abcdefghijklmnop";
// Production mode: these routes are mounted before Vite (see sharedAccounts.test.ts).
let t: TestServer;
beforeAll(async () => {
  t = await startTestServer("cp-avatar-", { NODE_ENV: "production", CONTROL_SCOUT_INTERNAL_KEY: KEY, CONTROL_SCOUT_URL: "https://scout.example.test" });
}, 180_000);
afterAll(async () => { await t?.stop(); });

// Minimal valid 1x1 PNG.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
  "0000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082",
  "hex",
);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 1)]);

type Res = { status: number; body: any; headers: Headers; buf: Buffer };
async function internal(path: string, init: { method?: string; body?: Buffer | string; type?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { "x-internal-key": KEY };
  if (init.type) headers["content-type"] = init.type;
  const go = () => fetch(`${t.base}${path}`, { method: init.method || "GET", headers, body: init.body });
  const r = await go().catch(() => new Promise((ok) => setTimeout(ok, 300)).then(go));
  const buf = Buffer.from(await r.arrayBuffer());
  let body: any = null;
  try { body = JSON.parse(buf.toString("utf8")); } catch { /* bytes */ }
  return { status: r.status, body, headers: r.headers, buf };
}
const put = (id: number, body: Buffer, type = "image/png") => internal(`/internal/accounts/${id}/avatar`, { method: "PUT", body, type });
const del = (id: number) => internal(`/internal/accounts/${id}/avatar`, { method: "DELETE" });
const getAvatar = (id: number) => internal(`/internal/accounts/${id}/avatar`);

async function account(email: string): Promise<any> {
  const r = await internal("/internal/accounts/resolve", { method: "POST", type: "application/json", body: JSON.stringify({ email, verifiedBy: "google" }) });
  expect(r.status).toBe(200);
  return r.body.account;
}
async function accountById(id: number): Promise<any> {
  return (await internal(`/internal/accounts/${id}`)).body.account;
}
/** A stored avatar file, as Control Point's upload leaves it (bytes in the database, no R2). */
async function storedAvatar(memberId: number | null, mime = "image/png", data: Buffer = PNG): Promise<number> {
  const r = await t.db.execute({
    sql: "INSERT INTO stored_files (team_id, member_id, kind, filename, mime_type, size, data) VALUES (NULL, ?, 'avatar', 'a', ?, ?, ?)",
    args: [memberId, mime, data.length, data],
  });
  return Number(r.lastInsertRowid);
}
const setMemberUrl = (memberId: number, url: string | null) => t.db.execute({ sql: "UPDATE members SET avatar_url = ? WHERE id = ?", args: [url, memberId] });
const memberUrl = async (memberId: number) => (await t.db.execute({ sql: "SELECT avatar_url FROM members WHERE id = ?", args: [memberId] })).rows[0].avatar_url;
const accountUrl = async (id: number) => (await t.db.execute({ sql: "SELECT avatar_url FROM accounts WHERE id = ?", args: [id] })).rows[0].avatar_url;
const fileExists = async (id: number) => (await t.db.execute({ sql: "SELECT COUNT(*) AS n FROM stored_files WHERE id = ?", args: [id] })).rows[0].n === 1;
let seq = 0;
const email = (tag: string) => `avatar.${tag}.${++seq}@example.test`;

describe("helpers", () => {
  it("magic bytes and local file URLs", () => {
    expect(imageMagicMatches("image/png", PNG)).toBe(true);
    expect(imageMagicMatches("image/jpeg", PNG)).toBe(false);
    expect(imageMagicMatches("image/jpeg", JPEG)).toBe(true);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
    expect(imageMagicMatches("image/webp", webp)).toBe(true);
    expect(imageMagicMatches("image/gif", Buffer.from("GIF89a"))).toBe(false);
    expect(localFileId("/api/files/12")).toBe(12);
    expect(localFileId("https://x.test/a.png")).toBeNull();
    expect(localFileId("/api/files/0")).toBeNull();
  });
});

describe("the avatar field on the account", () => {
  it("is null for an account with no picture", async () => {
    expect((await account(email("none"))).avatar).toBeNull();
  });

  it("comes from an active members row; inactive rows, external URLs and non-image files don't count", async () => {
    const e = email("member");
    const team = await seedTeam(t.db, "Avatar A");
    const m = await seedMember(t.db, team, "A", e);
    const gone = await seedMember(t.db, await seedTeam(t.db, "Avatar Gone"), "A", e);
    await t.db.execute({ sql: "UPDATE members SET is_active = 0 WHERE id = ?", args: [gone] });
    const acc = await account(e);
    await setMemberUrl(m, "https://lh3.example.test/photo.jpg");
    await setMemberUrl(gone, `/api/files/${await storedAvatar(gone)}`);
    expect((await accountById(acc.id)).avatar).toBeNull();
    const svg = await storedAvatar(m, "image/svg+xml", Buffer.from("<svg/>"));
    await setMemberUrl(m, `/api/files/${svg}`);
    expect((await accountById(acc.id)).avatar).toBeNull();
    const f = await storedAvatar(m);
    await setMemberUrl(m, `/api/files/${f}`);
    expect((await accountById(acc.id)).avatar).toEqual({ id: String(f) });
  });

  it("the newest member avatar wins, and accounts.avatar_url wins over all of them", async () => {
    const e = email("newest");
    const m1 = await seedMember(t.db, await seedTeam(t.db, "N1"), "N", e);
    const m2 = await seedMember(t.db, await seedTeam(t.db, "N2"), "N", e.toUpperCase());
    const older = await storedAvatar(m1);
    const newer = await storedAvatar(m2);
    await setMemberUrl(m2, `/api/files/${newer}`);
    await setMemberUrl(m1, `/api/files/${older}`);
    const acc = await account(e);
    expect(acc.avatar).toEqual({ id: String(newer) });
    const own = await storedAvatar(null);
    await t.db.execute({ sql: "UPDATE accounts SET avatar_url = ? WHERE id = ?", args: [`/api/files/${own}`, acc.id] });
    expect((await accountById(acc.id)).avatar).toEqual({ id: String(own) });
    // A missing file on the account falls back to the members rows.
    await t.db.execute({ sql: "UPDATE accounts SET avatar_url = '/api/files/999999' WHERE id = ?", args: [acc.id] });
    expect((await accountById(acc.id)).avatar).toEqual({ id: String(newer) });
  });
});

describe("GET /internal/accounts/:id/avatar", () => {
  it("returns the bytes with the stored type and X-Avatar-Id", async () => {
    const e = email("get");
    const m = await seedMember(t.db, await seedTeam(t.db, "G"), "G", e);
    const f = await storedAvatar(m);
    await setMemberUrl(m, `/api/files/${f}`);
    const acc = await account(e);
    const r = await getAvatar(acc.id);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("x-avatar-id")).toBe(String(f));
    expect(r.buf.equals(PNG)).toBe(true);
  });

  it("404 no_avatar without a picture, 404 Not found for an unknown account", async () => {
    const acc = await account(email("get-none"));
    expect(await getAvatar(acc.id).then((r) => [r.status, r.body])).toEqual([404, { error: "no_avatar" }]);
    expect(await getAvatar(9_999_999).then((r) => [r.status, r.body])).toEqual([404, { error: "Not found" }]);
    expect((await getAvatar(0)).status).toBe(404);
  });

  it("needs the internal key", async () => {
    const acc = await account(email("get-key"));
    expect((await fetch(`${t.base}/internal/accounts/${acc.id}/avatar`)).status).toBe(401);
  });
});

describe("PUT /internal/accounts/:id/avatar", () => {
  it("stores a png and sets it on the account and every active members row", async () => {
    const e = email("put");
    const m1 = await seedMember(t.db, await seedTeam(t.db, "P1"), "P", e);
    const m2 = await seedMember(t.db, await seedTeam(t.db, "P2"), "P", ` ${e.toUpperCase()} `);
    const gone = await seedMember(t.db, await seedTeam(t.db, "P3"), "P", e);
    await t.db.execute({ sql: "UPDATE members SET is_active = 0 WHERE id = ?", args: [gone] });
    const acc = await account(e);
    const r = await put(acc.id, PNG);
    expect(r.status).toBe(200);
    const id = r.body.avatar.id;
    expect(id).toMatch(/^\d+$/);
    const url = `/api/files/${id}`;
    expect(await accountUrl(acc.id)).toBe(url);
    expect(await memberUrl(m1)).toBe(url);
    expect(await memberUrl(m2)).toBe(url);
    expect(await memberUrl(gone)).toBeNull();
    const f = (await t.db.execute({ sql: "SELECT team_id, member_id, kind, mime_type FROM stored_files WHERE id = ?", args: [Number(id)] })).rows[0] as any;
    expect(f).toMatchObject({ team_id: null, member_id: m1, kind: "avatar", mime_type: "image/png" });
    expect((await accountById(acc.id)).avatar).toEqual({ id });
    const g = await getAvatar(acc.id);
    expect(g.headers.get("x-avatar-id")).toBe(id);
    expect(g.buf.equals(PNG)).toBe(true);
  });

  it("an account with no Control Point rows gets a file with no member", async () => {
    const acc = await account(email("put-scout-only"));
    const r = await put(acc.id, JPEG, "image/jpeg");
    expect(r.status).toBe(200);
    const f = (await t.db.execute({ sql: "SELECT member_id, mime_type FROM stored_files WHERE id = ?", args: [Number(r.body.avatar.id)] })).rows[0] as any;
    expect(f).toMatchObject({ member_id: null, mime_type: "image/jpeg" });
    expect((await getAvatar(acc.id)).headers.get("content-type")).toBe("image/jpeg");
  });

  it("refuses wrong magic bytes, other types and empty bodies (400), too large (413), unknown accounts (404)", async () => {
    const acc = await account(email("put-bad"));
    const before = (await t.db.execute("SELECT COUNT(*) AS n FROM stored_files")).rows[0].n;
    expect(await put(acc.id, JPEG, "image/png").then((r) => [r.status, r.body])).toEqual([400, { error: "invalid_image" }]);
    expect((await put(acc.id, PNG, "image/gif")).body).toEqual({ error: "invalid_image" });
    expect((await put(acc.id, PNG, "text/plain")).body).toEqual({ error: "invalid_image" });
    expect((await put(acc.id, Buffer.alloc(0))).body).toEqual({ error: "invalid_image" });
    const big = Buffer.concat([PNG, Buffer.alloc(512 * 1024)]);
    expect(await put(acc.id, big).then((r) => [r.status, r.body])).toEqual([413, { error: "too_large" }]);
    expect(await put(9_999_999, PNG).then((r) => [r.status, r.body])).toEqual([404, { error: "Not found" }]);
    expect((await t.db.execute("SELECT COUNT(*) AS n FROM stored_files")).rows[0].n).toBe(before);
    expect(await accountUrl(acc.id)).toBeNull();
  });

  it("a new picture drops the old file only when nothing else points at it", async () => {
    const e = email("put-replace");
    const m = await seedMember(t.db, await seedTeam(t.db, "R1"), "R", e);
    const acc = await account(e);
    const first = Number((await put(acc.id, PNG)).body.avatar.id);
    const second = Number((await put(acc.id, PNG)).body.avatar.id);
    expect(second).not.toBe(first);
    expect(await fileExists(first)).toBe(false);
    // An inactive row (not changed by the account-wide set) still shows the second: it stays.
    const gone = await seedMember(t.db, await seedTeam(t.db, "R2"), "R", e);
    await t.db.execute({ sql: "UPDATE members SET is_active = 0, avatar_url = ? WHERE id = ?", args: [`/api/files/${second}`, gone] });
    const third = Number((await put(acc.id, PNG)).body.avatar.id);
    expect(await fileExists(second)).toBe(true);
    expect(await memberUrl(m)).toBe(`/api/files/${third}`);
  });
});

describe("DELETE /internal/accounts/:id/avatar", () => {
  it("clears the account and every active members row, and drops the file", async () => {
    const e = email("del");
    const m1 = await seedMember(t.db, await seedTeam(t.db, "D1"), "D", e);
    const m2 = await seedMember(t.db, await seedTeam(t.db, "D2"), "D", e);
    const acc = await account(e);
    const id = Number((await put(acc.id, PNG)).body.avatar.id);
    // An older member-only picture is cleared too (no fallback left behind).
    const old = await storedAvatar(m2);
    await setMemberUrl(m2, `/api/files/${old}`);
    expect(await del(acc.id).then((r) => [r.status, r.body])).toEqual([200, { ok: true }]);
    expect(await accountUrl(acc.id)).toBeNull();
    expect(await memberUrl(m1)).toBeNull();
    expect(await memberUrl(m2)).toBeNull();
    expect(await fileExists(id)).toBe(false);
    expect(await fileExists(old)).toBe(false);
    expect((await accountById(acc.id)).avatar).toBeNull();
    expect((await getAvatar(acc.id)).body).toEqual({ error: "no_avatar" });
    // Again, with nothing to remove; unknown account.
    expect((await del(acc.id)).body).toEqual({ ok: true });
    expect(await del(9_999_999).then((r) => [r.status, r.body])).toEqual([404, { error: "Not found" }]);
  });
});

// Hand-built multipart (fetch's FormData doesn't interop with the server process here).
function multipart(data: Buffer): { body: Buffer; contentType: string } {
  const boundary = "----cp-avatar-boundary";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`);
  return { body: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]), contentType: `multipart/form-data; boundary=${boundary}` };
}
async function cpUpload(session: string) {
  const { body, contentType } = multipart(PNG);
  const r = await fetch(`${t.base}/api/profile/avatar`, { method: "POST", body, headers: withSession(new Headers({ "Content-Type": contentType }), session) });
  return { status: r.status, body: await r.json() };
}

describe("Control Point's own picture changes are account-wide", () => {
  it("an upload shows in every workspace and on the shared account, and the old file goes", async () => {
    const e = email("cp-upload");
    const m1 = await seedMember(t.db, await seedTeam(t.db, "C1"), "C", e);
    const m2 = await seedMember(t.db, await seedTeam(t.db, "C2"), "C", e);
    const acc = await account(e);
    const old = await storedAvatar(m2);
    await setMemberUrl(m2, `/api/files/${old}`);
    const s = await t.session(m1);
    const up = await cpUpload(s);
    expect(up.status).toBe(200);
    expect(up.body.avatar_url).toMatch(/^\/api\/files\/\d+$/);
    expect(await memberUrl(m1)).toBe(up.body.avatar_url);
    expect(await memberUrl(m2)).toBe(up.body.avatar_url);
    expect(await accountUrl(acc.id)).toBe(up.body.avatar_url);
    expect((await accountById(acc.id)).avatar).toEqual({ id: String(localFileId(up.body.avatar_url)) });
    expect(await fileExists(old)).toBe(false);
  });

  it("works for someone who never used Scout (no accounts row)", async () => {
    const e = email("cp-only");
    const m1 = await seedMember(t.db, await seedTeam(t.db, "O1"), "O", e);
    const m2 = await seedMember(t.db, await seedTeam(t.db, "O2"), "O", e);
    const up = await cpUpload(await t.session(m1));
    expect(up.status).toBe(200);
    expect(await memberUrl(m2)).toBe(up.body.avatar_url);
    expect((await t.db.execute({ sql: "SELECT COUNT(*) AS n FROM accounts WHERE email = ?", args: [e] })).rows[0].n).toBe(0);
  });

  it("PATCH /api/profile: removing clears everywhere; the account's current (Scout) picture is accepted", async () => {
    const e = email("cp-patch");
    const m1 = await seedMember(t.db, await seedTeam(t.db, "PP1"), "Pat", e);
    const m2 = await seedMember(t.db, await seedTeam(t.db, "PP2"), "Pat", e);
    const acc = await account(e);
    const id = (await put(acc.id, PNG)).body.avatar.id;
    const s = await t.session(m1);
    // Saving the profile with the picture it already shows (a Scout upload, no owning member) is fine.
    const keep = await t.patch("/api/profile", { name: "Pat", avatar_url: `/api/files/${id}` }, s);
    expect(keep.status).toBe(200);
    expect(await fileExists(Number(id))).toBe(true);
    // Someone else's file is still refused.
    const other = await storedAvatar(await seedMember(t.db, await seedTeam(t.db, "PP3"), "X", email("other")));
    expect((await t.patch("/api/profile", { name: "Pat", avatar_url: `/api/files/${other}` }, s)).status).toBe(400);
    const clear = await t.patch("/api/profile", { name: "Pat", avatar_url: null }, s);
    expect(clear.status).toBe(200);
    expect(await memberUrl(m1)).toBeNull();
    expect(await memberUrl(m2)).toBeNull();
    expect(await accountUrl(acc.id)).toBeNull();
    expect(await fileExists(Number(id))).toBe(false);
    expect((await accountById(acc.id)).avatar).toBeNull();
  });
});
