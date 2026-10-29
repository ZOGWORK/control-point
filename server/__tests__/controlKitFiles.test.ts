/**
 * Control Kit link v1.2 (contract: control-kit docs/control-point-link.md §6 and §7): files uploaded after a send, part
 * pictures, and AI review answered with Control Point's own keys. The models are a fake on loopback.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { startTestServer, seedTeam, seedMember, type TestServer } from "./helpers/testServer";
import { checkReviewAsk, runReview, ReviewError } from "../controlKitAi";
import { uploadName, withUploadedFile } from "../controlKitLink";

vi.setConfig({ testTimeout: 60_000 });

const SECRET = "test-control-kit-secret";
const REDIRECT = "http://127.0.0.1:8787/control-point/callback";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const PNG = (fill: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`IHDR-${fill}-pixels`)]);

let t: TestServer;
let models: import("node:http").Server;
let team = 0, other = 0;
let sam = "", olive = "";
/** What the fake models answer next, and what they were asked. */
let gemini: { status: number; text?: string } = { status: 200 };
let anthropic: { status: number; text?: string } = { status: 200 };
const asked: string[] = [];

async function ck(path: string, opts: { method?: string; token?: string; body?: any; raw?: Buffer; type?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.raw) headers["content-type"] = opts.type ?? "application/zip";
  const res = await fetch(`${t.base}${path}`, { method: opts.method || (opts.body !== undefined || opts.raw ? "POST" : "GET"), headers, body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  let body: any = null;
  try { body = await res.json(); } catch { /* none */ }
  return { status: res.status, body, headers: res.headers };
}
async function link(session: string) {
  const r = await t.post("/api/integrations/control-kit/authorize", { state: "s", redirect_uri: REDIRECT }, session);
  const code = new URL(r.body.redirect).searchParams.get("code")!;
  const auth = `Basic ${Buffer.from(`control-kit:${SECRET}`).toString("base64")}`;
  const res = await fetch(`${t.base}/api/integrations/control-kit/token`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: REDIRECT }) });
  return (await res.json()).access_token as string;
}
const cad = (part: string) => ({
  name: `Part ${part}`, section: "Other", quantity: 1, source: "other", unit_cost: 0, status: "to_order", notes: "",
  extra: { key: `line-${part}`, identity: `doc9:ps:${part}:default`, documentId: "doc9", elementId: "ps", partId: part, configuration: "default" },
});
const payload = (key: string, over: Record<string, unknown> = {}) => ({
  idempotencyKey: key, source: "control-kit", bundleVersion: 2,
  assembly: { name: "Drive", documentId: "doc9", elementId: "asm9", onshapeUrl: "https://cad.onshape.com/documents/doc9", assemblyUrl: "https://cad.onshape.com/documents/doc9/w/w1/e/asm9", documentName: "Drive" },
  revision: { type: "m", id: "m1" }, generatedAt: "2026-10-28T10:00:00.000Z", lines: [], suppressedLines: [], missingMetadataLines: [], suppressedCount: 0,
  totals: { uniqueLines: 2, totalInstances: 2, totalCostUsd: null, outOfStockLines: 0 }, cadParts: [cad("A"), cad("B")],
  controlPointCadUrl: "https://tryctrlpoint.org/cad-parts",
  files: [{ name: "Drive STEP.zip", mediaType: "application/zip", sizeBytes: 9, sha256: "ab".repeat(32), delivery: "reference", reason: "Uploaded after this bundle." }],
  filesNotIncluded: [], ...over,
});
const review = (lines = 1) => ({
  instructions: "Review these parts. Answer JSON.", schema: { type: "object" }, geminiSchema: { type: "object" },
  request: { version: 1, assembly: "Drive", leftOut: 0, lines: Array.from({ length: lines }, (_, i) => ({ id: `L${i}`, name: `Part ${i}`, description: null, material: null, partNumber: null, quantity: 1,
    candidates: [{ id: "gobilda:1611001408", vendor: "gobilda", sku: "1611-0014-0008", name: "Bearing" }] })) },
});

beforeAll(async () => {
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.post(/\/models\/[^/]+:generateContent$/, (req, res) => {
    asked.push(`gemini ${req.headers["x-goog-api-key"]}`);
    if (gemini.status !== 200) { res.status(gemini.status).json({ error: "x" }); return; }
    res.json({ candidates: [{ content: { parts: [{ text: gemini.text ?? JSON.stringify({ items: [{ id: "L0", disposition: "buy", candidateId: "gobilda:1611001408", confidence: 0.9, reason: "A bearing" }] }) }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
  });
  app.post("/messages", (req, res) => {
    asked.push(`anthropic ${req.headers["x-api-key"]} ${req.body?.output_config?.format?.type}`);
    if (anthropic.status !== 200) { res.status(anthropic.status).json({ error: "x" }); return; }
    res.json({ stop_reason: "end_turn", content: [{ type: "text", text: anthropic.text ?? JSON.stringify({ items: [{ id: "L0", disposition: "print", candidateId: null, confidence: 0.7, reason: "Team part" }] }) }],
      usage: { input_tokens: 11, output_tokens: 6 } });
  });
  models = app.listen(0);
  await new Promise((r) => models.once("listening", r));
  const modelBase = `http://127.0.0.1:${(models.address() as AddressInfo).port}`;
  t = await startTestServer("cp-ckfiles-", {
    CONTROL_KIT_CLIENT_SECRET: SECRET, CONTROL_KIT_REDIRECT_URIS: REDIRECT, CONTROL_KIT_REPLAY_WAIT_MS: "300",
    GEMINI_API_KEY: "g-key", ANTHROPIC_API_KEY: "a-key", GEMINI_API_BASE: modelBase, ANTHROPIC_API_BASE: modelBase,
  });
  team = await seedTeam(t.db, "Files Team");
  other = await seedTeam(t.db, "Other Team");
  sam = await t.session(await seedMember(t.db, team, "Sam", "sam@files.local"));
  olive = await t.session(await seedMember(t.db, other, "Olive", "olive@files.local"));
}, 120_000);
afterAll(async () => { await t?.stop(); models?.close(); });

describe("helpers", () => {
  it("takes plain file names only", () => {
    expect(uploadName("Drive STEP.zip")).toBe("Drive STEP.zip");
    expect(uploadName("../x.zip")).toBeNull();
    expect(uploadName("a\\b.zip")).toBeNull();
    expect(uploadName("x".repeat(161))).toBeNull();
  });
  it("puts an upload in place of its own entry or the placeholder it fills", () => {
    const up = { name: "Drive STEP.zip", stored: true, url: "/api/files/9" };
    expect(withUploadedFile([{ name: "Drive STEP.zip", stored: false }], up)).toEqual([up]);
    expect(withUploadedFile([{ name: "a.xlsx", stored: true }, { name: "STEP files", stored: false, note: "Not exported" }], up)).toEqual([{ name: "a.xlsx", stored: true }, up]);
    expect(withUploadedFile([{ name: "a.xlsx", stored: true }], up)).toEqual([{ name: "a.xlsx", stored: true }, up]);
    // A full list refuses a new name instead of dropping an entry; replacing one still works.
    const full = Array.from({ length: 40 }, (_, i) => ({ name: `f${i}.xlsx`, stored: true }));
    expect(withUploadedFile(full, up)).toBeNull();
    expect(withUploadedFile(full, { name: "f3.xlsx", stored: true, url: "/api/files/1" })).toHaveLength(40);
  });
  it("accepts only a review of the documented shape", () => {
    expect(checkReviewAsk(review()).ok).toBe(true);
    expect(checkReviewAsk({ ...review(), request: { ...review().request, version: 2 } }).ok).toBe(false);
    expect(checkReviewAsk(review(151)).ok).toBe(false);
    expect(checkReviewAsk({ ...review(), instructions: "x".repeat(8001) }).ok).toBe(false);
    expect(checkReviewAsk({ ...review(), request: { ...review().request, lines: [{ id: "L0", name: "x", candidates: "nope" }] } }).ok).toBe(false);
  });
  it("fails over to Anthropic once on Gemini's rate limit, never on a rejected key", async () => {
    const env = { GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" };
    const ask = (checkReviewAsk(review()) as any).ask;
    const calls: string[] = [];
    const fake = (gStatus: number) => (async (url: string) => {
      calls.push(String(url).includes("generateContent") ? "gemini" : "anthropic");
      if (String(url).includes("generateContent")) return new Response("{}", { status: gStatus });
      return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: '{"items":[]}' }], usage: {} });
    }) as unknown as typeof fetch;
    expect((await runReview(env, ask, fake(429))).provider).toBe("anthropic");
    expect(calls).toEqual(["gemini", "anthropic"]);
    calls.length = 0;
    await expect(runReview(env, ask, fake(403))).rejects.toBeInstanceOf(ReviewError);
    expect(calls).toEqual(["gemini"]);
    await expect(runReview({}, ask, fake(200))).rejects.toMatchObject({ status: 501 });
  });
  it("treats a body that breaks off, or is not the provider's JSON, as a failure worth failing over for", async () => {
    const env = { GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" };
    const ask = (checkReviewAsk(review()) as any).ask;
    const calls: string[] = [];
    const broken = (kind: "drop" | "html") => (async (url: string) => {
      const gemini = String(url).includes("generateContent");
      calls.push(gemini ? "gemini" : "anthropic");
      if (!gemini) return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: '{"items":[]}' }], usage: {} });
      if (kind === "html") return new Response("<html>proxy</html>", { status: 200 });
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"candi')); c.error(new TypeError("terminated")); } }), { status: 200 });
    }) as unknown as typeof fetch;
    expect((await runReview(env, ask, broken("drop"))).provider).toBe("anthropic");
    expect((await runReview(env, ask, broken("html"))).provider).toBe("anthropic");
    expect(calls).toEqual(["gemini", "anthropic", "gemini", "anthropic"]);
    // A refusal whose body then breaks off is still a refusal: no switch to Anthropic.
    calls.length = 0;
    const refusedThenDropped = (async (url: string) => {
      calls.push(String(url).includes("generateContent") ? "gemini" : "anthropic");
      return new Response(new ReadableStream({ start(c) { c.error(new TypeError("terminated")); } }), { status: 403 });
    }) as unknown as typeof fetch;
    await expect(runReview(env, ask, refusedThenDropped)).rejects.toMatchObject({ status: 502, failover: false });
    expect(calls).toEqual(["gemini"]);
  });
});

describe("files after a send", () => {
  let token = "";
  let importId = 0;
  let robotId = 0;
  const upload = (bytes: Buffer, name: string, opts: { type?: string; hash?: string; ws?: number; id?: number; tok?: string } = {}) =>
    ck(`/api/integrations/control-kit/workspaces/${opts.ws ?? team}/imports/${opts.id ?? importId}/files?name=${encodeURIComponent(name)}`,
      { token: opts.tok ?? token, raw: bytes, type: opts.type ?? "application/zip", headers: { "x-content-sha256": opts.hash ?? sha(bytes) } });
  beforeAll(async () => {
    token = await link(sam);
    const sent = await ck(`/api/integrations/control-kit/workspaces/${team}/bom`, { token, body: payload("files-1") });
    expect(sent.status).toBe(200);
    importId = sent.body.importId;
    robotId = sent.body.robot.id;
  });

  it("stores the STEP zip in place of the reference, as a CAD doc of the import's robot, downloadable from Control Point", async () => {
    const zip = Buffer.from("PK\u0003\u0004 step files");
    const r = await upload(zip, "Drive STEP.zip");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: "Drive STEP.zip", sizeBytes: zip.length, duplicate: false });
    const detail = await t.api(`/api/cad/robots/${robotId}`, { session: sam });
    expect(detail.body.imports[0].files).toEqual([expect.objectContaining({ name: "Drive STEP.zip", stored: true, url: r.body.url, sizeBytes: zip.length })]);
    const doc = (await t.db.execute({ sql: "SELECT robot_id, ck_import_id FROM cad_docs WHERE url = ?", args: [r.body.url] })).rows[0] as any;
    expect(doc).toMatchObject({ robot_id: robotId, ck_import_id: importId });
    const file = await fetch(`${t.base}${r.body.url}`, { headers: { cookie: `cp_session=${encodeURIComponent(sam)}` } });
    // Served as an attachment (a zip never renders inline), byte for byte.
    expect(file.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(Buffer.from(await file.arrayBuffer()).equals(zip)).toBe(true);
    // The same bytes again change nothing; new bytes replace the file and remove the old one.
    expect((await upload(zip, "Drive STEP.zip")).body).toMatchObject({ duplicate: true, url: r.body.url });
    const zip2 = Buffer.from("PK\u0003\u0004 newer step files");
    const again = await upload(zip2, "Drive STEP.zip");
    expect(again.body).toMatchObject({ duplicate: false });
    expect(again.body.url).not.toBe(r.body.url);
    const docs = (await t.db.execute({ sql: "SELECT url FROM cad_docs WHERE ck_import_id = ?", args: [importId] })).rows.map((x: any) => x.url);
    expect(docs).toEqual([again.body.url]);
  });

  it("adds a workbook beside it and fills a labelled placeholder", async () => {
    const sent = await ck(`/api/integrations/control-kit/workspaces/${team}/bom`, { token, body: payload("files-2", { files: [], filesNotIncluded: [{ name: "Excel BOM", reason: "Could not be built" }, { name: "STEP files (.zip)", reason: "Not exported" }] }) });
    const book = Buffer.from("xlsx bytes");
    const r = await upload(book, "Drive BOM.xlsx", { type: XLSX, id: sent.body.importId });
    expect(r.status).toBe(200);
    const detail = await t.api(`/api/cad/imports/${sent.body.importId}`, { session: sam });
    expect(detail.body.files.map((f: any) => [f.name, f.stored])).toEqual([["Drive BOM.xlsx", true], ["STEP files (.zip)", false]]);
    expect(detail.body.filesStored).toBe(1);
  });

  it("refuses a wrong checksum, a mismatched type, another workspace's import, and an unknown token", async () => {
    const zip = Buffer.from("PK zip");
    expect((await upload(zip, "x.zip", { hash: "00".repeat(32) })).body).toMatchObject({ error: "checksum_mismatch" });
    expect((await upload(zip, "x.zip", { type: "text/html" })).status).toBe(415);
    expect((await upload(zip, "x.exe")).status).toBe(415);
    expect((await upload(zip, "x.zip", { ws: other })).body).toMatchObject({ error: "not_member" });
    const oliveToken = await link(olive);
    expect((await upload(zip, "x.zip", { ws: other, tok: oliveToken })).status).toBe(404);
    expect((await upload(zip, "x.zip", { tok: "ckp_nope" })).status).toBe(401);
  });

  it("stores part pictures by identity and revision key, skips what it already holds, and lists them", async () => {
    const base = `/api/integrations/control-kit/workspaces/${team}/imports/${importId}/pictures`;
    expect((await ck(base, { token })).body).toEqual({ pictures: [] });
    const r = await ck(base, { token, body: { pictures: [
      { identity: "doc9:ps:A:default", key: "m:m1:aaa", contentBase64: PNG("a").toString("base64") },
      { identity: "doc9:ps:B:default", key: "m:m1:bbb", contentBase64: PNG("b").toString("base64") },
      { identity: "doc9:ps:Z:default", key: "m:m1:zzz", contentBase64: PNG("z").toString("base64") },
      { identity: "doc9:ps:A:default", key: "bad key!", contentBase64: PNG("a").toString("base64") },
      { identity: "doc9:ps:B:default", key: "m:m1:ccc", contentBase64: Buffer.from("<svg/>").toString("base64") },
    ] } });
    expect(r.body).toEqual({ stored: 2, unchanged: 0, unknown: 1, rejected: 2 });
    const list = (await ck(base, { token })).body.pictures;
    expect(list.map((p: any) => [p.identity, p.key]).sort()).toEqual([["doc9:ps:A:default", "m:m1:aaa"], ["doc9:ps:B:default", "m:m1:bbb"]]);
    const robot = await t.api(`/api/cad/robots/${robotId}`, { session: sam });
    const a = robot.body.parts.find((p: any) => p.ck_part_key === "doc9:ps:A:default");
    expect(a.ck_picture_url).toMatch(/^\/api\/files\/\d+$/);
    const png = await fetch(`${t.base}${a.ck_picture_url}`, { headers: { cookie: `cp_session=${encodeURIComponent(sam)}` } });
    expect(png.headers.get("content-type")).toBe("image/png");
    // The same key again stores nothing; a newer revision replaces the file.
    expect((await ck(base, { token, body: { pictures: [{ identity: "doc9:ps:A:default", key: "m:m1:aaa", contentBase64: PNG("a").toString("base64") }] } })).body).toMatchObject({ stored: 0, unchanged: 1 });
    expect((await ck(base, { token, body: { pictures: [{ identity: "doc9:ps:A:default", key: "m:m2:aaa", contentBase64: PNG("a2").toString("base64") }] } })).body).toMatchObject({ stored: 1 });
    const gone = (await t.db.execute({ sql: "SELECT COUNT(*) AS n FROM stored_files WHERE id = ?", args: [Number(a.ck_picture_url.split("/").pop())] })).rows[0] as any;
    expect(Number(gone.n)).toBe(0);
    // Another workspace's member can't fetch them.
    const now = (await t.api(`/api/cad/robots/${robotId}`, { session: sam })).body.parts.find((p: any) => p.ck_part_key === "doc9:ps:A:default");
    expect((await fetch(`${t.base}${now.ck_picture_url}`, { headers: { cookie: `cp_session=${encodeURIComponent(olive)}` } })).status).toBe(403);
    expect((await ck(base, { token, body: { pictures: [] } })).status).toBe(400);
    // Deleting a part takes its picture file with it.
    const pictureId = Number(now.ck_picture_url.split("/").pop());
    await t.db.execute({ sql: "UPDATE cad_parts SET ck_removed_at = ? WHERE id = ?", args: [new Date().toISOString(), now.id] });
    expect((await t.api(`/api/cad/parts/${now.id}`, { method: "DELETE", session: sam })).status).toBe(200);
    expect(Number(((await t.db.execute({ sql: "SELECT COUNT(*) AS n FROM stored_files WHERE id = ?", args: [pictureId] })).rows[0] as any).n)).toBe(0);
  });

  it("offers the newest stored STEP zip and workbook across every send, past the ten listed", async () => {
    const before = (await t.api(`/api/cad/robots/${robotId}`, { session: sam })).body.downloads;
    expect(before.step).toMatchObject({ importId, file: { name: "Drive STEP.zip" } });
    for (let i = 0; i < 11; i++) {
      const r = await ck(`/api/integrations/control-kit/workspaces/${team}/bom`, { token, body: payload(`many-${i}`, { files: [], cadParts: [cad(i % 2 ? "A" : "B")] }) });
      expect(r.status).toBe(200);
    }
    const detail = (await t.api(`/api/cad/robots/${robotId}`, { session: sam })).body;
    expect(detail.imports.some((i: any) => i.id === importId)).toBe(false);
    expect(detail.downloads.step).toMatchObject({ importId, file: { name: "Drive STEP.zip", url: before.step.file.url } });
  });
});

describe("AI review", () => {
  let token = "";
  const ask = (body: any, ws = team, tok = token) => ck(`/api/integrations/control-kit/workspaces/${ws}/ai/review`, { token: tok, body });
  beforeAll(async () => { token = await link(sam); });

  it("answers with Gemini's JSON items and usage, using the server's own key", async () => {
    gemini = { status: 200 }; asked.length = 0;
    const r = await ask(review());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ items: [{ id: "L0", disposition: "buy", candidateId: "gobilda:1611001408", confidence: 0.9, reason: "A bearing" }], provider: "gemini", usage: { inputTokens: 10, outputTokens: 5 } });
    expect(asked).toEqual(["gemini g-key"]);
  });

  it("asks Anthropic once when Gemini is rate limited, with the JSON schema format", async () => {
    gemini = { status: 429 }; anthropic = { status: 200 }; asked.length = 0;
    const r = await ask(review());
    expect(r.body).toMatchObject({ provider: "anthropic", items: [{ id: "L0", disposition: "print" }] });
    expect(asked).toEqual(["gemini g-key", "anthropic a-key json_schema"]);
  });

  it("says why when both fail, without retrying", async () => {
    gemini = { status: 503 }; anthropic = { status: 500 }; asked.length = 0;
    const r = await ask(review());
    expect(r).toMatchObject({ status: 502, body: { error: "ai_failed" } });
    expect(asked).toHaveLength(2);
    gemini = { status: 200, text: "not json" };
    expect((await ask(review())).body).toMatchObject({ items: [], provider: "gemini" });
  });

  it("refuses a bad request, another workspace, and goes over the workspace's hourly allowance with 429", async () => {
    gemini = { status: 200 };
    expect((await ask({ ...review(), request: { version: 1, lines: [] } })).body).toMatchObject({ error: "bad_payload" });
    expect((await ask(review(), other)).body).toMatchObject({ error: "not_member" });
    // Four reviews so far in this suite; the hour allows 20 per workspace. Spread over tokens so no token's own
    // 30-a-minute limit answers first.
    const tokens = [token, await link(sam), await link(sam)];
    let last: any = null;
    for (let i = 0; i < 20; i++) { last = await ask(review(), team, tokens[i % 3]); if (last.status === 429) break; }
    expect(last.status).toBe(429);
    expect(last.body).toMatchObject({ error: "rate_limited" });
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
