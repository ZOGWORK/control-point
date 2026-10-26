/**
 * Control Kit link (contract: control-kit docs/control-point-link.md, v1):
 * the authorization code, the token exchange, and the bearer API that sends a
 * scanned BOM into a workspace's parts list.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startTestServer, seedTeam, seedMember, type TestServer } from "./helpers/testServer";
import { checkPayload, clientSecretMatches, isAllowedRedirect, partKey } from "../controlKitLink";

vi.setConfig({ testTimeout: 60_000 });

const SECRET = "test-control-kit-secret";
const REDIRECT = "http://127.0.0.1:8787/control-point/callback";
const PROD_REDIRECT = "https://control-kit.control-kit-worker.workers.dev/control-point/callback";
const basic = (secret = SECRET, id = "control-kit") => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

let t: TestServer;
let team = 0, other = 0, noCad = 0;
let sam = "", outsider = "", teamless = "";

/** A server-to-server call the way the Control Kit Worker makes it: no cookie, no client header. */
async function ck(path: string, opts: { method?: string; token?: string; auth?: string; body?: any; raw?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.auth) headers.authorization = opts.auth;
  if (opts.body !== undefined || opts.raw !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${t.base}${path}`, { method: opts.method || (opts.body !== undefined || opts.raw !== undefined ? "POST" : "GET"), headers, body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  let body: any = null;
  try { body = await res.json(); } catch { /* 204 */ }
  return { status: res.status, body, headers: res.headers };
}

async function code(session: string, redirect = REDIRECT, state = "st4te") {
  const r = await t.post("/api/integrations/control-kit/authorize", { state, redirect_uri: redirect }, session);
  expect(r.status).toBe(200);
  const url = new URL(r.body.redirect);
  expect(url.origin + url.pathname).toBe(redirect);
  expect(url.searchParams.get("state")).toBe(state);
  return url.searchParams.get("code")!;
}
const exchange = (c: string, redirect = REDIRECT, auth = basic()) =>
  ck("/api/integrations/control-kit/token", { auth, body: { grant_type: "authorization_code", code: c, redirect_uri: redirect } });
async function link(session: string) {
  const r = await exchange(await code(session));
  expect(r.status).toBe(200);
  return r.body.access_token as string;
}

const line = (part: string, extra: Record<string, unknown> = {}) => ({
  key: `line-${part}`, documentId: "doc1", elementId: "partstudio", partId: part, configuration: "default", identity: `doc1:partstudio:${part}:default`, ...extra,
});
const cad = (part: string, over: Record<string, unknown> = {}) => ({
  name: `Part ${part}`, section: "Drivetrain", quantity: 2, source: "gobilda", unit_cost: 1.5, status: "to_order", notes: "from scan", extra: line(part), ...over,
});
const payload = (key: string, parts: any[], over: Record<string, unknown> = {}) => ({
  idempotencyKey: key, source: "control-kit", bundleVersion: 2,
  assembly: { name: "Robot", documentId: "doc1", elementId: "asm1", onshapeUrl: "https://cad.onshape.com/documents/doc1", assemblyUrl: "https://cad.onshape.com/documents/doc1/w/w1/e/asm1", documentName: "Robot" },
  revision: { type: "v", id: "v1" }, generatedAt: "2026-10-26T15:00:00.000Z", lines: [], suppressedLines: [], missingMetadataLines: [], suppressedCount: 0,
  totals: { uniqueLines: parts.length, totalInstances: 0, totalCostUsd: null, outOfStockLines: 0 }, cadParts: parts,
  controlPointCadUrl: "https://tryctrlpoint.org/cad-parts", files: [], filesNotIncluded: [], ...over,
});
const send = (token: string, ws: number, body: any) => ck(`/api/integrations/control-kit/workspaces/${ws}/bom`, { token, body });
const partRows = async () => (await t.db.execute({ sql: "SELECT * FROM cad_parts WHERE team_id = ? AND ck_part_key IS NOT NULL ORDER BY ck_part_key", args: [team] })).rows as any[];

beforeAll(async () => {
  t = await startTestServer("cp-controlkit-", { CONTROL_KIT_CLIENT_SECRET: SECRET, CONTROL_KIT_REDIRECT_URIS: `${PROD_REDIRECT},${REDIRECT}` });
  team = await seedTeam(t.db, "HORS");
  other = await seedTeam(t.db, "Elsewhere");
  noCad = await seedTeam(t.db, "No CAD");
  await t.db.execute({ sql: "UPDATE teams SET accent_color = '#2F6BFF', ftc_team_number = 6980 WHERE id = ?", args: [team] });
  await t.db.execute({ sql: "UPDATE teams SET accent_color = 'red' WHERE id = ?", args: [other] });
  await t.db.execute({ sql: `UPDATE teams SET disabled_modules = '["cad"]' WHERE id = ?`, args: [noCad] });
  const samId = await seedMember(t.db, team, "Sam", "sam@test.local");
  await seedMember(t.db, noCad, "Sam", "sam@test.local");
  const outsiderId = await seedMember(t.db, other, "Olive", "olive@test.local");
  const loneId = await seedMember(t.db, other, "Lone", "lone@test.local");
  await t.db.execute({ sql: "UPDATE members SET is_active = 0, team_id = NULL WHERE id = ?", args: [loneId] });
  sam = await t.session(samId);
  outsider = await t.session(outsiderId);
  teamless = await t.session(loneId);
}, 120_000);
afterAll(async () => { await t?.stop(); });

describe("helpers", () => {
  it("allows only exact allowlisted redirect URIs", () => {
    const env = { CONTROL_KIT_REDIRECT_URIS: `${PROD_REDIRECT}, ${REDIRECT}` };
    expect(isAllowedRedirect(REDIRECT, env)).toBe(true);
    expect(isAllowedRedirect(`${REDIRECT}?x=1`, env)).toBe(false);
    expect(isAllowedRedirect(`${REDIRECT}/`, env)).toBe(false);
    expect(isAllowedRedirect(PROD_REDIRECT, {})).toBe(true);
    expect(isAllowedRedirect(REDIRECT, {})).toBe(false);
  });
  it("checks the Basic client secret", () => {
    expect(clientSecretMatches(basic(), SECRET)).toBe(true);
    expect(clientSecretMatches(basic("nope"), SECRET)).toBe(false);
    expect(clientSecretMatches(basic(SECRET, "someone-else"), SECRET)).toBe(false);
    expect(clientSecretMatches(basic(), undefined)).toBe(false);
  });
  it("names a part by extra.identity, or builds the same key from the line", () => {
    expect(partKey({ identity: "a:b:c:d" })).toBe("a:b:c:d");
    expect(partKey({ documentId: "a", elementId: "b", partId: "c", configuration: "d" })).toBe("a:b:c:d");
    expect(partKey({ documentId: "a", elementId: "b", partId: null })).toBeNull();
  });
  it("rejects payloads the contract calls bad", () => {
    expect(checkPayload(payload("k", [cad("A")]))).toEqual({ ok: true });
    expect(checkPayload(payload("k", [cad("A")], { source: "other" })).ok).toBe(false);
    expect(checkPayload(payload("k", [cad("A")], { bundleVersion: 1 })).ok).toBe(false);
    expect(checkPayload(payload("k", [cad("A")], { cadParts: undefined })).ok).toBe(false);
  });
});

describe("linking", () => {
  it("refuses a redirect URI that isn't allowlisted, on the consent page and on authorize", async () => {
    const evil = "https://evil.example/control-point/callback";
    const consent = await t.api(`/api/integrations/control-kit/consent?redirect_uri=${encodeURIComponent(evil)}`, { session: sam });
    expect(consent).toMatchObject({ status: 400, body: { error: "bad_redirect_uri" } });
    const r = await t.post("/api/integrations/control-kit/authorize", { state: "s", redirect_uri: evil }, sam);
    expect(r).toMatchObject({ status: 400, body: { error: "bad_redirect_uri" } });
    expect(r.body.redirect).toBeUndefined();
  });

  it("shows the account and its workspaces on the consent page", async () => {
    const r = await t.api(`/api/integrations/control-kit/consent?redirect_uri=${encodeURIComponent(REDIRECT)}`, { session: sam });
    expect(r.status).toBe(200);
    expect(r.body.account).toEqual({ email: "sam@test.local", name: "Sam" });
    expect(r.body.workspaces.map((w: any) => w.name)).toEqual(["HORS", "No CAD"]);
  });

  it("needs a signed-in session to authorize", async () => {
    const r = await ck("/api/integrations/control-kit/authorize", { body: { state: "s", redirect_uri: REDIRECT } });
    expect(r.status).toBe(403); // no client header: the CSRF guard refuses it first
    expect((await t.post("/api/integrations/control-kit/authorize", { state: "s", redirect_uri: REDIRECT })).status).toBe(401);
  });

  it("exchanges a code once, for a token stored only as its hash", async () => {
    const c = await code(sam);
    const r = await exchange(c);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ token_type: "Bearer", account: { email: "sam@test.local", name: "Sam" } });
    expect(r.body.access_token).toMatch(/^ckp_/);
    const stored = (await t.db.execute("SELECT token_hash FROM control_kit_tokens")).rows.map((x: any) => x.token_hash);
    expect(stored).not.toContain(r.body.access_token);
    const codes = (await t.db.execute("SELECT code_hash FROM control_kit_codes")).rows.map((x: any) => x.code_hash);
    expect(codes).not.toContain(c);
    // Reuse is refused.
    expect(await exchange(c)).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
  });

  it("refuses an expired code, and one sent with another redirect URI", async () => {
    const c = await code(sam);
    await t.db.execute({ sql: "UPDATE control_kit_codes SET expires_at = ? WHERE used_at IS NULL", args: [new Date(Date.now() - 1000).toISOString()] });
    expect(await exchange(c)).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
    const c2 = await code(sam);
    expect(await exchange(c2, PROD_REDIRECT)).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
  });

  it("refuses a wrong client secret without using up the code", async () => {
    const c = await code(sam);
    expect(await exchange(c, REDIRECT, basic("wrong"))).toMatchObject({ status: 401, body: { error: "invalid_client" } });
    expect(await exchange(c, REDIRECT, "")).toMatchObject({ status: 401, body: { error: "invalid_client" } });
    expect((await exchange(c)).status).toBe(200);
  });
});

describe("bearer API", () => {
  it("lists the account's workspaces with accent, FTC number and CAD rights", async () => {
    const token = await link(sam);
    const r = await ck("/api/integrations/control-kit/workspaces", { token });
    expect(r.status).toBe(200);
    expect(r.body.account).toEqual({ email: "sam@test.local", name: "Sam" });
    expect(r.body.workspaces).toEqual([
      { id: team, name: "HORS", ftcNumber: "6980", accentColor: "#2f6bff", canEditCad: true, cadUrl: `${t.base}/cad-parts` },
      { id: noCad, name: "No CAD", ftcNumber: null, accentColor: null, canEditCad: false, cadUrl: `${t.base}/cad-parts` },
    ]);
  });

  it("gives a teamless account an empty list", async () => {
    const token = await link(teamless);
    const r = await ck("/api/integrations/control-kit/workspaces", { token });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ account: { email: "lone@test.local", name: "Lone" }, workspaces: [] });
  });

  it("answers 401 revoked for an unknown or revoked token", async () => {
    expect(await ck("/api/integrations/control-kit/workspaces", { token: "ckp_nope" })).toMatchObject({ status: 401, body: { error: "revoked" } });
    expect(await ck("/api/integrations/control-kit/workspaces")).toMatchObject({ status: 401, body: { error: "revoked" } });
    const token = await link(sam);
    expect((await ck("/api/integrations/control-kit/revoke", { token, method: "POST" })).status).toBe(204);
    expect(await ck("/api/integrations/control-kit/workspaces", { token })).toMatchObject({ status: 401, body: { error: "revoked" } });
    expect(await send(token, team, payload("k-revoked", [cad("A")]))).toMatchObject({ status: 401, body: { error: "revoked" } });
  });

  it("refuses a workspace the account isn't in, and one without CAD", async () => {
    const token = await link(sam);
    expect(await send(token, other, payload("k-other", [cad("A")]))).toMatchObject({ status: 403, body: { error: "not_member" } });
    expect(await send(token, 999999, payload("k-other", [cad("A")]))).toMatchObject({ status: 403, body: { error: "not_member" } });
    expect(await ck(`/api/integrations/control-kit/workspaces/${other}/imports`, { token })).toMatchObject({ status: 403, body: { error: "not_member" } });
    expect(await send(token, noCad, payload("k-nocad", [cad("A")]))).toMatchObject({ status: 403, body: { error: "no_cad_edit" } });
    // Removed from the workspace after linking: refused on the next call.
    const oliveToken = await link(outsider);
    await t.db.execute({ sql: "UPDATE members SET is_active = 0 WHERE email = 'olive@test.local'", args: [] });
    expect(await send(oliveToken, other, payload("k-olive", [cad("A")]))).toMatchObject({ status: 403, body: { error: "not_member" } });
    await t.db.execute({ sql: "UPDATE members SET is_active = 1 WHERE email = 'olive@test.local'", args: [] });
  });

  it("rejects bad payloads", async () => {
    const token = await link(sam);
    expect(await send(token, team, payload("k-bad", [cad("A")], { source: "elsewhere" }))).toMatchObject({ status: 400, body: { error: "bad_payload" } });
    expect(await send(token, team, payload("k-bad", [cad("A")], { bundleVersion: 1 }))).toMatchObject({ status: 400, body: { error: "bad_payload" } });
    expect(await send(token, team, payload("k-bad", [], { cadParts: undefined }))).toMatchObject({ status: 400, body: { error: "bad_payload" } });
    expect(await ck(`/api/integrations/control-kit/workspaces/${team}/bom`, { token, raw: "{not json" })).toMatchObject({ status: 400, body: { error: "bad_payload" } });
  });

  it("imports a BOM, upserts by part identity keeping people's fields, and marks rows missing from the new scan", async () => {
    const token = await link(sam);
    const handMade = Number((await t.db.execute({
      sql: "INSERT INTO cad_parts (team_id, name, created_at, updated_at) VALUES (?, 'Hand-made bracket', ?, ?)", args: [team, "2026-01-01", "2026-01-01"],
    })).lastInsertRowid);
    const xlsx = Buffer.from("fake workbook");
    const { createHash } = await import("node:crypto");
    const first = await send(token, team, payload("k-1", [cad("A"), cad("B"), cad("C")], {
      files: [
        { name: "Robot BOM.xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: xlsx.length, sha256: createHash("sha256").update(xlsx).digest("hex"), delivery: "inline", contentBase64: xlsx.toString("base64") },
        { name: "Robot STEP.zip", mediaType: "application/zip", sizeBytes: 9_000_000, sha256: "ab".repeat(32), delivery: "reference", reason: "Larger than 4 MB" },
      ],
    }));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ duplicate: false, workspace: { id: team, name: "HORS", ftcNumber: "6980" }, created: 3, updated: 0, markedRemoved: 0, filesStored: 1 });
    expect(first.body.url).toBe(`${t.base}/cad-parts?import=${first.body.importId}`);
    const docs = (await t.db.execute({ sql: "SELECT name, url FROM cad_docs WHERE ck_import_id = ?", args: [first.body.importId] })).rows as any[];
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ name: "Robot BOM.xlsx" });

    // People work on the parts list.
    await t.db.execute({ sql: "UPDATE cad_parts SET status = 'ordered', assignee = 'Ada' WHERE ck_part_key = 'doc1:partstudio:A:default'", args: [] });
    await t.db.execute({ sql: "UPDATE cad_parts SET assignee = 'Bo' WHERE ck_part_key = 'doc1:partstudio:B:default'", args: [] });

    // A rescan: A changed, B still there (now printed), C gone, D new.
    const second = await send(token, team, payload("k-2", [
      cad("A", { name: "Part A v2", quantity: 4, status: "to_order" }),
      cad("B", { status: "printed", source: "printed" }),
      cad("D"),
    ]));
    expect(second.body).toMatchObject({ duplicate: false, created: 1, updated: 2, markedRemoved: 1, filesStored: 0 });
    const rows = await partRows();
    const by = (p: string) => rows.find((r) => r.ck_part_key === `doc1:partstudio:${p}:default`);
    expect(by("A")).toMatchObject({ name: "Part A v2", quantity: 4, status: "ordered", assignee: "Ada", ck_removed_at: null, ck_import_id: second.body.importId });
    expect(by("B")).toMatchObject({ status: "printed", source: "printed", assignee: "Bo", ck_removed_at: null });
    expect(by("C").ck_removed_at).toBeTruthy();
    expect(by("C").ck_import_id).toBe(first.body.importId);
    expect(by("D")).toMatchObject({ status: "to_order", ck_document_id: "doc1", ck_element_id: "asm1" });
    expect(JSON.parse(by("D").ck_extra)).toMatchObject({ identity: "doc1:partstudio:D:default" });
    // Hand-made parts are untouched.
    const hand = (await t.db.execute({ sql: "SELECT * FROM cad_parts WHERE id = ?", args: [handMade] })).rows[0] as any;
    expect(hand).toMatchObject({ name: "Hand-made bracket", ck_removed_at: null, ck_part_key: null });

    // C comes back in a later scan: no longer marked.
    const third = await send(token, team, payload("k-3", [cad("A"), cad("B"), cad("C"), cad("D")]));
    expect(third.body).toMatchObject({ created: 0, updated: 4, markedRemoved: 0 });
    expect((await partRows()).every((r) => !r.ck_removed_at)).toBe(true);

    // History for Control Kit's "Last sent" line, newest first.
    const hist = await ck(`/api/integrations/control-kit/workspaces/${team}/imports?document=doc1&element=asm1`, { token });
    expect(hist.status).toBe(200);
    expect(hist.body.map((h: any) => h.idempotencyKey)).toEqual(["k-3", "k-2", "k-1"]);
    expect(hist.body[1]).toMatchObject({ importId: second.body.importId, sentBy: "Sam", created: 1, updated: 2, markedRemoved: 1, url: second.body.url });
    expect((await ck(`/api/integrations/control-kit/workspaces/${team}/imports?document=other`, { token })).body).toEqual([]);

    // The Parts tab's ?import= link reads one import of the active workspace.
    const detail = await t.api(`/api/cad/imports/${first.body.importId}`, { session: sam });
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ assemblyName: "Robot", revision: "v/v1", partCount: 3, filesStored: 1 });
    expect(detail.body.files.map((f: any) => [f.name, f.stored])).toEqual([["Robot BOM.xlsx", true], ["Robot STEP.zip", false]]);
    expect((await t.api(`/api/cad/imports/${first.body.importId}`, { session: outsider })).status).toBe(404);
  });

  it("answers a repeated idempotency key with the earlier result and changes nothing", async () => {
    const token = await link(sam);
    const before = await partRows();
    const again = await send(token, team, payload("k-2", [cad("Z")]));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, created: 1, updated: 2, markedRemoved: 1 });
    expect(await partRows()).toEqual(before);
    const count = (await t.db.execute({ sql: "SELECT COUNT(*) AS n FROM cad_imports WHERE team_id = ? AND idempotency_key = 'k-2'", args: [team] })).rows[0] as any;
    expect(Number(count.n)).toBe(1);
  });

  it("refuses a body over 12 MB with 413", async () => {
    const token = await link(sam);
    const big = JSON.stringify(payload("k-big", [cad("A")], { padding: "x".repeat(13 * 1024 * 1024) }));
    expect((await ck(`/api/integrations/control-kit/workspaces/${team}/bom`, { token, raw: big })).status).toBe(413);
  });
});

describe("Connected apps", () => {
  it("lists Control Kit while linked, and Disconnect revokes every token of the account", async () => {
    const a = await link(sam);
    const b = await link(sam);
    const list = await t.api("/api/integrations/connected-apps", { session: sam });
    expect(list.status).toBe(200);
    expect(list.body).toEqual([expect.objectContaining({ id: "control-kit", name: "Control Kit" })]);
    const r = await t.post("/api/integrations/control-kit/disconnect", {}, sam);
    expect(r.status).toBe(200);
    expect(r.body.revoked).toBeGreaterThanOrEqual(2);
    for (const token of [a, b]) expect((await ck("/api/integrations/control-kit/workspaces", { token })).status).toBe(401);
    expect((await t.api("/api/integrations/connected-apps", { session: sam })).body).toEqual([]);
    // Another account's link is untouched.
    expect((await t.api("/api/integrations/connected-apps", { session: teamless })).body).toHaveLength(1);
  });

  it("limits each token to 30 calls a minute", async () => {
    const token = await link(sam);
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await ck("/api/integrations/control-kit/workspaces", { token })).status;
    expect(last).toBe(429);
  });
});
