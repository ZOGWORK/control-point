// @vitest-environment node
/**
 * The Prints library (migration 155, server/prints.ts): names and paths, path
 * traversal, the per-file limit, the workspace quota and the disk reserve,
 * role permissions, folders (move/rename edge cases, delete with files),
 * groups (status, collections), downloads and ZIPs, the activity record, and
 * filing a Control Kit print from inside the server.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { PassThrough } from "node:stream";
import { writeFileSync } from "node:fs";
import { startTestServer, seedTeam, seedMember, type TestServer } from "./helpers/testServer";
import { withSession } from "./helpers/session";
import { cleanName, splitPath, uniqueName, printKind, safeName, matchesFilters, groupLine, folderAndBelow, type PrintFile } from "../../src/types/prints";
import { PrintStore, createPrints, controlKitPrintPath, printLimits } from "../prints";
import { crc32, writeZip, uniqueZipNames } from "../zipStream";

vi.setConfig({ testTimeout: 60_000 });

let t: TestServer;
let dir = "";
let team = 0, other = 0;
let admin = "", student = "", lead = "", outsider = "";
const MB = 1024 * 1024;

/** A tiny ASCII STL. */
const stl = (name = "cube") => Buffer.from(`solid ${name}\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid ${name}\n`);

async function uploadFile(session: string, opts: { name: string; bytes?: Buffer; folderId?: number | null; field?: string; nameField?: string; thumb?: Buffer }) {
  const form = new FormData();
  if (opts.nameField !== undefined) form.append("name", opts.nameField);
  if (opts.folderId != null) form.append("folderId", String(opts.folderId));
  form.append(opts.field ?? "file", new Blob([opts.bytes ?? stl()]), opts.name);
  if (opts.thumb) form.append("thumbnail", new Blob([opts.thumb], { type: "image/png" }), "thumb.png");
  const headers = withSession(new Headers(), session);
  const res = await fetch(`${t.base}/api/prints/files`, { method: "POST", body: form, headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const get = (path: string, session: string) => t.api(path, { session });
const del = (path: string, session: string) => t.api(path, { method: "DELETE", session });
const lib = async (session = admin) => (await get("/api/prints/library", session)).body;
const raw = async (path: string, session: string) => {
  const res = await fetch(`${t.base}${path}`, { headers: withSession(new Headers(), session) });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
};
const storedFiles = (): string[] => {
  const out: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : out.push(p); } };
  if (existsSync(join(dir, "files"))) walk(join(dir, "files"));
  return out;
};

/** Read a ZIP's central directory and inflate each entry, checking its CRC. */
function unzip(buf: Buffer): Record<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(-1);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const lnlen = buf.readUInt16LE(local + 26), lelen = buf.readUInt16LE(local + 28);
    const data = inflateRawSync(buf.subarray(local + 30 + lnlen + lelen, local + 30 + lnlen + lelen + csize));
    expect(crc32(data)).toBe(crc);
    out[name] = data;
    p += 46 + nlen + elen + clen;
  }
  return out;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "cp-prints-store-"));
  t = await startTestServer("cp-prints-", { PRINTS_DIR: dir, PRINTS_MAX_FILE_MB: "1", PRINTS_QUOTA_MB: "3", PRINTS_MIN_FREE_MB: "0" });
  team = await seedTeam(t.db, "HORS");
  other = await seedTeam(t.db, "Other");
  const adminId = await seedMember(t.db, team, "Ada", "ada@test.local", "admin");
  const studentId = await seedMember(t.db, team, "Stu", "stu@test.local");
  const leadId = await seedMember(t.db, team, "Lee", "lee@test.local");
  const outsiderId = await seedMember(t.db, other, "Otto", "otto@test.local", "admin");
  const role = Number((await t.db.execute({ sql: "INSERT INTO roles (team_id, name, color, permissions, position, is_system) VALUES (?, 'Print lead', '#ffc700', '[\"manage_prints\"]', 5, 0)", args: [team] })).lastInsertRowid);
  await t.db.execute({ sql: "INSERT INTO member_roles (member_id, role_id) VALUES (?, ?)", args: [leadId, role] });
  admin = await t.session(adminId);
  student = await t.session(studentId);
  lead = await t.session(leadId);
  outsider = await t.session(outsiderId);
}, 120_000);
afterAll(async () => { await t?.stop(); });

describe("names, paths and storage keys (pure)", () => {
  it("refuses names that could leave their folder or break an OS", () => {
    for (const bad of ["", " ", ".", "..", "../x.stl", "a/b.stl", "a\\b.stl", "C:evil.stl", "x?.stl", "bad\u0000.stl", "trailing.", "x".repeat(121)]) expect(cleanName(bad)).toBeNull();
    expect(cleanName("  Intake roller v2.stl ")).toBe("Intake roller v2.stl");
    expect(cleanName("2025–26 DECODE")).toBe("2025–26 DECODE");
  });
  it("splits a path into safe segments, and refuses traversal", () => {
    expect(splitPath("Season / Robot / Control Kit")).toEqual(["Season", "Robot", "Control Kit"]);
    expect(splitPath(["a", "..", "b"])).toBeNull();
    expect(splitPath("")).toBeNull();
    expect(safeName("Arm/Claw: v2")).toBe("Arm-Claw- v2");
    expect(safeName("..")).toBe("Untitled");
    expect(controlKitPrintPath(2025, "Bot/1")).toEqual(["2025–26 DECODE", "Bot-1", "Control Kit"]);
  });
  it("numbers a taken name, keeping the extension", () => {
    expect(uniqueName("a.stl", new Set(["a.stl"]))).toBe("a (2).stl");
    expect(uniqueName("a (2).stl", new Set(["a (2).stl", "a.stl"]))).toBe("a (3).stl");
    expect(uniqueName("A.STL", new Set(["b.stl"]))).toBe("A.STL");
  });
  it("knows the print formats by extension", () => {
    expect(["x.stl", "x.3MF", "x.step", "x.stp", "x.obj", "x.gcode", "x.bgcode"].map(printKind)).toEqual(["stl", "3mf", "step", "step", "obj", "gcode", "gcode"]);
    expect(printKind("x.exe")).toBeNull();
    expect(printKind("stl")).toBeNull();
  });
  it("never turns anything but a random key into a disk path", () => {
    const s = new PrintStore(mkdtempSync(join(tmpdir(), "cp-prints-keys-")));
    const k = s.newKey(7);
    expect(s.pathOf(k)).toContain(join("files", "7"));
    for (const bad of ["../etc/passwd", "7/../../x", "7/abc", "/7/" + "a".repeat(32), "7\\" + "a".repeat(32)]) expect(() => s.pathOf(bad)).toThrow();
  });
  it("reads the limits from the environment", () => {
    expect(printLimits({})).toEqual({ maxFile: 100 * MB, quota: 2048 * MB, minFree: 5120 * MB });
    expect(printLimits({ PRINTS_MAX_FILE_MB: "50", PRINTS_QUOTA_MB: "-1", PRINTS_MIN_FREE_MB: "0" })).toEqual({ maxFile: 50 * MB, quota: 2048 * MB, minFree: 0 });
  });
  it("combines group filters and counts what's left to print", () => {
    const f = (o: Partial<PrintFile>): PrintFile => ({ id: 1, folderId: null, name: "x.stl", kind: "stl", size: 1, createdAt: "", updatedAt: "", uploadedBy: null, notes: "", robotId: null, season: null, cadPart: null, subsystem: null, subsystemFrom: null, material: null, status: "to_print", copiesNeeded: null, copiesNeededFrom: null, copiesPrinted: 0, collections: [], hasThumb: false, source: "upload", ...o });
    const files = [f({ subsystem: "Intake", material: "PETG" }), f({ subsystem: "intake", material: "PLA" }), f({ subsystem: "Intake", material: "PETG", status: "printed" }), f({ subsystem: "Lift", material: "PETG", status: "failed" })];
    const hit = files.filter((x) => matchesFilters(x, { subsystem: "Intake", material: "PETG", status: "to_print" }));
    expect(hit).toHaveLength(1);
    expect(groupLine("Intake", files.filter((x) => matchesFilters(x, { subsystem: "INTAKE" })))).toBe("Intake · 3 files · 2 still to print");
    expect(matchesFilters(f({ name: "Roller hub.stl" }), { query: "hub roll" })).toBe(true);
    expect(folderAndBelow([{ id: 1, parentId: null, name: "a", createdAt: "", updatedAt: "" }, { id: 2, parentId: 1, name: "b", createdAt: "", updatedAt: "" }, { id: 3, parentId: 2, name: "c", createdAt: "", updatedAt: "" }], 2)).toEqual(new Set([2, 3]));
  });
  it("writes a ZIP any unzipper reads, with UTF-8 names and unique paths", async () => {
    const d = mkdtempSync(join(tmpdir(), "cp-zip-"));
    writeFileSync(join(d, "a"), "hello");
    writeFileSync(join(d, "b"), Buffer.alloc(200_000, 7));
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on("data", (c) => chunks.push(c));
    const names = uniqueZipNames(["2025–26/a.stl", "2025–26/A.stl", "b.gcode"]);
    expect(names).toEqual(["2025–26/a.stl", "2025–26/A (2).stl", "b.gcode"]);
    await writeZip(out, [{ name: names[0], path: join(d, "a"), mtime: new Date() }, { name: names[2], path: join(d, "b"), mtime: new Date() }]);
    const files = unzip(Buffer.concat(chunks));
    expect(files["2025–26/a.stl"].toString()).toBe("hello");
    expect(files["b.gcode"].length).toBe(200_000);
  });
});

describe("permissions", () => {
  it("lets every member view, and only manage_prints change", async () => {
    expect((await get("/api/prints/library", student)).status).toBe(200);
    expect((await lib(student)).canEdit).toBe(false);
    expect((await lib(lead)).canEdit).toBe(true);
    expect((await uploadFile(student, { name: "nope.stl" })).status).toBe(403);
    expect((await t.post("/api/prints/folders", { name: "Nope" }, student)).status).toBe(403);
    expect((await t.post("/api/prints/collections", { name: "Nope" }, student)).status).toBe(403);
    const up = await uploadFile(lead, { name: "lead.stl" });
    expect(up.status).toBe(200);
    expect((await t.patch(`/api/prints/files/${up.body.id}`, { status: "printed" }, student)).status).toBe(403);
    expect((await del(`/api/prints/files/${up.body.id}`, student)).status).toBe(403);
    // A member can still download it.
    const dl = await raw(`/api/prints/files/${up.body.id}/download`, student);
    expect(dl.status).toBe(200);
    expect(dl.bytes.equals(stl())).toBe(true);
    expect(dl.headers.get("content-disposition")).toContain('filename="lead.stl"');
    await del(`/api/prints/files/${up.body.id}`, lead);
  });
  it("keeps another workspace out: its ids are 404", async () => {
    const up = await uploadFile(admin, { name: "ours.stl" });
    const folder = await t.post("/api/prints/folders", { name: "Ours" }, admin);
    expect((await get(`/api/prints/files/${up.body.id}`, outsider)).status).toBe(404);
    expect((await raw(`/api/prints/files/${up.body.id}/download`, outsider)).status).toBe(404);
    expect((await t.patch(`/api/prints/files/${up.body.id}`, { name: "theirs.stl" }, outsider)).status).toBe(404);
    expect((await del(`/api/prints/folders/${folder.body.id}`, outsider)).status).toBe(404);
    expect((await raw(`/api/prints/zip?files=${up.body.id}`, outsider)).status).toBe(404);
    expect((await uploadFile(outsider, { name: "x.stl", folderId: folder.body.id })).status).toBe(404);
    expect((await t.post("/api/prints/files/bulk", { ids: [up.body.id], action: "delete" }, outsider)).status).toBe(404);
    expect((await lib(outsider)).files).toEqual([]);
    expect((await get(`/api/prints/files/${up.body.id}`, admin)).status).toBe(200);
    await del(`/api/prints/files/${up.body.id}`, admin);
    await del(`/api/prints/folders/${folder.body.id}`, admin);
  });
});

describe("uploads", () => {
  it("stores bytes under a random key whatever the name says", async () => {
    const before = storedFiles().length;
    const sneaky = await uploadFile(admin, { name: "../../../escape.stl" });
    // The browser-style name is reduced to its last part by the form, or refused.
    expect([200, 400]).toContain(sneaky.status);
    const traversal = await uploadFile(admin, { name: "ok.stl", nameField: "../../escape.stl" });
    expect(traversal.status).toBe(400);
    const after = storedFiles();
    expect(after.every((p) => p.startsWith(join(dir, "files")) && /[0-9a-f]{32}(\.thumb\.png)?$/.test(p))).toBe(true);
    expect(existsSync(join(dir, "..", "escape.stl"))).toBe(false);
    if (sneaky.status === 200) { expect(sneaky.body.name).not.toContain("/"); await del(`/api/prints/files/${sneaky.body.id}`, admin); }
    expect(storedFiles().length).toBe(before);
  });
  it("takes only print formats, and keeps UTF-8 names", async () => {
    const bad = await uploadFile(admin, { name: "virus.exe" });
    expect(bad.status).toBe(400);
    const empty = await uploadFile(admin, { name: "empty.stl", bytes: Buffer.alloc(0) });
    expect(empty.status).toBe(400);
    const ok = await uploadFile(admin, { name: "x.3mf", nameField: "Rädchen – v2.3mf", bytes: Buffer.from("PK fake 3mf") });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe("Rädchen – v2.3mf");
    await del(`/api/prints/files/${ok.body.id}`, admin);
  });
  it("refuses a file over the per-file limit", async () => {
    const big = await uploadFile(admin, { name: "big.stl", bytes: Buffer.alloc(Math.round(1.2 * MB), 1) });
    expect(big.status).toBe(413);
    expect(big.body.code).toBe("too_large");
    expect(readdirSync(join(dir, "tmp"))).toEqual([]);
  });
  it("refuses an upload past the workspace quota, counting every file", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await uploadFile(admin, { name: `fill${i}.stl`, bytes: Buffer.alloc(Math.round(0.9 * MB), 2) });
      expect(r.status).toBe(200);
      ids.push(r.body.id);
    }
    const over = await uploadFile(admin, { name: "over.stl", bytes: Buffer.alloc(Math.round(0.5 * MB), 3) });
    expect(over.status).toBe(413);
    expect(over.body.code).toBe("quota");
    expect((await lib()).usage).toMatchObject({ quota: 3 * MB, maxFile: 1 * MB });
    const r = await t.post("/api/prints/files/bulk", { ids, action: "delete" }, admin);
    expect(r.body.files).toBe(3);
    expect((await uploadFile(admin, { name: "fits.stl", bytes: Buffer.alloc(Math.round(0.5 * MB), 3) })).status).toBe(200);
    const fits = (await lib()).files.find((f: any) => f.name === "fits.stl");
    await del(`/api/prints/files/${fits.id}`, admin);
  });
  it("numbers a second upload of the same name, and keeps a PNG thumbnail", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
    const a = await uploadFile(admin, { name: "Bracket.stl", thumb: png });
    const b = await uploadFile(admin, { name: "bracket.stl" });
    expect(a.body.name).toBe("Bracket.stl");
    expect(b.body).toMatchObject({ name: "bracket (2).stl", renamed: true });
    const th = await raw(`/api/prints/files/${a.body.id}/thumbnail`, student);
    expect(th.status).toBe(200);
    expect(th.headers.get("content-type")).toBe("image/png");
    expect((await raw(`/api/prints/files/${b.body.id}/thumbnail`, admin)).status).toBe(404);
    await t.post("/api/prints/files/bulk", { ids: [a.body.id, b.body.id], action: "delete" }, admin);
  });
});

describe("folders, moves and renames", () => {
  it("keeps names unique per folder, ignoring case", async () => {
    const a = await t.post("/api/prints/folders", { name: "Intake" }, admin);
    expect(a.status).toBe(200);
    expect((await t.post("/api/prints/folders", { name: "intake" }, admin)).status).toBe(409);
    expect((await t.post("/api/prints/folders", { name: "../x" }, admin)).status).toBe(400);
    const inner = await t.post("/api/prints/folders", { name: "Intake", parentId: a.body.id }, admin);
    expect(inner.status).toBe(200);
    const deeper = await t.post("/api/prints/folders", { name: "Rollers", parentId: inner.body.id }, admin);
    // A folder can't go inside itself or anything below it.
    expect((await t.patch(`/api/prints/folders/${a.body.id}`, { parentId: a.body.id }, admin)).status).toBe(400);
    expect((await t.patch(`/api/prints/folders/${a.body.id}`, { parentId: deeper.body.id }, admin)).status).toBe(400);
    // Moving the inner "Intake" to the root collides with the outer one.
    expect((await t.patch(`/api/prints/folders/${inner.body.id}`, { parentId: null }, admin)).status).toBe(409);
    expect((await t.patch(`/api/prints/folders/${inner.body.id}`, { parentId: null, name: "Intake 2" }, admin)).status).toBe(200);
    // Into a folder that doesn't exist: 404, nothing changes.
    expect((await t.patch(`/api/prints/folders/${inner.body.id}`, { parentId: 999999 }, admin)).status).toBe(404);
    const l = await lib();
    expect(l.folders.find((f: any) => f.id === inner.body.id)).toMatchObject({ parentId: null, name: "Intake 2" });
    expect(l.folders.find((f: any) => f.id === deeper.body.id)).toMatchObject({ parentId: inner.body.id });
    for (const id of [a.body.id, inner.body.id]) await del(`/api/prints/folders/${id}`, admin);
  });
  it("moves a file into a folder with the same name as '(2)', and refuses a rename that collides", async () => {
    const f = await t.post("/api/prints/folders", { name: "Lift" }, admin);
    const inside = await uploadFile(admin, { name: "spool.stl", folderId: f.body.id });
    const outside = await uploadFile(admin, { name: "spool.stl" });
    const moved = await t.patch(`/api/prints/files/${outside.body.id}`, { folderId: f.body.id }, admin);
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ folderId: f.body.id, name: "spool (2).stl" });
    expect((await t.patch(`/api/prints/files/${moved.body.id}`, { name: "SPOOL.stl" }, admin)).status).toBe(409);
    expect((await t.patch(`/api/prints/files/${moved.body.id}`, { name: "spool.step" }, admin)).status).toBe(400);
    expect((await t.patch(`/api/prints/files/${moved.body.id}`, { name: "a/b.stl" }, admin)).status).toBe(400);
    expect((await t.patch(`/api/prints/files/${moved.body.id}`, { name: "spool spare.stl" }, admin)).body.name).toBe("spool spare.stl");
    // Bulk move back to the root: no collision now.
    const back = await t.post("/api/prints/files/bulk", { ids: [inside.body.id, moved.body.id], action: "move", folderId: null }, admin);
    expect(back.status).toBe(200);
    const names = (await lib()).files.filter((x: any) => x.folderId === null).map((x: any) => x.name).sort();
    expect(names).toEqual(expect.arrayContaining(["spool spare.stl", "spool.stl"]));
    await t.post("/api/prints/files/bulk", { ids: [inside.body.id, moved.body.id], action: "delete" }, admin);
    await del(`/api/prints/folders/${f.body.id}`, admin);
  });
  it("asks before deleting a folder that holds files, says how many, then removes their bytes", async () => {
    const top = await t.post("/api/prints/folders", { name: "Old season" }, admin);
    const sub = await t.post("/api/prints/folders", { name: "Arm", parentId: top.body.id }, admin);
    await uploadFile(admin, { name: "a.stl", folderId: top.body.id });
    await uploadFile(admin, { name: "b.stl", folderId: sub.body.id });
    const before = storedFiles().length;
    const ask = await del(`/api/prints/folders/${top.body.id}`, admin);
    expect(ask.status).toBe(409);
    expect(ask.body).toMatchObject({ files: 2, folders: 1 });
    // A stale confirmation (someone added a file since) asks again.
    expect((await del(`/api/prints/folders/${top.body.id}?files=1`, admin)).status).toBe(409);
    const ok = await del(`/api/prints/folders/${top.body.id}?files=2`, admin);
    expect(ok.body).toMatchObject({ success: true, files: 2 });
    expect(storedFiles().length).toBe(before - 2);
    const l = await lib();
    expect(l.folders.some((f: any) => f.id === top.body.id || f.id === sub.body.id)).toBe(false);
    // An empty folder goes without asking.
    const empty = await t.post("/api/prints/folders", { name: "Empty" }, admin);
    expect((await del(`/api/prints/folders/${empty.body.id}`, admin)).status).toBe(200);
  });
});

describe("review fixes", () => {
  it("moves a file onto a same-named one as '(2)' with the bulk move the page uses", async () => {
    const f = await t.post("/api/prints/folders", { name: "Drop target" }, admin);
    await uploadFile(admin, { name: "a.stl", folderId: f.body.id });
    const outside = await uploadFile(admin, { name: "a.stl" });
    const r = await t.post("/api/prints/files/bulk", { ids: [outside.body.id], action: "move", folderId: f.body.id }, admin);
    expect(r.status).toBe(200);
    expect(r.body.files).toBe(1);
    const names = (await lib()).files.filter((x: any) => x.folderId === f.body.id).map((x: any) => x.name).sort();
    expect(names).toEqual(["a (2).stl", "a.stl"]);
    // Moves, uploads and new folders into a folder that is gone are refused.
    await del(`/api/prints/folders/${f.body.id}?files=2`, admin);
    const loose = await uploadFile(admin, { name: "loose.stl" });
    expect((await t.post("/api/prints/files/bulk", { ids: [loose.body.id], action: "move", folderId: f.body.id }, admin)).status).toBe(404);
    expect((await t.patch(`/api/prints/files/${loose.body.id}`, { folderId: f.body.id }, admin)).status).toBe(404);
    expect((await uploadFile(admin, { name: "late.stl", folderId: f.body.id })).status).toBe(404);
    expect((await t.post("/api/prints/folders", { name: "Child", parentId: f.body.id }, admin)).status).toBe(404);
    await del(`/api/prints/files/${loose.body.id}`, admin);
  });
  it("fills the copies printed when one file is marked printed", async () => {
    const f = await uploadFile(admin, { name: "four.stl" });
    await t.patch(`/api/prints/files/${f.body.id}`, { copiesNeeded: 4, copiesPrinted: 1 }, admin);
    const r = await t.patch(`/api/prints/files/${f.body.id}`, { status: "printed" }, admin);
    expect(r.body).toMatchObject({ status: "printed", copiesPrinted: 4 });
    await del(`/api/prints/files/${f.body.id}`, admin);
  });
  it("refuses a write meant for another workspace (a request sent before a workspace switch)", async () => {
    const r = await t.api("/api/prints/folders", { method: "POST", body: JSON.stringify({ name: "Stale" }), session: admin, headers: { "x-cp-prints-team": String(other) } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("workspace_changed");
    const ok = await t.api("/api/prints/folders", { method: "POST", body: JSON.stringify({ name: "Fresh" }), session: admin, headers: { "x-cp-prints-team": String(team) } });
    expect(ok.status).toBe(200);
    expect((await lib()).teamId).toBe(team);
    await del(`/api/prints/folders/${ok.body.id}`, admin);
  });
  it("counts thumbnails in the quota", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100_000)]);
    const before = (await lib()).usage.used;
    const f = await uploadFile(admin, { name: "thumbed.stl", thumb: png });
    expect((await lib()).usage.used - before).toBe(stl().length + png.length);
    await del(`/api/prints/files/${f.body.id}`, admin);
  });
});

describe("groups, details and downloads", () => {
  it("files one print in several collections without copying it, and marks a selection printed", async () => {
    const a = await uploadFile(admin, { name: "hub.stl" });
    const b = await uploadFile(admin, { name: "roller.stl" });
    const spares = await t.post("/api/prints/collections", { name: "Comp spares" }, admin);
    const worlds = await t.post("/api/prints/collections", { name: "Worlds kit" }, admin);
    expect((await t.post("/api/prints/collections", { name: "comp SPARES" }, admin)).status).toBe(409);
    await t.post("/api/prints/files/bulk", { ids: [a.body.id, b.body.id], action: "collect", collectionId: spares.body.id }, admin);
    await t.post("/api/prints/files/bulk", { ids: [a.body.id], action: "collect", collectionId: worlds.body.id }, admin);
    await t.patch(`/api/prints/files/${a.body.id}`, { subsystem: "Intake", material: "petg", copiesNeeded: 4, notes: "Print at 40% infill" }, admin);
    let l = await lib();
    const hub = l.files.find((f: any) => f.id === a.body.id);
    expect(hub).toMatchObject({ subsystem: "Intake", subsystemFrom: "manual", material: "PETG", copiesNeeded: 4, copiesNeededFrom: "manual", notes: "Print at 40% infill", status: "to_print" });
    expect(hub.collections.sort()).toEqual([spares.body.id, worlds.body.id].sort());
    expect(l.collections.find((c: any) => c.id === spares.body.id).files).toBe(2);
    expect(storedFiles().filter((p) => !p.endsWith(".thumb.png")).length).toBe(l.files.length);
    // Marking printed counts every copy needed.
    await t.post("/api/prints/files/bulk", { ids: [a.body.id, b.body.id], action: "status", status: "printed" }, admin);
    l = await lib();
    expect(l.files.find((f: any) => f.id === a.body.id)).toMatchObject({ status: "printed", copiesPrinted: 4 });
    expect(l.files.find((f: any) => f.id === b.body.id)).toMatchObject({ status: "printed", copiesPrinted: 0 });
    await t.post("/api/prints/files/bulk", { ids: [b.body.id], action: "status", status: "failed" }, admin);
    // Reaching the copies needed by hand marks it printed.
    await t.patch(`/api/prints/files/${a.body.id}`, { status: "to_print", copiesPrinted: 0 }, admin);
    const back = await t.patch(`/api/prints/files/${a.body.id}`, { copiesPrinted: 4 }, admin);
    expect(back.body.status).toBe("printed");
    // Deleting a collection keeps the files.
    await del(`/api/prints/collections/${worlds.body.id}`, admin);
    l = await lib();
    expect(l.files.find((f: any) => f.id === a.body.id).collections).toEqual([spares.body.id]);
    // Every change is recorded.
    const act = (await get(`/api/prints/activity?file=${a.body.id}`, student)).body;
    expect(act.map((x: any) => x.action)).toEqual(expect.arrayContaining(["upload", "collect", "edit", "status"]));
    expect(act[0].by).toBe("Ada");
    await t.post("/api/prints/files/bulk", { ids: [a.body.id, b.body.id], action: "delete" }, admin);
    await del(`/api/prints/collections/${spares.body.id}`, admin);
  });
  it("links a CAD part: its section is the subsystem and its quantity the copies needed", async () => {
    const robot = Number((await t.db.execute({ sql: "INSERT INTO cad_robots (team_id, season, name, is_main, created_at, updated_at) VALUES (?, 2025, 'Comp bot', 1, 'x', 'x')", args: [team] })).lastInsertRowid);
    const part = Number((await t.db.execute({ sql: "INSERT INTO cad_parts (team_id, name, section, quantity, source, unit_cost, status, notes, created_at, updated_at, robot_id) VALUES (?, 'Roller hub', 'Intake', 6, 'printed', 0, 'to_order', '', 'x', 'x', ?)", args: [team, robot] })).lastInsertRowid);
    const otherPart = Number((await t.db.execute({ sql: "INSERT INTO cad_parts (team_id, name, section, quantity, source, unit_cost, status, notes, created_at, updated_at) VALUES (?, 'Theirs', 'Lift', 1, 'printed', 0, 'to_order', '', 'x', 'x')", args: [other] })).lastInsertRowid);
    const f = await uploadFile(admin, { name: "roller hub.stl" });
    expect((await t.patch(`/api/prints/files/${f.body.id}`, { cadPartId: otherPart }, admin)).status).toBe(404);
    const r = await t.patch(`/api/prints/files/${f.body.id}`, { cadPartId: part }, admin);
    expect(r.body).toMatchObject({ robotId: robot, season: 2025, subsystem: "Intake", subsystemFrom: "cad", copiesNeeded: 6, copiesNeededFrom: "cad", cadPart: { id: part, name: "Roller hub" } });
    const own = await t.patch(`/api/prints/files/${f.body.id}`, { subsystem: "Outtake" }, admin);
    expect(own.body).toMatchObject({ subsystem: "Outtake", subsystemFrom: "manual" });
    expect((await t.patch(`/api/prints/files/${f.body.id}`, { season: 1990 }, admin)).status).toBe(400);
    await del(`/api/prints/files/${f.body.id}`, admin);
  });
  it("zips a folder with its subfolders, and a group's chosen files in their folders", async () => {
    const top = await t.post("/api/prints/folders", { name: "2025–26 DECODE" }, admin);
    const sub = await t.post("/api/prints/folders", { name: "Intake", parentId: top.body.id }, admin);
    const a = await uploadFile(admin, { name: "a.stl", folderId: top.body.id, bytes: stl("a") });
    const b = await uploadFile(admin, { name: "b.gcode", folderId: sub.body.id, bytes: Buffer.from("G28\nG1 X10\n") });
    const z = await raw(`/api/prints/zip?folder=${top.body.id}`, student);
    expect(z.status).toBe(200);
    expect(z.headers.get("content-disposition")).toContain("filename*=UTF-8''2025%E2%80%9326%20DECODE.zip");
    const files = unzip(z.bytes);
    expect(Object.keys(files).sort()).toEqual(["Intake/b.gcode", "a.stl"]);
    expect(files["a.stl"].equals(stl("a"))).toBe(true);
    const g = await raw(`/api/prints/zip?files=${a.body.id},${b.body.id}&name=Intake`, student);
    expect(Object.keys(unzip(g.bytes)).sort()).toEqual(["2025–26 DECODE/Intake/b.gcode", "2025–26 DECODE/a.stl"]);
    expect(g.headers.get("content-disposition")).toContain('filename="Intake.zip"');
    const emptyFolder = await t.post("/api/prints/folders", { name: "Nothing" }, admin);
    expect((await raw(`/api/prints/zip?folder=${emptyFolder.body.id}`, admin)).status).toBe(404);
    await del(`/api/prints/folders/${top.body.id}?files=2`, admin);
    await del(`/api/prints/folders/${emptyFolder.body.id}`, admin);
  });
});

describe("filing a Control Kit print from inside the server", () => {
  it("files under Season / Robot / Control Kit, links the part, and replaces its own earlier send", async () => {
    // The test process builds its own Prints module on the same database and storage, as server.ts does.
    const norm = (a: any[]) => a.map((v) => (v === undefined ? null : v));
    const exec = async (sql: string, args: any[]) => t.db.execute({ sql, args: norm(args) });
    const prints = createPrints({
      dbGet: async (sql, ...args) => (await exec(sql, args)).rows[0],
      dbAll: async (sql, ...args) => (await exec(sql, args)).rows as any[],
      dbRun: async (sql, ...args) => { const r = await exec(sql, args); return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.rowsAffected }; },
      dbBatchResults: async (stmts) => (await t.db.batch(stmts.map((s) => ({ sql: s.sql, args: norm(s.args ?? []) })), "write")).map((r) => ({ lastInsertRowid: Number(r.lastInsertRowid), changes: r.rowsAffected, rows: r.rows as any[] })),
      requireAuth: async () => null, hasPerm: async () => false,
      env: { PRINTS_DIR: dir, PRINTS_MAX_FILE_MB: "1", PRINTS_QUOTA_MB: "3", PRINTS_MIN_FREE_MB: "0" },
    });
    const robot = Number((await t.db.execute({ sql: "INSERT INTO cad_robots (team_id, season, name, is_main, created_at, updated_at) VALUES (?, 2025, 'Practice/bot', 0, 'x', 'x')", args: [team] })).lastInsertRowid);
    const part = Number((await t.db.execute({ sql: "INSERT INTO cad_parts (team_id, name, section, quantity, source, unit_cost, status, notes, created_at, updated_at, robot_id, ck_part_key) VALUES (?, 'Claw finger', 'Claw', 2, 'printed', 0, 'to_order', '', 'x', 'x', ?, 'doc1:ps:JHD:default')", args: [team, robot] })).lastInsertRowid);
    const first = await prints.fileControlKitPrint({ teamId: team, robotId: robot, name: "Claw finger.step", bytes: Buffer.from("ISO-10303-21; v1"), ckPartKey: "doc1:ps:JHD:default", sentBy: "Ada" });
    expect(first).toMatchObject({ name: "Claw finger.step", replaced: false });
    let l = await lib();
    const path = [];
    for (let id = l.folders.find((f: any) => f.id === first.folderId)?.id; id != null;) { const f = l.folders.find((x: any) => x.id === id); path.unshift(f.name); id = f.parentId; }
    expect(path).toEqual(["2025–26 DECODE", "Practice-bot", "Control Kit"]);
    expect(l.files.find((f: any) => f.id === first.fileId)).toMatchObject({ source: "control-kit", robotId: robot, cadPart: { id: part }, subsystem: "Claw", copiesNeeded: 2, uploadedBy: "Ada via Control Kit", kind: "step" });
    // Printed, then Control Kit sends the same bytes (nothing changes) and then new ones (back to To print).
    await t.post("/api/prints/files/bulk", { ids: [first.fileId], action: "status", status: "printed" }, admin);
    expect(await prints.fileControlKitPrint({ teamId: team, robotId: robot, name: "Claw finger.step", bytes: Buffer.from("ISO-10303-21; v1"), ckPartKey: "doc1:ps:JHD:default" })).toMatchObject({ unchanged: true });
    const again = await prints.fileControlKitPrint({ teamId: team, robotId: robot, name: "Claw finger.step", bytes: Buffer.from("ISO-10303-21; v2"), ckPartKey: "doc1:ps:JHD:default" });
    expect(again).toMatchObject({ fileId: first.fileId, replaced: true });
    l = await lib();
    expect(l.files.find((f: any) => f.id === first.fileId).status).toBe("to_print");
    expect((await raw(`/api/prints/files/${first.fileId}/download`, admin)).bytes.toString()).toBe("ISO-10303-21; v2");
    // A file a person put there under the same name is kept; Control Kit's gets "(2)".
    const mine = await uploadFile(admin, { name: "Bracket.step", folderId: first.folderId, bytes: Buffer.from("mine") });
    const theirs = await prints.fileControlKitPrint({ teamId: team, robotId: robot, name: "Bracket.step", bytes: Buffer.from("ck") });
    expect(theirs.name).toBe("Bracket (2).step");
    expect((await raw(`/api/prints/files/${mine.body.id}/download`, admin)).bytes.toString()).toBe("mine");
    await expect(prints.fileControlKitPrint({ teamId: team, robotId: robot, name: "x.exe", bytes: Buffer.from("x") })).rejects.toMatchObject({ code: "unsupported" });
    await expect(prints.fileControlKitPrint({ teamId: team, robotId: robot, name: "big.step", bytes: Buffer.alloc(2 * MB) })).rejects.toMatchObject({ code: "too_large" });
    await expect(prints.fileControlKitPrint({ teamId: other, robotId: robot, name: "x.step", bytes: Buffer.from("x") })).rejects.toThrow();
    const act = (await get(`/api/prints/activity?file=${first.fileId}`, admin)).body;
    expect(act.map((x: any) => x.action)).toEqual(expect.arrayContaining(["upload", "status", "replace"]));
  });
});

describe("disk reserve", () => {
  it("refuses uploads that would leave the server short of disk", async () => {
    const t2 = await startTestServer("cp-prints-full-", { PRINTS_DIR: mkdtempSync(join(tmpdir(), "cp-prints-full-store-")), PRINTS_MIN_FREE_MB: String(1024 * 1024 * 1024) });
    try {
      const tm = await seedTeam(t2.db, "Full");
      const s = await t2.session(await seedMember(t2.db, tm, "A", "a@full.local", "admin"));
      const form = new FormData();
      form.append("file", new Blob([stl()]), "x.stl");
      const res = await fetch(`${t2.base}/api/prints/files`, { method: "POST", body: form, headers: withSession(new Headers(), s) });
      expect(res.status).toBe(507);
      expect((await res.json()).code).toBe("disk_full");
    } finally { await t2.stop(); }
  }, 120_000);
});
