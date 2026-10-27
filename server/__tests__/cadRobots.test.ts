/**
 * CAD by season and robot (migration 151), part choices made in Control Point,
 * and Control Kit's read of them (contract: control-kit
 * docs/control-point-link.md v1.1, §2 "Where an import lands" and §5).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startTestServer, seedTeam, seedMember, type TestServer } from "./helpers/testServer";
import { currentSeason, effectivePart, estimateUsd, parseOnshapeAssembly, seasonName } from "../../src/types/cadBom";

vi.setConfig({ testTimeout: 60_000 });

const SECRET = "test-control-kit-secret";
const REDIRECT = "http://127.0.0.1:8787/control-point/callback";
let t: TestServer;
let team = 0;
let admin = "", student = "", lead = "";
let token = "";

async function ck(path: string, opts: { token?: string; body?: any; auth?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.auth) headers.authorization = opts.auth;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${t.base}${path}`, { method: opts.body !== undefined ? "POST" : "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const candidates = [
  { id: "gobilda:1611001408", vendor: "gobilda", sku: "1611-0014-0008", normalizedSku: "1611001408", name: "1611 Flanged Bearing (8mm REX ID) - 2 Pack", priceUsd: 5.99, unitsPerPack: 2, stock: "in", url: "https://www.gobilda.com/1611", image: null, kind: "match" },
  { id: "gobilda:1611001410", vendor: "gobilda", sku: "1611-0014-0010", normalizedSku: "1611001410", name: "1611 Flanged Bearing (10mm ID) - 2 Pack", priceUsd: 5.99, unitsPerPack: 2, stock: "in", url: "https://www.gobilda.com/1611b", image: null, kind: "near" },
];
const line = (part: string, over: Record<string, unknown> = {}) => ({
  key: `line-${part}`, identity: `doc1:ps:${part}:default`, documentId: "doc1", elementId: "ps", partId: part, configuration: "default", name: `Part ${part}`, qty: 4,
  disposition: "review", dispositionSource: "none", manualOverride: null, manualOverrideAt: null, matchStatus: "possible", vendor: "gobilda", matchNormalizedSku: "1611001408",
  sku: "1611-0014-0008", packPriceUsd: 5.99, unitsPerPack: 2, lineTotalUsd: null, stock: "in", candidates, ...over,
});
const cadPart = (part: string, over: Record<string, unknown> = {}) => ({
  name: `Part ${part}`, section: "Other", quantity: 4, source: "other", unit_cost: 0, status: "to_order", notes: "", extra: line(part, over),
});
const bundle = (key: string, element: string, parts: any[], name = "Robot") => ({
  idempotencyKey: key, source: "control-kit", bundleVersion: 2,
  assembly: { name, documentId: "doc1", elementId: element, onshapeUrl: "https://cad.onshape.com/documents/doc1", assemblyUrl: `https://cad.onshape.com/documents/doc1/w/w1/e/${element}`, documentName: "Robot" },
  revision: { type: "v", id: "v1" }, generatedAt: "2026-10-26T15:00:00.000Z", lines: [], suppressedLines: [], missingMetadataLines: [], suppressedCount: 0,
  totals: { uniqueLines: parts.length, totalInstances: 0, totalCostUsd: null, outOfStockLines: 0 }, cadParts: parts, controlPointCadUrl: "", files: [], filesNotIncluded: [],
});
const send = (body: any) => ck(`/api/integrations/control-kit/workspaces/${team}/bom`, { token, body });
const partId = async (part: string) => Number(((await t.db.execute({ sql: "SELECT id FROM cad_parts WHERE team_id = ? AND ck_part_key = ?", args: [team, `doc1:ps:${part}:default`] })).rows[0] as any).id);

beforeAll(async () => {
  t = await startTestServer("cp-cadrobots-", { CONTROL_KIT_CLIENT_SECRET: SECRET, CONTROL_KIT_REDIRECT_URIS: REDIRECT });
  team = await seedTeam(t.db, "HORS");
  const adminId = await seedMember(t.db, team, "Ada", "ada@test.local", "admin");
  const studentId = await seedMember(t.db, team, "Stu", "stu@test.local");
  const leadId = await seedMember(t.db, team, "Lee", "lee@test.local");
  // A custom role carrying the CAD permission.
  const role = Number((await t.db.execute({ sql: "INSERT INTO roles (team_id, name, color, permissions, position, is_system) VALUES (?, 'CAD lead', '#ffc700', '[\"manage_cad\"]', 5, 0)", args: [team] })).lastInsertRowid);
  await t.db.execute({ sql: "INSERT INTO member_roles (member_id, role_id) VALUES (?, ?)", args: [leadId, role] });
  admin = await t.session(adminId);
  student = await t.session(studentId);
  lead = await t.session(leadId);
  // The migration's robot for a team that already had CAD: 2025–26, main, no assembly.
  await t.db.execute({ sql: "INSERT INTO cad_robots (team_id, season, name, is_main, created_at, updated_at) VALUES (?, 2025, 'Competition robot', 1, '2026-01-01', '2026-01-01')", args: [team] });
  const r = await t.post("/api/integrations/control-kit/authorize", { state: "s", redirect_uri: REDIRECT }, admin);
  const code = new URL(r.body.redirect).searchParams.get("code");
  const ex = await ck("/api/integrations/control-kit/token", { auth: `Basic ${Buffer.from(`control-kit:${SECRET}`).toString("base64")}`, body: { grant_type: "authorization_code", code, redirect_uri: REDIRECT } });
  token = ex.body.access_token;
}, 120_000);
afterAll(async () => { await t?.stop(); });

describe("seasons and choices (pure)", () => {
  it("turns the season over in September and names it", () => {
    expect(currentSeason(new Date("2026-08-31T12:00:00Z"))).toBe(2025);
    expect(currentSeason(new Date("2026-09-01T12:00:00Z"))).toBe(2026);
    expect(seasonName(2025)).toBe("2025–26 DECODE");
    expect(seasonName(2031)).toBe("2031–32");
  });
  it("reads an Onshape assembly link, and nothing else", () => {
    expect(parseOnshapeAssembly("https://cad.onshape.com/documents/d1/w/w1/e/e1")).toMatchObject({ documentId: "d1", elementId: "e1" });
    expect(parseOnshapeAssembly("https://cad.onshape.com/documents/d1")).toBeNull();
    expect(parseOnshapeAssembly("https://evil.example/documents/d1/w/w1/e/e1")).toBeNull();
  });
  it("lets the newer of a Control Point choice and Control Kit's win", () => {
    const base = { id: 1, name: "x", quantity: 4, unit_cost: 0, source: "other", status: "to_order", ck_extra: line("A") };
    expect(effectivePart(base)).toMatchObject({ type: "review", group: "review", typeBy: "control-kit", typePending: false });
    const chosen = { ...base, choice_type: "print", choice_type_set: 1, choice_type_at: "2026-10-26T18:00:00Z" };
    expect(effectivePart(chosen)).toMatchObject({ type: "print", group: "make", typeBy: "control-point", typePending: true });
    // Control Kit carried the same choice back: no longer pending.
    expect(effectivePart({ ...chosen, ck_extra: line("A", { manualOverride: "print", manualOverrideAt: "2026-10-26T18:00:00Z", disposition: "print" }) }))
      .toMatchObject({ type: "print", typeBy: "control-kit-person", typePending: false });
    // A later choice in Control Kit wins over the older one here.
    expect(effectivePart({ ...chosen, ck_extra: line("A", { manualOverride: "cnc", manualOverrideAt: "2026-10-26T19:00:00Z", disposition: "cnc" }) }))
      .toMatchObject({ type: "cnc", typeBy: "control-kit-person" });
    // A hand-made row: its source stands for the type.
    expect(effectivePart({ id: 2, name: "Bracket", quantity: 2, unit_cost: 3, source: "printed", status: "to_order", ck_extra: null })).toMatchObject({ type: "print", typeBy: "manual-row", totalUsd: 6 });
  });
  it("estimates whole packs only when the pack is known", () => {
    expect(estimateUsd(candidates[0] as any, 5)).toBeCloseTo(17.97);
    expect(estimateUsd({ ...candidates[0], unitsPerPack: null } as any, 5)).toBeNull();
  });
});

describe("robots by season", () => {
  it("lands the first send on the latest season's main robot and links its assembly", async () => {
    const r = await send(bundle("k1", "asm1", [cadPart("A"), cadPart("B"), cadPart("C", { disposition: "hardware", matchStatus: "unmatched", candidates: [] })]));
    expect(r.status).toBe(200);
    expect(r.body.robot).toMatchObject({ name: "Competition robot", season: 2025 });
    expect(r.body.url).toBe(`${t.base}/cad/robots/${r.body.robot.id}?import=${r.body.importId}`);
    const robot = (await t.db.execute({ sql: "SELECT * FROM cad_robots WHERE id = ?", args: [r.body.robot.id] })).rows[0] as any;
    expect([robot.document_id, robot.element_id]).toEqual(["doc1", "asm1"]);
    // Every line arrives, not a slice.
    const rows = (await t.db.execute({ sql: "SELECT robot_id FROM cad_parts WHERE team_id = ? AND ck_part_key IS NOT NULL", args: [team] })).rows as any[];
    expect(rows.map((x) => Number(x.robot_id))).toEqual([r.body.robot.id, r.body.robot.id, r.body.robot.id]);
  });
  it("gives another assembly a new robot in the current season", async () => {
    const r = await send(bundle("k2", "asm2", [cadPart("Z")], "Practice bot"));
    expect(r.body.robot).toMatchObject({ name: "Practice bot", season: currentSeason() });
  });
  it("lists seasons newest first with each robot's BOM counts", async () => {
    const r = await t.api("/api/cad/robots", { session: student });
    expect(r.status).toBe(200);
    expect(r.body.canManage).toBe(false);
    const seasons = r.body.seasons.map((s: any) => s.season);
    expect(seasons[0]).toBe(currentSeason());
    expect(seasons).toContain(2025);
    const comp = r.body.seasons.find((s: any) => s.season === 2025).robots[0];
    expect(comp.bom.counts).toMatchObject({ review: 2, hardware: 1 });
    expect(comp.lastImport).toMatchObject({ sentBy: "Ada" });
  });
  it("puts a hand-made part on the robot it names, else the latest main robot", async () => {
    const list = (await t.api("/api/cad/robots", { session: admin })).body;
    const comp = list.seasons.find((s: any) => s.season === 2025).robots[0];
    const made = await t.post("/api/cad/parts", { name: "Bumper", quantity: 1, source: "printed", robot_id: comp.id }, admin);
    expect(made.status).toBe(200);
    const row = (await t.db.execute({ sql: "SELECT robot_id FROM cad_parts WHERE id = ?", args: [made.body.id] })).rows[0] as any;
    expect(Number(row.robot_id)).toBe(comp.id);
    const detail = await t.api(`/api/cad/robots/${comp.id}`, { session: student });
    expect(detail.body.parts.map((p: any) => p.name)).toContain("Bumper");
    expect(detail.body.robot.seasonName).toBe("2025–26 DECODE");
  });
  it("lets only manage_cad move a robot to another season, keeping a main robot in each", async () => {
    const list = (await t.api("/api/cad/robots", { session: admin })).body;
    const practice = list.seasons.find((s: any) => s.season === currentSeason()).robots[0];
    expect((await t.patch(`/api/cad/robots/${practice.id}`, { season: 2025 }, student)).status).toBe(403);
    expect((await t.patch(`/api/cad/robots/${practice.id}`, { season: 2025 }, lead)).status).toBe(200);
    const mains = (await t.db.execute({ sql: "SELECT COUNT(*) AS n FROM cad_robots WHERE team_id = ? AND season = 2025 AND is_main = 1", args: [team] })).rows[0] as any;
    expect(Number(mains.n)).toBe(1);
    expect((await t.patch(`/api/cad/robots/${practice.id}`, { assemblyUrl: "https://example.com/x" }, lead)).status).toBe(400);
  });
});

describe("choices made in Control Point", () => {
  it("needs the CAD permission", async () => {
    const id = await partId("A");
    expect((await t.post(`/api/cad/parts/${id}/choice`, { type: "print" }, student)).status).toBe(403);
    const r = await t.post(`/api/cad/parts/${id}/choice`, { type: "print" }, lead);
    expect(r.status).toBe(200);
    expect(r.body.effective).toMatchObject({ type: "print", typeBy: "control-point", typePending: true });
  });
  it("takes only one of the part's own products, and picking one means buying it", async () => {
    const id = await partId("B");
    expect((await t.post(`/api/cad/parts/${id}/choice`, { product: "rev:REV311152" }, lead)).status).toBe(400);
    const r = await t.post(`/api/cad/parts/${id}/choice`, { product: "gobilda:1611001410" }, lead);
    expect(r.status).toBe(200);
    expect(r.body.effective).toMatchObject({ type: "buy", product: { id: "gobilda:1611001410" }, productBy: "control-point", productPending: true });
    const history = await t.api(`/api/cad/parts/${id}/choices`, { session: student });
    expect(history.body.map((h: any) => h.kind).sort()).toEqual(["product", "type"]);
  });
  it("hands Control Kit the choices for a document, and a re-send keeps them", async () => {
    const d = await ck(`/api/integrations/control-kit/workspaces/${team}/decisions?document=doc1`, { token });
    expect(d.status).toBe(200);
    const byId = Object.fromEntries(d.body.decisions.map((x: any) => [x.identity, x]));
    expect(byId["doc1:ps:A:default"].type).toMatchObject({ value: "print", by: "Lee" });
    expect(byId["doc1:ps:B:default"].product).toMatchObject({ vendor: "gobilda", normalizedSku: "1611001410", by: "Lee" });
    expect(byId["doc1:ps:B:default"].type).toMatchObject({ value: "buy" });
    expect((await ck(`/api/integrations/control-kit/workspaces/${team}/decisions`, { token })).status).toBe(400);
    // Control Kit picked A's choice up and sends again: the choice stays and is no longer pending.
    const at = byId["doc1:ps:A:default"].type.at;
    const again = await send(bundle("k3", "asm1", [cadPart("A", { disposition: "print", manualOverride: "print", manualOverrideAt: at }), cadPart("B"), cadPart("C", { disposition: "hardware" })]));
    expect(again.status).toBe(200);
    const row = (await t.db.execute({ sql: "SELECT choice_type, choice_type_set FROM cad_parts WHERE id = ?", args: [await partId("A")] })).rows[0] as any;
    expect([row.choice_type, Number(row.choice_type_set)]).toEqual(["print", 1]);
    const detail = await t.api(`/api/cad/robots/${again.body.robot.id}`, { session: student });
    const a = detail.body.parts.find((p: any) => p.ck_part_key === "doc1:ps:A:default");
    expect(a.effective).toMatchObject({ type: "print", typePending: false });
  });
});
