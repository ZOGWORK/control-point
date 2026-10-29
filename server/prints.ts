// The Prints library (migration 155): a team's 3D print files, in folders
// (where a file lives) and in groups (smart groups from each file's details,
// plus collections the team makes). Shared rules are in src/types/prints.ts.
//
// Storage: bytes live on the VM's disk under PRINTS_DIR (default
// <cwd>/.data/prints, outside every statically served directory), at a random
// key per file; names people type never reach a disk path. Limits, all
// configurable in the environment:
//   PRINTS_MAX_FILE_MB   one file (default 100)
//   PRINTS_QUOTA_MB      one workspace's total (default 2048)
//   PRINTS_MIN_FREE_MB   free disk an upload must leave (default 5120)
// The quota is checked inside the INSERT itself, so two uploads at once can't
// both slip past it.
//
// Permissions follow the workspace's roles: every member views and
// downloads; manage_prints uploads, moves, renames, deletes and edits
// details. Every route binds auth.teamId; another team's ids are 404. Every
// change is written to print_activity.
//
// Control Kit: fileControlKitPrint() files a print sent for a robot under
// "Season / Robot / Control Kit" (see the end of this file).
import type { Express } from "express";
import multer from "multer";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { seasonName, isSeason } from "../src/types/cadBom.js";
import { DEFAULT_SUBSYSTEMS, cleanSubsystems } from "../src/types/teamModules.js";
import {
  canPreview, cleanMaterial, cleanName, cleanSubsystem, isPrintStatus, printKind, safeName, uniqueName,
  type PrintFile, type PrintKind, type PrintStatus,
} from "../src/types/prints.js";
import { writeZip, uniqueZipNames, ZIP_MAX_BYTES, ZIP_MAX_ENTRIES } from "./zipStream.js";

type Auth = { memberId: number; teamId: number | null };
type Stmt = { sql: string; args: any[] };
export interface PrintDeps {
  dbGet: (sql: string, ...args: any[]) => Promise<any>;
  dbAll: (sql: string, ...args: any[]) => Promise<any[]>;
  dbRun: (sql: string, ...args: any[]) => Promise<{ lastInsertRowid: number; changes: number }>;
  dbBatchResults: (stmts: { sql: string; args?: any[] }[]) => Promise<{ lastInsertRowid: number; changes: number; rows: any[] }[]>;
  requireAuth: (req: any, res: any) => Promise<Auth | null>;
  hasPerm: (auth: Auth, perm: string) => Promise<boolean>;
  env: Record<string, string | undefined>;
}

export const MANAGE_PRINTS = "manage_prints";
const MB = 1024 * 1024;
const THUMB_MAX = 512 * 1024;
const MAX_BULK = 1000;
const MAX_COLLECTIONS = 60;
const MAX_FOLDERS = 2000;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PrintLimits { maxFile: number; quota: number; minFree: number }
export function printLimits(env: Record<string, string | undefined>): PrintLimits {
  const num = (k: string, d: number, min: number) => { const n = Number(env[k]); return Number.isFinite(n) && n >= min && env[k] !== "" && env[k] != null ? n : d; };
  return {
    maxFile: Math.round(num("PRINTS_MAX_FILE_MB", 100, 0.001) * MB),
    quota: Math.round(num("PRINTS_QUOTA_MB", 2048, 0.001) * MB),
    minFree: Math.round(num("PRINTS_MIN_FREE_MB", 5120, 0) * MB),
  };
}

/** Why a print couldn't be stored. `status` is the HTTP answer for routes. */
export class PrintError extends Error {
  constructor(public code: "unsupported" | "too_large" | "quota" | "disk_full" | "bad_name" | "empty", message: string, public status = 400) { super(message); }
}

/** Files on disk under random keys "<team>/<32 hex>" (+ ".thumb.png"). A key that doesn't look like one never becomes a path. */
export class PrintStore {
  readonly files: string;
  readonly tmp: string;
  constructor(readonly root: string) {
    this.files = path.join(root, "files");
    this.tmp = path.join(root, "tmp");
    fs.mkdirSync(this.files, { recursive: true });
    fs.mkdirSync(this.tmp, { recursive: true });
  }
  newKey(teamId: number) { return `${Math.trunc(teamId)}/${randomBytes(16).toString("hex")}`; }
  pathOf(key: string): string {
    if (!/^\d{1,12}\/[0-9a-f]{32}(\.thumb\.png)?$/.test(key)) throw new Error("bad storage key");
    return path.join(this.files, ...key.split("/"));
  }
  async adopt(tmpPath: string, key: string) {
    const dest = this.pathOf(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(tmpPath, dest);
  }
  async write(key: string, bytes: Uint8Array) {
    const dest = this.pathOf(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const part = `${dest}.${randomBytes(4).toString("hex")}.part`;
    await fsp.writeFile(part, bytes);
    await fsp.rename(part, dest);
  }
  async remove(key: string | null | undefined) {
    if (!key) return;
    try { await fsp.unlink(this.pathOf(key)); } catch (e: any) { if (e?.code !== "ENOENT") console.error("Removing a print file failed:", e?.message || e); }
  }
  async exists(key: string) { try { await fsp.access(this.pathOf(key)); return true; } catch { return false; } }
  /** Bytes free for this process on the store's disk. */
  async free(): Promise<number> {
    const s = await fsp.statfs(this.root);
    return Number(s.bavail) * Number(s.bsize);
  }
  /** Temp uploads left by a crash. */
  async sweepTmp(maxAgeMs = 3600_000) {
    for (const f of await fsp.readdir(this.tmp).catch(() => [] as string[])) {
      const p = path.join(this.tmp, f);
      const st = await fsp.stat(p).catch(() => null);
      if (st && Date.now() - st.mtimeMs > maxAgeMs) await fsp.unlink(p).catch(() => {});
    }
  }
}

const sha256File = (p: string) => new Promise<string>((resolve, reject) => {
  const h = createHash("sha256");
  fs.createReadStream(p).on("data", (c) => h.update(c)).on("error", reject).on("end", () => resolve(h.digest("hex")));
});
const isUnique = (e: any) => /UNIQUE constraint failed/i.test(String(e?.message || e));
const intOrNull = (v: unknown, max: number): number | null | undefined => {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : undefined;
};
const ids = (raw: unknown): number[] => (Array.isArray(raw) ? [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : []);
const qs = (n: number) => Array(n).fill("?").join(",");
/** A Content-Disposition that keeps a UTF-8 name ("2025–26 DECODE.zip"). */
function disposition(kind: "attachment" | "inline", name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function createPrints(deps: PrintDeps) {
  const { dbGet, dbAll, dbRun } = deps;
  const limits = printLimits(deps.env);
  const store = new PrintStore(path.resolve(deps.env.PRINTS_DIR?.trim() || path.join(process.cwd(), ".data", "prints")));
  void store.sweepTmp();
  setInterval(() => void store.sweepTmp(), 3600_000).unref();

  const upload = multer({
    storage: multer.diskStorage({
      destination: store.tmp,
      filename: (_req, _file, cb) => cb(null, randomBytes(16).toString("hex")),
    }),
    limits: { fileSize: limits.maxFile, files: 2, fields: 8, fieldSize: 4096 },
    fileFilter: (_req, file, cb) => {
      if (file.fieldname === "file" && printKind(file.originalname)) return cb(null, true);
      if (file.fieldname === "thumbnail" && file.mimetype === "image/png") return cb(null, true);
      cb(new PrintError("unsupported", file.fieldname === "file" ? "Prints takes STL, 3MF, STEP/STP, OBJ and G-code files" : "Thumbnails are PNG images"));
    },
  });

  const teamOf = (auth: Auth, res: any) => {
    if (!auth.teamId) { res.status(400).json({ error: "Join a team first" }); return null; }
    return auth.teamId;
  };
  const memberName = async (id: number) => String((await dbGet("SELECT name FROM members WHERE id = ?", id))?.name || "A teammate");
  /** Signed in, on a team, and (when `edit`) allowed to change the library. */
  async function access(req: any, res: any, edit: boolean): Promise<{ auth: Auth; teamId: number } | null> {
    const auth = await deps.requireAuth(req, res);
    if (!auth) return null;
    const teamId = teamOf(auth, res);
    if (!teamId) return null;
    // The page names the workspace it shows; a request sent after a workspace switch (a queued upload) stops here.
    const sentFor = req.headers?.["x-cp-prints-team"];
    if (sentFor !== undefined && Number(sentFor) !== teamId) { res.status(409).json({ error: "You switched workspaces. Reopen Prints to keep going.", code: "workspace_changed" }); return null; }
    if (edit && !(await deps.hasPerm(auth, MANAGE_PRINTS))) { res.status(403).json({ error: "Your role can view and download prints, not change them" }); return null; }
    return { auth, teamId };
  }
  const now = () => new Date().toISOString();
  const logStmt = (teamId: number, by: { id: number | null; name: string }, action: string, o: { fileId?: number | null; folderId?: number | null; detail?: unknown } = {}): Stmt => ({
    sql: "INSERT INTO print_activity (team_id, file_id, folder_id, member_id, member_name, action, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [teamId, o.fileId ?? null, o.folderId ?? null, by.id, by.name, action, JSON.stringify(o.detail ?? {}), now()],
  });
  const usedBytes = async (teamId: number) => Number((await dbGet("SELECT COALESCE(SUM(size + thumb_size), 0) AS n FROM print_files WHERE team_id = ?", teamId))?.n) || 0;
  async function teamFolder(teamId: number, raw: unknown): Promise<number | null | undefined> {
    if (raw === null || raw === undefined || raw === "" || raw === "root") return null;
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) return undefined;
    return (await dbGet("SELECT id FROM print_folders WHERE id = ? AND team_id = ?", id, teamId)) ? id : undefined;
  }
  async function namesIn(teamId: number, folderId: number | null, exceptFile?: number) {
    const rows = await dbAll("SELECT name FROM print_files WHERE team_id = ? AND COALESCE(folder_id, 0) = ? AND id <> ?", teamId, folderId ?? 0, exceptFile ?? 0);
    return new Set(rows.map((r) => String(r.name).toLowerCase()));
  }
  /** SQL for `?` (a folder id) and every folder below it in team `?`; args: [id, teamId, teamId]. Usable inside any statement. */
  const SUBTREE = `WITH RECURSIVE sub(id) AS (SELECT id FROM print_folders WHERE id = ? AND team_id = ?
         UNION SELECT f.id FROM print_folders f JOIN sub ON f.parent_id = sub.id WHERE f.team_id = ?) SELECT id FROM sub`;
  /** True in SQL when folder `?` is the root (NULL) or a folder of team `?`; args: [folderId, folderId, teamId]. */
  const FOLDER_OK = "(? IS NULL OR EXISTS (SELECT 1 FROM print_folders d WHERE d.id = ? AND d.team_id = ?))";
  /**
   * A statement that fails the whole write batch when `condition` (SQL) is false: json() of malformed text raises an
   * error, so a check made inside the transaction can stop it. isAssert() recognises the failure.
   */
  const assertStmt = (condition: string, args: any[]): Stmt => ({ sql: `SELECT CASE WHEN ${condition} THEN 1 ELSE json('prints-changed') END`, args });
  const isAssert = (e: any) => /malformed JSON/i.test(String(e?.message || e));
  /** `id` and every folder below it, in this team. */
  async function subtree(teamId: number, id: number): Promise<number[]> {
    const rows = await dbAll(SUBTREE, id, teamId, teamId);
    return rows.map((r) => Number(r.id));
  }
  async function folderTrailNames(teamId: number): Promise<Map<number, { parent: number | null; name: string }>> {
    const rows = await dbAll("SELECT id, parent_id, name FROM print_folders WHERE team_id = ?", teamId);
    return new Map(rows.map((r) => [Number(r.id), { parent: r.parent_id == null ? null : Number(r.parent_id), name: String(r.name) }]));
  }
  /** "A/B/C" from the root to a folder (or from just below `from`). */
  function trail(map: Map<number, { parent: number | null; name: string }>, id: number | null, from: number | null = null): string[] {
    const out: string[] = [];
    const seen = new Set<number>();
    let cur = id;
    while (cur != null && cur !== from && !seen.has(cur)) { seen.add(cur); const f = map.get(cur); if (!f) break; out.unshift(f.name); cur = f.parent; }
    return out;
  }

  /** The library row as the explorer sees it. */
  function fileView(r: any, collections: Map<number, number[]>): PrintFile {
    const cadSection = r.cad_section && String(r.cad_section).toLowerCase() !== "other" ? String(r.cad_section) : null;
    const cadQty = r.cad_id != null && Number.isFinite(Number(r.cad_quantity)) ? Number(r.cad_quantity) : null;
    return {
      id: Number(r.id), folderId: r.folder_id == null ? null : Number(r.folder_id), name: r.name, kind: r.kind as PrintKind, size: Number(r.size) || 0,
      createdAt: r.created_at, updatedAt: r.updated_at, uploadedBy: r.uploaded_by_name || null, notes: r.notes || "",
      robotId: r.robot_ok != null ? Number(r.robot_id) : null,
      season: r.robot_ok != null ? Number(r.robot_season) : r.season != null ? Number(r.season) : null,
      cadPart: r.cad_id != null ? { id: Number(r.cad_id), name: r.cad_name, section: r.cad_section ?? null, quantity: Number(r.cad_quantity) || 0, robotId: r.cad_robot_id == null ? null : Number(r.cad_robot_id) } : null,
      subsystem: r.subsystem || cadSection, subsystemFrom: r.subsystem ? "manual" : cadSection ? "cad" : null,
      material: r.material || null, status: isPrintStatus(r.status) ? r.status : "to_print",
      copiesNeeded: r.copies_needed != null ? Number(r.copies_needed) : cadQty,
      copiesNeededFrom: r.copies_needed != null ? "manual" : cadQty != null ? "cad" : null,
      copiesPrinted: Number(r.copies_printed) || 0, collections: collections.get(Number(r.id)) ?? [], hasThumb: !!r.thumb_key,
      source: r.source === "control-kit" ? "control-kit" : "upload",
    };
  }
  const FILE_SELECT = `SELECT f.*, r.id AS robot_ok, r.season AS robot_season, p.id AS cad_id, p.name AS cad_name, p.section AS cad_section, p.quantity AS cad_quantity, p.robot_id AS cad_robot_id
      FROM print_files f
      LEFT JOIN cad_robots r ON r.id = f.robot_id AND r.team_id = f.team_id
      LEFT JOIN cad_parts p ON p.id = f.cad_part_id AND p.team_id = f.team_id`;
  async function oneFile(teamId: number, id: number) {
    const r = await dbGet(`${FILE_SELECT} WHERE f.id = ? AND f.team_id = ?`, id, teamId);
    if (!r) return null;
    const col = (await dbAll("SELECT collection_id FROM print_collection_files WHERE file_id = ? AND team_id = ?", id, teamId)).map((x) => Number(x.collection_id));
    return fileView(r, new Map([[Number(r.id), col]]));
  }

  /**
   * Insert a stored file's row. The quota is checked in the same statement, and a name taken meanwhile gets the next
   * "(n)". Returns the row id and the name it got, or throws PrintError("quota").
   */
  async function insertFile(teamId: number, row: { folderId: number | null; name: string; kind: PrintKind; size: number; sha: string; key: string; by: { id: number | null; name: string }; source: "upload" | "control-kit"; robotId?: number | null; cadPartId?: number | null; ckPartKey?: string | null }) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const name = uniqueName(row.name, await namesIn(teamId, row.folderId));
      const t = now();
      try {
        const r = await dbRun(
          `INSERT INTO print_files (team_id, folder_id, name, kind, size, sha256, storage_key, robot_id, cad_part_id, ck_part_key, source, uploaded_by, uploaded_by_name, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE (SELECT COALESCE(SUM(size + thumb_size), 0) FROM print_files WHERE team_id = ?) + ? <= ? AND ${FOLDER_OK}`,
          teamId, row.folderId, name, row.kind, row.size, row.sha, row.key, row.robotId ?? null, row.cadPartId ?? null, row.ckPartKey ?? null, row.source, row.by.id, row.by.name, t, t,
          teamId, row.size, limits.quota, row.folderId, row.folderId, teamId);
        if (!r.changes) {
          if (row.folderId != null && !(await dbGet("SELECT 1 FROM print_folders WHERE id = ? AND team_id = ?", row.folderId, teamId))) throw new PrintError("bad_name", "That folder no longer exists", 404);
          throw new PrintError("quota", quotaMessage(), 413);
        }
        return { id: Number(r.lastInsertRowid), name };
      } catch (e) {
        if (!isUnique(e) || attempt === 4) throw e;
      }
    }
    throw new Error("unreachable");
  }
  const mbText = (n: number) => (n >= 1024 * MB ? `${+(n / (1024 * MB)).toFixed(1)} GB` : `${Math.round(n / MB)} MB`);
  const quotaMessage = () => `Your team's prints are limited to ${mbText(limits.quota)}. Delete old files to make room.`;
  async function checkDisk(incoming: number) {
    const free = await store.free().catch(() => Infinity);
    if (free - incoming < limits.minFree) throw new PrintError("disk_full", "The server is short of disk space right now. Ask the Control Point owner, or try again later.", 507);
  }
  async function saveThumb(teamId: number, fileId: number, key: string, bytes: Buffer, by: { id: number | null; name: string } | null) {
    if (bytes.length > THUMB_MAX || !bytes.subarray(0, 8).equals(PNG_SIG)) throw new PrintError("unsupported", "Thumbnails are PNG images up to 512 KB");
    await checkDisk(bytes.length);
    const thumbKey = `${key}.thumb.png`;
    await store.write(thumbKey, bytes);
    // Counted in the quota like the file itself (replacing any earlier thumbnail's size).
    const r = await dbRun(
      `UPDATE print_files SET thumb_key = ?, thumb_size = ? WHERE id = ? AND team_id = ? AND storage_key = ?
         AND (SELECT COALESCE(SUM(size + thumb_size), 0) FROM print_files WHERE team_id = ?) - thumb_size + ? <= ?`,
      thumbKey, bytes.length, fileId, teamId, key, teamId, bytes.length, limits.quota);
    if (!r.changes) {
      await store.remove(thumbKey);
      if (await dbGet("SELECT 1 FROM print_files WHERE id = ? AND team_id = ? AND storage_key = ?", fileId, teamId, key)) throw new PrintError("quota", quotaMessage(), 413);
    }
    void by;
  }
  const sendError = (res: any, e: any, what: string) => {
    if (e instanceof PrintError) return res.status(e.status).json({ error: e.message, code: e.code });
    console.error(`Prints ${what} error:`, e);
    res.status(500).json({ error: "Internal server error" });
  };

  function registerRoutes(app: Express) {
    // Everything the explorer needs in one answer: folders, files with their details, collections, robots, usage.
    app.get("/api/prints/library", async (req, res) => {
      try {
        const a = await access(req, res, false); if (!a) return;
        const { teamId } = a;
        const [folders, files, collections, members, robots, team] = await Promise.all([
          dbAll("SELECT id, parent_id, name, created_at, updated_at FROM print_folders WHERE team_id = ? ORDER BY name COLLATE NOCASE", teamId),
          dbAll(`${FILE_SELECT} WHERE f.team_id = ?`, teamId),
          dbAll("SELECT c.id, c.name, (SELECT COUNT(*) FROM print_collection_files x WHERE x.collection_id = c.id) AS n FROM print_collections c WHERE c.team_id = ? ORDER BY c.name COLLATE NOCASE", teamId),
          dbAll("SELECT collection_id, file_id FROM print_collection_files WHERE team_id = ?", teamId),
          dbAll("SELECT id, name, season FROM cad_robots WHERE team_id = ? ORDER BY season DESC, is_main DESC, id", teamId),
          dbGet("SELECT subsystems FROM teams WHERE id = ?", teamId),
        ]);
        const byFile = new Map<number, number[]>();
        for (const m of members) byFile.set(Number(m.file_id), [...(byFile.get(Number(m.file_id)) ?? []), Number(m.collection_id)]);
        let subsystems: string[] = [...DEFAULT_SUBSYSTEMS];
        try { if (team?.subsystems) subsystems = cleanSubsystems(JSON.parse(team.subsystems)); } catch { /* defaults */ }
        res.setHeader("Cache-Control", "private, no-store");
        res.json({
          teamId,
          canEdit: await deps.hasPerm(a.auth, MANAGE_PRINTS),
          usage: { used: files.reduce((s, f) => s + (Number(f.size) || 0) + (Number(f.thumb_size) || 0), 0), quota: limits.quota, maxFile: limits.maxFile },
          folders: folders.map((f) => ({ id: Number(f.id), parentId: f.parent_id == null ? null : Number(f.parent_id), name: f.name, createdAt: f.created_at, updatedAt: f.updated_at })),
          files: files.map((f) => fileView(f, byFile)),
          collections: collections.map((c) => ({ id: Number(c.id), name: c.name, files: Number(c.n) || 0 })),
          robots: robots.map((r) => ({ id: Number(r.id), name: r.name, season: Number(r.season), seasonName: seasonName(Number(r.season)) })),
          subsystems,
        });
      } catch (e) { sendError(res, e, "library"); }
    });

    // ---- Folders ----
    app.post("/api/prints/folders", async (req, res) => {
      try {
        const a = await access(req, res, true); if (!a) return;
        const name = cleanName(req.body?.name);
        if (!name) return res.status(400).json({ error: "Folder names can't be empty or contain / \\ : * ? \" < > |" });
        const parentId = await teamFolder(a.teamId, req.body?.parentId);
        if (parentId === undefined) return res.status(404).json({ error: "That folder no longer exists" });
        const count = await dbGet("SELECT COUNT(*) AS n FROM print_folders WHERE team_id = ?", a.teamId);
        if (Number(count?.n) >= MAX_FOLDERS) return res.status(400).json({ error: `A library holds at most ${MAX_FOLDERS} folders` });
        const by = { id: a.auth.memberId, name: await memberName(a.auth.memberId) };
        const t = now();
        try {
          const r = await dbRun(`INSERT INTO print_folders (team_id, parent_id, name, created_by, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${FOLDER_OK}`,
            a.teamId, parentId, name, by.id, t, t, parentId, parentId, a.teamId);
          if (!r.changes) return res.status(404).json({ error: "That folder no longer exists" });
          const id = Number(r.lastInsertRowid);
          const log = logStmt(a.teamId, by, "folder_create", { folderId: id, detail: { name, parentId } });
          await dbRun(log.sql, ...log.args);
          res.json({ id, name });
        } catch (e) {
          if (isUnique(e)) return res.status(409).json({ error: `There's already a folder named "${name}" here` });
          throw e;
        }
      } catch (e) { sendError(res, e, "folder create"); }
    });

    // Rename and/or move a folder. It can't move into itself or a folder inside it.
    app.patch("/api/prints/folders/:id", async (req, res) => {
      try {
        const a = await access(req, res, true); if (!a) return;
        const folder = await dbGet("SELECT * FROM print_folders WHERE id = ? AND team_id = ?", Number(req.params.id), a.teamId);
        if (!folder) return res.status(404).json({ error: "Not found" });
        const body = req.body || {};
        let name = String(folder.name);
        let parentId: number | null = folder.parent_id == null ? null : Number(folder.parent_id);
        if (body.name !== undefined) {
          const n = cleanName(body.name);
          if (!n) return res.status(400).json({ error: "Folder names can't be empty or contain / \\ : * ? \" < > |" });
          name = n;
        }
        if (body.parentId !== undefined) {
          const p = await teamFolder(a.teamId, body.parentId);
          if (p === undefined) return res.status(404).json({ error: "That folder no longer exists" });
          if (p !== null && (await subtree(a.teamId, Number(folder.id))).includes(p)) return res.status(400).json({ error: "A folder can't go inside itself" });
          parentId = p;
        }
        const by = { id: a.auth.memberId, name: await memberName(a.auth.memberId) };
        const moved = parentId !== (folder.parent_id == null ? null : Number(folder.parent_id));
        const renamed = name !== folder.name;
        if (!moved && !renamed) return res.json({ id: Number(folder.id), name });
        const stmts: Stmt[] = [
          // Checked again inside the update: a move into a folder deleted meanwhile, or into one that another move just
          // put inside this folder, changes nothing.
          { sql: `UPDATE print_folders SET name = ?, parent_id = ?, updated_at = ? WHERE id = ? AND team_id = ? AND ${FOLDER_OK}
                    AND (? IS NULL OR ? NOT IN (${SUBTREE}))`,
            args: [name, parentId, now(), folder.id, a.teamId, parentId, parentId, a.teamId, parentId, parentId, folder.id, a.teamId, a.teamId] },
        ];
        if (renamed) stmts.push(logStmt(a.teamId, by, "folder_rename", { folderId: Number(folder.id), detail: { from: folder.name, to: name } }));
        if (moved) stmts.push(logStmt(a.teamId, by, "folder_move", { folderId: Number(folder.id), detail: { from: folder.parent_id ?? null, to: parentId } }));
        try {
          const [r] = await deps.dbBatchResults(stmts);
          if (!r.changes) {
            const p = parentId == null ? null : await teamFolder(a.teamId, parentId);
            if (p !== undefined && (await dbGet("SELECT 1 FROM print_folders WHERE id = ? AND team_id = ?", folder.id, a.teamId))) return res.status(400).json({ error: "A folder can't go inside itself" });
            return res.status(404).json({ error: "That folder no longer exists" });
          }
        } catch (e) {
          if (isUnique(e)) return res.status(409).json({ error: `There's already a folder named "${name}" there` });
          throw e;
        }
        res.json({ id: Number(folder.id), name });
      } catch (e) { sendError(res, e, "folder update"); }
    });

    // Delete a folder and everything in it. With files inside, the caller must say how many it confirmed (?files=N);
    // a different count (someone added or removed files meanwhile) asks again.
    app.delete("/api/prints/folders/:id", async (req, res) => {
      try {
        const a = await access(req, res, true); if (!a) return;
        const tree = await subtree(a.teamId, Number(req.params.id));
        if (!tree.length) return res.status(404).json({ error: "Not found" });
        const count = await dbGet(`SELECT COUNT(*) AS n FROM print_files WHERE team_id = ? AND folder_id IN (${qs(tree.length)})`, a.teamId, ...tree);
        const files = Number(count?.n) || 0;
        const confirmed = req.query.files === undefined ? null : Number(req.query.files);
        if (files > 0 && confirmed !== files) {
          return res.status(409).json({ error: `This folder holds ${files} file${files === 1 ? "" : "s"}. Confirm to delete them too.`, files, folders: tree.length - 1 });
        }
        const by = { id: a.auth.memberId, name: await memberName(a.auth.memberId) };
        const folder = await dbGet("SELECT name FROM print_folders WHERE id = ?", tree[0]);
        // Every statement works on the subtree as it is inside this transaction, and the first one stops the batch when
        // the folder now holds a different number of files than the person confirmed (an upload or move meanwhile).
        const inTree = `IN (${SUBTREE})`;
        const t3 = [tree[0], a.teamId, a.teamId];
        const stmts: Stmt[] = [
          assertStmt(`(SELECT COUNT(*) FROM print_files WHERE team_id = ? AND folder_id ${inTree}) = ?`, [a.teamId, ...t3, files]),
          { sql: `DELETE FROM print_collection_files WHERE team_id = ? AND file_id IN (SELECT id FROM print_files WHERE team_id = ? AND folder_id ${inTree})`, args: [a.teamId, a.teamId, ...t3] },
          { sql: `DELETE FROM print_files WHERE team_id = ? AND folder_id ${inTree} RETURNING id, name, storage_key, thumb_key`, args: [a.teamId, ...t3] },
          { sql: `DELETE FROM print_folders WHERE team_id = ? AND id ${inTree}`, args: [a.teamId, ...t3] },
          logStmt(a.teamId, by, "folder_delete", { folderId: tree[0], detail: { name: folder?.name, files, folders: tree.length } }),
        ];
        let out;
        try { out = await deps.dbBatchResults(stmts); }
        catch (e) {
          if (!isAssert(e)) throw e;
          const now2 = await subtree(a.teamId, tree[0]);
          const n = now2.length ? Number((await dbGet(`SELECT COUNT(*) AS n FROM print_files WHERE team_id = ? AND folder_id IN (${qs(now2.length)})`, a.teamId, ...now2))?.n) || 0 : 0;
          return res.status(409).json({ error: `This folder now holds ${n} file${n === 1 ? "" : "s"}. Confirm again to delete them too.`, files: n, folders: Math.max(0, now2.length - 1) });
        }
        out = out.slice(1);
        for (const r of out[1].rows) { await store.remove(r.storage_key); await store.remove(r.thumb_key); }
        res.json({ success: true, files: out[1].rows.length });
      } catch (e) { sendError(res, e, "folder delete"); }
    });

    // ---- Files ----
    // Upload one file (field "file", optional PNG "thumbnail", fields "folderId" and "name").
    app.post("/api/prints/files", async (req, res) => {
      const cleanup: string[] = [];
      try {
        const a = await access(req, res, true); if (!a) return;
        // Refuse early, before the body is read, when its declared size can't fit.
        const declared = Number(req.headers["content-length"]) || 0;
        if (declared > limits.maxFile + THUMB_MAX + 64 * 1024) return res.status(413).json({ error: `Files can be up to ${mbText(limits.maxFile)}`, code: "too_large" });
        if (declared && (await usedBytes(a.teamId)) + declared - THUMB_MAX - 64 * 1024 > limits.quota) return res.status(413).json({ error: quotaMessage(), code: "quota" });
        await checkDisk(declared);
        await new Promise<void>((resolve, reject) => upload.fields([{ name: "file", maxCount: 1 }, { name: "thumbnail", maxCount: 1 }])(req, res, (err: any) => {
          for (const list of Object.values((req as any).files || {}) as any[]) for (const f of list) cleanup.push(f.path);
          if (!err) return resolve();
          if (err?.code === "LIMIT_FILE_SIZE") return reject(new PrintError("too_large", `Files can be up to ${mbText(limits.maxFile)}`, 413));
          if (err instanceof PrintError) return reject(err);
          reject(new PrintError("unsupported", err?.message || "Upload failed"));
        }));
        const file = (req as any).files?.file?.[0];
        if (!file) return res.status(400).json({ error: "Choose a file to upload" });
        const name = cleanName(req.body?.name ?? file.originalname);
        if (!name) throw new PrintError("bad_name", "File names can't contain / \\ : * ? \" < > |");
        const kind = printKind(name);
        if (!kind) throw new PrintError("unsupported", "Prints takes STL, 3MF, STEP/STP, OBJ and G-code files");
        if (!file.size) throw new PrintError("empty", "That file is empty");
        const folderId = await teamFolder(a.teamId, req.body?.folderId);
        if (folderId === undefined) return res.status(404).json({ error: "That folder no longer exists" });
        await checkDisk(0);
        const sha = await sha256File(file.path);
        const key = store.newKey(a.teamId);
        await store.adopt(file.path, key);
        const by = { id: a.auth.memberId, name: await memberName(a.auth.memberId) };
        let row: { id: number; name: string };
        try { row = await insertFile(a.teamId, { folderId, name, kind, size: file.size, sha, key, by, source: "upload" }); }
        catch (e) { await store.remove(key); throw e; }
        const thumb = (req as any).files?.thumbnail?.[0];
        if (thumb && canPreview(kind)) {
          try { await saveThumb(a.teamId, row.id, key, await fsp.readFile(thumb.path), by); } catch (e) { console.warn("Print thumbnail skipped:", (e as any)?.message || e); }
        }
        const log = logStmt(a.teamId, by, "upload", { fileId: row.id, folderId, detail: { name: row.name, size: file.size } });
        await dbRun(log.sql, ...log.args);
        res.json({ id: row.id, name: row.name, renamed: row.name !== name });
      } catch (e) { sendError(res, e, "upload"); }
      finally { for (const p of cleanup) await fsp.unlink(p).catch(() => {}); }
    });

    app.get("/api/prints/files/:id", async (req, res) => {
      try {
        const a = await access(req, res, false); if (!a) return;
        const f = await oneFile(a.teamId, Number(req.params.id));
        if (!f) return res.status(404).json({ error: "Not found" });
        res.json(f);
      } catch (e) { sendError(res, e, "file"); }
    });

    // Details: name, folder, notes, robot/season, CAD part, subsystem, material, status, copies.
    app.patch("/api/prints/files/:id", async (req, res) => {
      try {
        const a = await access(req, res, true); if (!a) return;
        const row = await dbGet("SELECT * FROM print_files WHERE id = ? AND team_id = ?", Number(req.params.id), a.teamId);
        if (!row) return res.status(404).json({ error: "Not found" });
        const body = req.body || {};
        const sets: string[] = [];
        const args: any[] = [];
        const changes: Record<string, unknown> = {};
        const set = (col: string, v: unknown, label = col) => { if (row[col] !== v) { sets.push(`${col} = ?`); args.push(v); changes[label] = v; } };
        let folderId: number | null = row.folder_id == null ? null : Number(row.folder_id);
        if (body.folderId !== undefined) {
          const f = await teamFolder(a.teamId, body.folderId);
          if (f === undefined) return res.status(404).json({ error: "That folder no longer exists" });
          folderId = f;
          set("folder_id", f, "folderId");
        }
        if (body.name !== undefined) {
          const n = cleanName(body.name);
          if (!n) return res.status(400).json({ error: "File names can't be empty or contain / \\ : * ? \" < > |" });
          if (printKind(n) !== row.kind) return res.status(400).json({ error: `Keep the file's .${String(row.name).split(".").pop()} ending` });
          set("name", n);
        } else if (folderId !== (row.folder_id == null ? null : Number(row.folder_id))) {
          // Moving into a folder with a file of the same name: this one becomes "name (2)".
          set("name", uniqueName(row.name, await namesIn(a.teamId, folderId, Number(row.id))));
        }
        if (body.notes !== undefined) set("notes", typeof body.notes === "string" ? body.notes.slice(0, 2000) : "");
        let robotId: number | null | undefined;
        if (body.robotId !== undefined) {
          if (body.robotId === null) robotId = null;
          else {
            const r = await dbGet("SELECT id FROM cad_robots WHERE id = ? AND team_id = ?", Number(body.robotId), a.teamId);
            if (!r) return res.status(404).json({ error: "That robot no longer exists" });
            robotId = Number(r.id);
          }
        }
        if (body.cadPartId !== undefined) {
          if (body.cadPartId === null) set("cad_part_id", null, "cadPartId");
          else {
            const p = await dbGet("SELECT id, robot_id FROM cad_parts WHERE id = ? AND team_id = ?", Number(body.cadPartId), a.teamId);
            if (!p) return res.status(404).json({ error: "That CAD part no longer exists" });
            set("cad_part_id", Number(p.id), "cadPartId");
            // A part belongs to a robot: the file follows it unless the request names one.
            if (robotId === undefined && p.robot_id != null) robotId = Number(p.robot_id);
          }
        }
        if (robotId !== undefined) set("robot_id", robotId, "robotId");
        if (body.season !== undefined) {
          if (body.season !== null && !isSeason(Number(body.season))) return res.status(400).json({ error: "Pick a season" });
          set("season", body.season === null ? null : Number(body.season));
        }
        if (body.subsystem !== undefined) set("subsystem", cleanSubsystem(body.subsystem) || null);
        if (body.material !== undefined) set("material", cleanMaterial(body.material) || null);
        if (body.copiesNeeded !== undefined) {
          const n = intOrNull(body.copiesNeeded, 999);
          if (n === undefined) return res.status(400).json({ error: "Copies needed is a whole number up to 999" });
          set("copies_needed", n, "copiesNeeded");
        }
        let status = row.status;
        if (body.status !== undefined) {
          if (!isPrintStatus(body.status)) return res.status(400).json({ error: "Unknown print status" });
          status = body.status;
        }
        if (body.copiesPrinted !== undefined) {
          const n = intOrNull(body.copiesPrinted, 999);
          if (n === undefined || n === null) return res.status(400).json({ error: "Copies printed is a whole number up to 999" });
          set("copies_printed", n, "copiesPrinted");
          // Reaching the copies needed marks it printed, unless the request says otherwise.
          if (body.status === undefined && (status === "to_print" || status === "printing")) {
            const need = body.copiesNeeded !== undefined ? intOrNull(body.copiesNeeded, 999) : row.copies_needed != null ? Number(row.copies_needed)
              : row.cad_part_id ? Number((await dbGet("SELECT quantity FROM cad_parts WHERE id = ? AND team_id = ?", row.cad_part_id, a.teamId))?.quantity ?? NaN) : NaN;
            if (need != null && Number.isFinite(need) && need > 0 && n >= need) status = "printed";
          }
        }
        set("status", status);
        if (status === "printed" && row.status !== "printed" && body.copiesPrinted === undefined) {
          const need = body.copiesNeeded !== undefined ? intOrNull(body.copiesNeeded, 999) : row.copies_needed != null ? Number(row.copies_needed)
            : row.cad_part_id ? Number((await dbGet("SELECT quantity FROM cad_parts WHERE id = ? AND team_id = ?", row.cad_part_id, a.teamId))?.quantity ?? NaN) : NaN;
          if (need != null && Number.isFinite(need) && need > Number(row.copies_printed)) set("copies_printed", need, "copiesPrinted");
        }
        if (!sets.length) return res.json(await oneFile(a.teamId, Number(row.id)));
        const by = { id: a.auth.memberId, name: await memberName(a.auth.memberId) };
        const stmts: Stmt[] = [{ sql: `UPDATE print_files SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND team_id = ? AND ${FOLDER_OK}`, args: [...args, now(), row.id, a.teamId, folderId, folderId, a.teamId] }];
        const action = changes.folderId !== undefined ? "move" : changes.name !== undefined ? "rename" : changes.status !== undefined && Object.keys(changes).length === 1 ? "status" : "edit";
        stmts.push(logStmt(a.teamId, by, action, { fileId: Number(row.id), folderId, detail: { ...changes, ...(changes.name !== undefined ? { from: row.name } : {}) } }));
        try {
          const [u] = await deps.dbBatchResults(stmts);
          if (!u.changes) return res.status(404).json({ error: "That folder no longer exists" });
        } catch (e) {
          if (isUnique(e)) return res.status(409).json({ error: `There's already a file named "${changes.name ?? row.name}" there` });
          throw e;
        }
        res.json(await oneFile(a.teamId, Number(row.id)));
      } catch (e) { sendError(res, e, "file update"); }
    });

    app.delete("/api/prints/files/:id", async (req, res) => {
      try {
        const a = await access(req, res, true); if (!a) return;
        const by = { id: a.auth.memberId, name: await memberName(a.auth.memberId) };
        const removed = await removeFiles(a.teamId, [Number(req.params.id)], by);
        if (!removed) return res.status(404).json({ error: "Not found" });
        res.json({ success: true });
      } catch (e) { sendError(res, e, "file delete"); }
    });

    async function removeFiles(teamId: number, list: number[], by: { id: number | null; name: string }) {
      if (!list.length) return 0;
      const inList = `IN (${qs(list.length)})`;
      const out = await deps.dbBatchResults([
        { sql: `DELETE FROM print_collection_files WHERE team_id = ? AND file_id ${inList}`, args: [teamId, ...list] },
        { sql: `DELETE FROM print_files WHERE team_id = ? AND id ${inList} RETURNING id, name, folder_id, storage_key, thumb_key`, args: [teamId, ...list] },
      ]);
      const rows = out[1].rows;
      if (rows.length) await deps.dbBatchResults(rows.map((r) => logStmt(teamId, by, "delete", { fileId: Number(r.id), folderId: r.folder_id ?? null, detail: { name: r.name } })));
      for (const r of rows) { await store.remove(r.storage_key); await store.remove(r.thumb_key); }
      return rows.length;
    }

    // Several files at once: move, status, delete, add to / remove from a collection.
    app.post("/api/prints/files/bulk", async (req, res) => {
      try {
        const a = await access(req, res, true); if (!a) return;
        const body = req.body || {};
        const list = ids(body.ids);
        if (!list.length) return res.status(400).json({ error: "Pick some files" });
        if (list.length > MAX_BULK) return res.status(400).json({ error: `At most ${MAX_BULK} files at a time` });
        const rows = await dbAll(`SELECT id, name, folder_id, status FROM print_files WHERE team_id = ? AND id IN (${qs(list.length)})`, a.teamId, ...list);
        if (!rows.length) return res.status(404).json({ error: "Those files no longer exist" });
        const mine = rows.map((r) => Number(r.id));
        const by = { id: a.auth.memberId, name: await memberName(a.auth.memberId) };
        const t = now();
        const stmts: Stmt[] = [];
        switch (body.action) {
          case "move": {
            const folderId = await teamFolder(a.teamId, body.folderId);
            if (folderId === undefined) return res.status(404).json({ error: "That folder no longer exists" });
            // The destination's names stay taken; each moving file keeps its name, or takes the next "(n)".
            const taken = await namesIn(a.teamId, folderId);
            const moving = rows.filter((r) => (r.folder_id == null ? null : Number(r.folder_id)) !== folderId);
            stmts.push(assertStmt(FOLDER_OK, [folderId, folderId, a.teamId]));
            for (const r of moving) {
              const name = uniqueName(r.name, taken);
              taken.add(name.toLowerCase());
              stmts.push({ sql: "UPDATE print_files SET folder_id = ?, name = ?, updated_at = ? WHERE id = ? AND team_id = ?", args: [folderId, name, t, r.id, a.teamId] });
              stmts.push(logStmt(a.teamId, by, "move", { fileId: Number(r.id), folderId, detail: { from: r.folder_id ?? null, to: folderId, ...(name !== r.name ? { name, was: r.name } : {}) } }));
            }
            break;
          }
          case "status": {
            if (!isPrintStatus(body.status)) return res.status(400).json({ error: "Unknown print status" });
            const status: PrintStatus = body.status;
            for (const r of rows.filter((x) => x.status !== status)) {
              stmts.push({
                // Marking printed counts every copy needed as printed (when the count is known).
                sql: `UPDATE print_files SET status = ?, updated_at = ?, copies_printed = CASE WHEN ? = 'printed'
                        THEN MAX(copies_printed, COALESCE(copies_needed, (SELECT p.quantity FROM cad_parts p WHERE p.id = print_files.cad_part_id AND p.team_id = print_files.team_id), copies_printed))
                        ELSE copies_printed END
                      WHERE id = ? AND team_id = ?`,
                args: [status, t, status, r.id, a.teamId],
              });
              stmts.push(logStmt(a.teamId, by, "status", { fileId: Number(r.id), folderId: r.folder_id ?? null, detail: { from: r.status, to: status } }));
            }
            break;
          }
          case "delete": {
            const n = await removeFiles(a.teamId, mine, by);
            return res.json({ success: true, files: n });
          }
          case "collect":
          case "uncollect": {
            const c = await dbGet("SELECT id, name FROM print_collections WHERE id = ? AND team_id = ?", Number(body.collectionId), a.teamId);
            if (!c) return res.status(404).json({ error: "That collection no longer exists" });
            const have = new Set((await dbAll(`SELECT file_id FROM print_collection_files WHERE collection_id = ? AND file_id IN (${qs(mine.length)})`, c.id, ...mine)).map((x) => Number(x.file_id)));
            const change = body.action === "collect" ? mine.filter((id) => !have.has(id)) : mine.filter((id) => have.has(id));
            for (const id of change) {
              stmts.push(body.action === "collect"
                // Only while the file and the collection still exist.
                ? { sql: `INSERT OR IGNORE INTO print_collection_files (collection_id, file_id, team_id, added_at)
                          SELECT ?, f.id, f.team_id, ? FROM print_files f WHERE f.id = ? AND f.team_id = ? AND EXISTS (SELECT 1 FROM print_collections c WHERE c.id = ? AND c.team_id = ?)`,
                    args: [c.id, t, id, a.teamId, c.id, a.teamId] }
                : { sql: "DELETE FROM print_collection_files WHERE collection_id = ? AND file_id = ? AND team_id = ?", args: [c.id, id, a.teamId] });
              stmts.push(logStmt(a.teamId, by, body.action, { fileId: id, detail: { collection: c.name, collectionId: Number(c.id) } }));
            }
            break;
          }
          default:
            return res.status(400).json({ error: "Unknown action" });
        }
        const changed = stmts.filter((x) => x.sql.startsWith("INSERT INTO print_activity")).length;
        if (changed) {
          try { await deps.dbBatchResults(stmts); }
          catch (e) {
            if (isAssert(e)) return res.status(404).json({ error: "That folder no longer exists" });
            if (isUnique(e)) return res.status(409).json({ error: "A file with one of those names just appeared there. Try again." });
            throw e;
          }
        }
        res.json({ success: true, files: changed });
      } catch (e) { sendError(res, e, "bulk"); }
    });

    app.get("/api/prints/files/:id/download", async (req, res) => {
      try {
        const a = await access(req, res, false); if (!a) return;
        const r = await dbGet("SELECT id, name, size, sha256, storage_key FROM print_files WHERE id = ? AND team_id = ?", Number(req.params.id), a.teamId);
        if (!r) return res.status(404).json({ error: "Not found" });
        const etag = `"p${r.id}-${String(r.sha256).slice(0, 16)}"`;
        res.setHeader("ETag", etag);
        res.setHeader("Cache-Control", "private, no-cache");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        if (req.headers["if-none-match"] === etag) return res.status(304).end();
        if (!(await store.exists(r.storage_key))) return res.status(404).json({ error: "This file is missing from storage" });
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", disposition("attachment", String(r.name)));
        res.setHeader("Content-Length", String(r.size));
        fs.createReadStream(store.pathOf(r.storage_key)).on("error", () => res.destroy()).pipe(res);
      } catch (e) { sendError(res, e, "download"); }
    });

    app.get("/api/prints/files/:id/thumbnail", async (req, res) => {
      try {
        const a = await access(req, res, false); if (!a) return;
        const r = await dbGet("SELECT id, thumb_key FROM print_files WHERE id = ? AND team_id = ?", Number(req.params.id), a.teamId);
        if (!r?.thumb_key || !(await store.exists(r.thumb_key))) return res.status(404).end();
        const etag = `"t${r.id}-${String(r.thumb_key).slice(-48, -16)}"`;
        res.setHeader("ETag", etag);
        res.setHeader("Cache-Control", "private, no-cache");
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (req.headers["if-none-match"] === etag) return res.status(304).end();
        res.setHeader("Content-Type", "image/png");
        fs.createReadStream(store.pathOf(r.thumb_key)).on("error", () => res.destroy()).pipe(res);
      } catch (e) { sendError(res, e, "thumbnail"); }
    });

    // A thumbnail drawn in the browser for a file that has none yet (field "thumbnail", PNG).
    app.put("/api/prints/files/:id/thumbnail", async (req, res) => {
      const cleanup: string[] = [];
      try {
        const a = await access(req, res, true); if (!a) return;
        const r = await dbGet("SELECT id, kind, storage_key FROM print_files WHERE id = ? AND team_id = ?", Number(req.params.id), a.teamId);
        if (!r) return res.status(404).json({ error: "Not found" });
        if (!canPreview(r.kind)) return res.status(400).json({ error: "Only STL, 3MF and OBJ files get thumbnails" });
        if ((Number(req.headers["content-length"]) || 0) > THUMB_MAX + 16 * 1024) return res.status(413).json({ error: "Thumbnails are up to 512 KB" });
        await new Promise<void>((resolve, reject) => upload.single("thumbnail")(req, res, (err: any) => {
          if ((req as any).file) cleanup.push((req as any).file.path);
          err ? reject(err instanceof PrintError ? err : new PrintError("unsupported", err?.message || "Upload failed")) : resolve();
        }));
        const f = (req as any).file;
        if (!f) return res.status(400).json({ error: "No thumbnail" });
        await saveThumb(a.teamId, Number(r.id), r.storage_key, await fsp.readFile(f.path), null);
        res.json({ success: true });
      } catch (e) { sendError(res, e, "thumbnail upload"); }
      finally { for (const p of cleanup) await fsp.unlink(p).catch(() => {}); }
    });

    // A ZIP of a folder (?folder=<id>|root, everything below it) or of chosen files (?files=1,2,3, kept in their
    // folders). ?name= names the ZIP (a group's name).
    app.get("/api/prints/zip", async (req, res) => {
      try {
        const a = await access(req, res, false); if (!a) return;
        const map = await folderTrailNames(a.teamId);
        let rows: any[] = [];
        let base: number | null = null;
        let zipName = "Prints";
        if (req.query.folder !== undefined) {
          if (req.query.folder === "root") rows = await dbAll("SELECT id, name, folder_id, size, storage_key, updated_at FROM print_files WHERE team_id = ?", a.teamId);
          else {
            const tree = await subtree(a.teamId, Number(req.query.folder));
            if (!tree.length) return res.status(404).json({ error: "Not found" });
            base = tree[0];
            zipName = map.get(base)?.name ?? zipName;
            rows = await dbAll(`SELECT id, name, folder_id, size, storage_key, updated_at FROM print_files WHERE team_id = ? AND folder_id IN (${qs(tree.length)})`, a.teamId, ...tree);
          }
        } else {
          const list = String(req.query.files || "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 5000);
          if (!list.length) return res.status(400).json({ error: "Pick some files" });
          rows = await dbAll(`SELECT id, name, folder_id, size, storage_key, updated_at FROM print_files WHERE team_id = ? AND id IN (${qs(list.length)})`, a.teamId, ...list);
          if (typeof req.query.name === "string" && req.query.name.trim()) zipName = safeName(req.query.name, "Prints");
        }
        if (!rows.length) return res.status(404).json({ error: "There are no files to download here" });
        if (rows.length > ZIP_MAX_ENTRIES) return res.status(413).json({ error: `One download holds at most ${ZIP_MAX_ENTRIES.toLocaleString("en-US")} files. Download smaller folders.` });
        const total = rows.reduce((s, r) => s + (Number(r.size) || 0), 0);
        if (total > ZIP_MAX_BYTES) return res.status(413).json({ error: "That's too much for one download. Download smaller folders." });
        const present: any[] = [];
        for (const r of rows) if (await store.exists(r.storage_key)) present.push(r);
        const names = uniqueZipNames(present.map((r) => [...trail(map, r.folder_id == null ? null : Number(r.folder_id), base), r.name].join("/")));
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", disposition("attachment", `${zipName}.zip`));
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        try {
          await writeZip(res, present.map((r, i) => ({ name: names[i], path: store.pathOf(r.storage_key), mtime: new Date(r.updated_at || Date.now()) })));
          res.end();
        } catch (e) {
          if (!res.writableEnded) res.destroy();
          if ((e as any)?.message !== "closed") console.error("Prints ZIP failed:", (e as any)?.message || e);
        }
      } catch (e) { if (!res.headersSent) sendError(res, e, "zip"); else res.destroy(); }
    });

    // ---- Collections ----
    app.post("/api/prints/collections", async (req, res) => {
      try {
        const a = await access(req, res, true); if (!a) return;
        const name = typeof req.body?.name === "string" ? req.body.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40) : "";
        if (!name) return res.status(400).json({ error: "Name the collection" });
        const count = await dbGet("SELECT COUNT(*) AS n FROM print_collections WHERE team_id = ?", a.teamId);
        if (Number(count?.n) >= MAX_COLLECTIONS) return res.status(400).json({ error: `A library holds at most ${MAX_COLLECTIONS} collections` });
        const by = { id: a.auth.memberId, name: await memberName(a.auth.memberId) };
        try {
          const r = await dbRun("INSERT INTO print_collections (team_id, name, created_by, created_at) VALUES (?, ?, ?, ?)", a.teamId, name, by.id, now());
          const log = logStmt(a.teamId, by, "collection_create", { detail: { name, collectionId: Number(r.lastInsertRowid) } });
          await dbRun(log.sql, ...log.args);
          res.json({ id: Number(r.lastInsertRowid), name });
        } catch (e) {
          if (isUnique(e)) return res.status(409).json({ error: `There's already a collection named "${name}"` });
          throw e;
        }
      } catch (e) { sendError(res, e, "collection create"); }
    });

    app.patch("/api/prints/collections/:id", async (req, res) => {
      try {
        const a = await access(req, res, true); if (!a) return;
        const c = await dbGet("SELECT id, name FROM print_collections WHERE id = ? AND team_id = ?", Number(req.params.id), a.teamId);
        if (!c) return res.status(404).json({ error: "Not found" });
        const name = typeof req.body?.name === "string" ? req.body.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40) : "";
        if (!name) return res.status(400).json({ error: "Name the collection" });
        const by = { id: a.auth.memberId, name: await memberName(a.auth.memberId) };
        try {
          await deps.dbBatchResults([
            { sql: "UPDATE print_collections SET name = ? WHERE id = ? AND team_id = ?", args: [name, c.id, a.teamId] },
            logStmt(a.teamId, by, "collection_rename", { detail: { from: c.name, to: name, collectionId: Number(c.id) } }),
          ]);
        } catch (e) {
          if (isUnique(e)) return res.status(409).json({ error: `There's already a collection named "${name}"` });
          throw e;
        }
        res.json({ id: Number(c.id), name });
      } catch (e) { sendError(res, e, "collection rename"); }
    });

    // Deleting a collection only ungroups its files; every file stays where it lives.
    app.delete("/api/prints/collections/:id", async (req, res) => {
      try {
        const a = await access(req, res, true); if (!a) return;
        const c = await dbGet("SELECT id, name FROM print_collections WHERE id = ? AND team_id = ?", Number(req.params.id), a.teamId);
        if (!c) return res.status(404).json({ error: "Not found" });
        const by = { id: a.auth.memberId, name: await memberName(a.auth.memberId) };
        await deps.dbBatchResults([
          { sql: "DELETE FROM print_collection_files WHERE collection_id = ? AND team_id = ?", args: [c.id, a.teamId] },
          { sql: "DELETE FROM print_collections WHERE id = ? AND team_id = ?", args: [c.id, a.teamId] },
          logStmt(a.teamId, by, "collection_delete", { detail: { name: c.name, collectionId: Number(c.id) } }),
        ]);
        res.json({ success: true });
      } catch (e) { sendError(res, e, "collection delete"); }
    });

    // Recent changes: the library's, or one file's (?file=).
    app.get("/api/prints/activity", async (req, res) => {
      try {
        const a = await access(req, res, false); if (!a) return;
        const file = Number(req.query.file);
        const rows = Number.isInteger(file) && file > 0
          ? await dbAll("SELECT id, file_id, folder_id, member_name, action, detail, at FROM print_activity WHERE team_id = ? AND file_id = ? ORDER BY id DESC LIMIT 50", a.teamId, file)
          : await dbAll("SELECT id, file_id, folder_id, member_name, action, detail, at FROM print_activity WHERE team_id = ? ORDER BY id DESC LIMIT 100", a.teamId);
        res.json(rows.map((r) => {
          let detail: any = {};
          try { detail = JSON.parse(r.detail || "{}"); } catch { /* none */ }
          return { id: Number(r.id), fileId: r.file_id == null ? null : Number(r.file_id), folderId: r.folder_id == null ? null : Number(r.folder_id), by: r.member_name || "Someone", action: r.action, detail, at: r.at };
        }));
      } catch (e) { sendError(res, e, "activity"); }
    });
  }

  // ---- Filing from inside the server (Control Kit) ----

  /** The folder at `segments` under the root, made as needed. */
  async function ensureFolders(teamId: number, segments: string[], by: { id: number | null; name: string }): Promise<number> {
    let parent: number | null = null;
    for (const name of segments) {
      const find = () => dbGet("SELECT id FROM print_folders WHERE team_id = ? AND COALESCE(parent_id, 0) = ? AND name = ? COLLATE NOCASE", teamId, parent ?? 0, name);
      let hit = await find();
      if (!hit) {
        const t = now();
        const r = await dbRun(`INSERT OR IGNORE INTO print_folders (team_id, parent_id, name, created_by, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${FOLDER_OK}`,
          teamId, parent, name, by.id, t, t, parent, parent, teamId);
        if (r.changes) { const l = logStmt(teamId, by, "folder_create", { folderId: Number(r.lastInsertRowid), detail: { name, parentId: parent } }); await dbRun(l.sql, ...l.args); }
        hit = await find();
        if (!hit) throw new PrintError("bad_name", "A folder on that path was deleted meanwhile; send again", 409);
      }
      parent = Number(hit.id);
    }
    return parent!;
  }

  /**
   * File a print from inside the server: `path` is the folder ("A / B / C" or segments, made as needed; unusable
   * characters in each part become "-"), `name` the file name with its extension. A file of the same name in that
   * folder that Control Kit sent before is replaced in place: its status, notes and collections stay, and a printed
   * one goes back to "To print" when the bytes changed. A same-named file a person uploaded is kept; the new one gets
   * "name (2)". Throws PrintError (unsupported, too_large, quota, disk_full, empty, bad_name).
   */
  async function filePrint(input: {
    teamId: number; path: string | readonly string[]; name: string; bytes: Uint8Array;
    by?: { memberId?: number | null; name?: string | null } | null; source?: "upload" | "control-kit";
    robotId?: number | null; cadPartId?: number | null; ckPartKey?: string | null;
  }): Promise<{ fileId: number; folderId: number; name: string; replaced: boolean; unchanged: boolean }> {
    const segments = (Array.isArray(input.path) ? [...input.path] : String(input.path).split("/")).map((s) => String(s).trim()).filter(Boolean).map((s) => safeName(s));
    if (!segments.length || segments.length > 12) throw new PrintError("bad_name", "A print needs a folder path");
    const name = safeName(input.name, "");
    if (!name) throw new PrintError("bad_name", "A print needs a file name");
    const kind = printKind(name);
    if (!kind) throw new PrintError("unsupported", "Prints takes STL, 3MF, STEP/STP, OBJ and G-code files");
    const bytes = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
    if (!bytes.length) throw new PrintError("empty", "That file is empty");
    if (bytes.length > limits.maxFile) throw new PrintError("too_large", `Files can be up to ${mbText(limits.maxFile)}`, 413);
    await checkDisk(bytes.length);
    const source = input.source ?? "control-kit";
    const by = { id: input.by?.memberId ?? null, name: input.by?.name || (source === "control-kit" ? "Control Kit" : "Control Point") };
    const folderId = await ensureFolders(input.teamId, segments, by);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const existing = await dbGet("SELECT * FROM print_files WHERE team_id = ? AND COALESCE(folder_id, 0) = ? AND name = ? COLLATE NOCASE", input.teamId, folderId, name);
    if (existing && existing.source === source && source === "control-kit" && (!input.ckPartKey || !existing.ck_part_key || existing.ck_part_key === input.ckPartKey)) {
      if (existing.sha256 === sha) return { fileId: Number(existing.id), folderId, name: existing.name, replaced: false, unchanged: true };
      const key = store.newKey(input.teamId);
      await store.write(key, bytes);
      const r = await dbRun(
        `UPDATE print_files SET size = ?, sha256 = ?, storage_key = ?, thumb_key = NULL, thumb_size = 0, updated_at = ?,
                status = CASE WHEN status = 'printed' THEN 'to_print' ELSE status END,
                robot_id = COALESCE(?, robot_id), cad_part_id = COALESCE(?, cad_part_id), ck_part_key = COALESCE(?, ck_part_key)
          WHERE id = ? AND team_id = ? AND storage_key = ?
            AND (SELECT COALESCE(SUM(size + thumb_size), 0) FROM print_files WHERE team_id = ?) - size - thumb_size + ? <= ?`,
        bytes.length, sha, key, now(), input.robotId ?? null, input.cadPartId ?? null, input.ckPartKey ?? null,
        existing.id, input.teamId, existing.storage_key, input.teamId, bytes.length, limits.quota);
      if (!r.changes) {
        await store.remove(key);
        const still = await dbGet("SELECT id FROM print_files WHERE id = ?", existing.id);
        if (still) throw new PrintError("quota", quotaMessage(), 413);
        // Deleted meanwhile: file it as new.
        return filePrint(input);
      }
      await store.remove(existing.storage_key);
      await store.remove(existing.thumb_key);
      const l = logStmt(input.teamId, by, "replace", { fileId: Number(existing.id), folderId, detail: { name: existing.name, size: bytes.length, wasPrinted: existing.status === "printed" } });
      await dbRun(l.sql, ...l.args);
      return { fileId: Number(existing.id), folderId, name: existing.name, replaced: true, unchanged: false };
    }
    const key = store.newKey(input.teamId);
    await store.write(key, bytes);
    let row: { id: number; name: string };
    try {
      row = await insertFile(input.teamId, { folderId, name, kind, size: bytes.length, sha, key, by, source, robotId: input.robotId, cadPartId: input.cadPartId, ckPartKey: input.ckPartKey });
    } catch (e) { await store.remove(key); throw e; }
    const l = logStmt(input.teamId, by, "upload", { fileId: row.id, folderId, detail: { name: row.name, size: bytes.length, source } });
    await dbRun(l.sql, ...l.args);
    return { fileId: row.id, folderId, name: row.name, replaced: false, unchanged: false };
  }

  /**
   * Control Kit's entry point: file a print for a robot under "<season name> / <robot name> / Control Kit", linked to
   * the robot and to the robot's CAD part with that Control Kit identity (cad_parts.ck_part_key) when there is one.
   */
  async function fileControlKitPrint(input: { teamId: number; robotId: number; name: string; bytes: Uint8Array; ckPartKey?: string | null; sentBy?: string | null }) {
    const robot = await dbGet("SELECT id, name, season FROM cad_robots WHERE id = ? AND team_id = ?", input.robotId, input.teamId);
    if (!robot) throw new PrintError("bad_name", "That robot no longer exists", 404);
    const part = input.ckPartKey
      ? await dbGet("SELECT id FROM cad_parts WHERE team_id = ? AND robot_id = ? AND ck_part_key = ? ORDER BY id LIMIT 1", input.teamId, robot.id, input.ckPartKey)
      : null;
    return filePrint({
      teamId: input.teamId, path: controlKitPrintPath(Number(robot.season), String(robot.name)), name: input.name, bytes: input.bytes,
      by: { name: input.sentBy ? `${input.sentBy} via Control Kit` : "Control Kit" }, source: "control-kit",
      robotId: Number(robot.id), cadPartId: part ? Number(part.id) : null, ckPartKey: input.ckPartKey ?? null,
    });
  }

  /** The bytes behind deleted rows (a deleted workspace). */
  async function removeStored(rows: { storage_key?: string | null; thumb_key?: string | null }[]) {
    for (const r of rows) { await store.remove(r.storage_key); await store.remove(r.thumb_key); }
  }

  return { registerRoutes, filePrint, fileControlKitPrint, removeStored, limits, store };
}

/** Where Control Kit's prints for a robot are filed: "2025–26 DECODE / Competition robot / Control Kit". */
export function controlKitPrintPath(season: number, robotName: string): string[] {
  return [safeName(seasonName(season)), safeName(robotName, "Robot"), "Control Kit"];
}

/** Statements that delete a workspace's library rows; the storage_key/thumb_key rows of the RETURNING one go to removeStored. */
export const PRINTS_WORKSPACE_DELETE = {
  files: "DELETE FROM print_files WHERE team_id = ? RETURNING storage_key, thumb_key",
  others: [
    "DELETE FROM print_collection_files WHERE team_id = ?",
    "DELETE FROM print_collections WHERE team_id = ?",
    "DELETE FROM print_folders WHERE team_id = ?",
    "DELETE FROM print_activity WHERE team_id = ?",
  ],
};
