// CAD by season and robot (migration 151). A team has robots per FTC season;
// each robot carries its own BOM (cad_parts.robot_id), Onshape assembly, files,
// reviews and snapshots. Members whose role has manage_cad choose a part's type
// and product here, and Control Kit reads those choices back (contract:
// control-kit docs/control-point-link.md v1.1 §5). Every route binds
// auth.teamId; cross-team ids are 404.
import type { Express } from "express";
import {
  BOM_GROUPS, currentSeason, effectivePart, isChoosableType, isSeason, parseOnshapeAssembly, seasonName, type BomGroup,
} from "../src/types/cadBom.js";

type Auth = { memberId: number; teamId: number | null };
export interface CadRobotDeps {
  dbGet: (sql: string, ...args: any[]) => Promise<any>;
  dbAll: (sql: string, ...args: any[]) => Promise<any[]>;
  dbRun: (sql: string, ...args: any[]) => Promise<{ lastInsertRowid: number; changes: number }>;
  dbBatchResults: (stmts: { sql: string; args?: any[] }[]) => Promise<{ lastInsertRowid: number; changes: number; rows: any[] }[]>;
  requireAuth: (req: any, res: any) => Promise<Auth | null>;
  hasPerm: (auth: Auth, perm: string) => Promise<boolean>;
}

export const MANAGE_CAD = "manage_cad";
const MAX_ROBOTS_PER_SEASON = 12;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const parseExtra = (raw: unknown) => { if (typeof raw !== "string" || !raw) return null; try { return JSON.parse(raw); } catch { return null; } };

/** The assembly picture a Control Kit import stored (contract v1.1: `{assembly} assembly.png`), or null. */
export function importPicture(files: unknown): string | null {
  let list: any[] = [];
  try { list = typeof files === "string" ? JSON.parse(files) || [] : Array.isArray(files) ? files : []; } catch { return null; }
  const hit = list.find((f) => f?.stored && typeof f.url === "string" && /\.(png|jpe?g|webp)$/i.test(String(f.name)));
  return hit ? String(hit.url) : null;
}

/** A part row with its Control Kit line parsed and the type/product in force worked out. */
export function partView(row: any) {
  const p = { ...row, ck_extra: parseExtra(row.ck_extra) };
  return { ...p, effective: effectivePart(p) };
}

/** Counts and money for a robot's BOM; rows a later scan dropped are left out. */
export function bomSummary(parts: any[]) {
  const counts = Object.fromEntries(BOM_GROUPS.map((g) => [g, 0])) as Record<BomGroup, number>;
  let total = 0, priced = 0, buyLines = 0, pending = 0;
  for (const p of parts) {
    if (p.ck_removed_at) continue;
    const e = p.effective;
    counts[e.group as BomGroup]++;
    if (e.typePending || e.productPending) pending++;
    if (e.group === "buy" || e.group === "hardware") {
      if (e.group === "buy") buyLines++;
      if (e.totalUsd !== null) { total += e.totalUsd; priced++; }
    }
  }
  return { counts, parts: Object.values(counts).reduce((a, b) => a + b, 0), totalUsd: Math.round(total * 100) / 100, priced, buyLines, pending };
}

/**
 * The robot a Control Kit import of this assembly belongs to (contract v1.1 "Where an import lands"): the robot linked to
 * it; else the main robot of the latest season with robots, if that robot has no assembly yet; else a new robot in the
 * current season named after the assembly.
 */
export async function robotForAssembly(deps: Pick<CadRobotDeps, "dbGet" | "dbRun">, teamId: number, documentId: string, elementId: string, assembly: { name: string; url: string | null }, memberId: number | null) {
  const linked = () => deps.dbGet("SELECT id, name, season FROM cad_robots WHERE team_id = ? AND document_id = ? AND element_id = ?", teamId, documentId, elementId);
  const hit = await linked();
  if (hit) return hit;
  const now = new Date().toISOString();
  const latest = await deps.dbGet("SELECT MAX(season) AS s FROM cad_robots WHERE team_id = ?", teamId);
  if (latest?.s != null) {
    const main = await deps.dbGet("SELECT id FROM cad_robots WHERE team_id = ? AND season = ? AND is_main = 1 ORDER BY id LIMIT 1", teamId, latest.s);
    if (main) {
      const took = await deps.dbRun("UPDATE cad_robots SET document_id = ?, element_id = ?, assembly_url = ?, updated_at = ? WHERE id = ? AND document_id IS NULL",
        documentId, elementId, assembly.url, now, main.id).catch(() => ({ changes: 0 }));
      if (took.changes) return linked();
    }
  }
  try { await insertRobot(deps, { teamId, season: currentSeason(), name: assembly.name || "Robot", documentId, elementId, assemblyUrl: assembly.url, memberId }); }
  catch { /* the same assembly's first send twice at once: the other one created it */ }
  return linked();
}

/**
 * Adds a robot. It is its season's main robot exactly when the season has none, decided inside the insert, and the
 * unique index on (team, season) where main enforces it: a second main that loses a race is inserted as not main.
 */
export async function insertRobot(deps: Pick<CadRobotDeps, "dbRun">, r: { teamId: number; season: number; name: string; documentId?: string | null; elementId?: string | null; assemblyUrl?: string | null; memberId?: number | null }) {
  const now = new Date().toISOString();
  const sql = (main: string) => `INSERT INTO cad_robots (team_id, season, name, is_main, document_id, element_id, assembly_url, created_by, created_at, updated_at)
    SELECT ?, ?, ?, ${main}, ?, ?, ?, ?, ?, ?`;
  const args = [r.teamId, r.season, r.name, r.documentId ?? null, r.elementId ?? null, r.assemblyUrl ?? null, r.memberId ?? null, now, now];
  const first = `CASE WHEN EXISTS (SELECT 1 FROM cad_robots WHERE team_id = ${Number(r.teamId)} AND season = ${Number(r.season)} AND is_main = 1) THEN 0 ELSE 1 END`;
  try { return await deps.dbRun(sql(first), ...args); }
  catch (e: any) {
    if (!/idx_cad_robots_main|UNIQUE constraint failed: cad_robots\.team_id, cad_robots\.season/i.test(String(e?.message))) throw e;
    return deps.dbRun(sql("0"), ...args);
  }
}

/** The robot a hand-made row (or an older client's) goes to: the main robot of the latest season, made if the team has none. */
export async function defaultRobotId(deps: Pick<CadRobotDeps, "dbGet" | "dbRun">, teamId: number): Promise<number> {
  const pick = () => deps.dbGet(
    `SELECT id FROM cad_robots WHERE team_id = ? ORDER BY season DESC, is_main DESC, id ASC LIMIT 1`, teamId);
  const hit = await pick();
  if (hit) return Number(hit.id);
  await insertRobot(deps, { teamId, season: currentSeason(), name: "Competition robot" });
  return Number((await pick()).id);
}

/** A robot id of this team from a request value, or null. */
export async function teamRobotId(deps: Pick<CadRobotDeps, "dbGet">, teamId: number, raw: unknown): Promise<number | null> {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await deps.dbGet("SELECT id FROM cad_robots WHERE id = ? AND team_id = ?", id, teamId);
  return row ? Number(row.id) : null;
}

export function createCadRobots(deps: CadRobotDeps) {
  const { dbGet, dbAll, dbRun } = deps;
  const teamOf = (auth: Auth, res: any) => {
    if (!auth.teamId) { res.status(400).json({ error: "Join a team first" }); return null; }
    return auth.teamId;
  };
  const canManage = (auth: Auth) => deps.hasPerm(auth, MANAGE_CAD);
  const memberName = async (id: number) => String((await dbGet("SELECT name FROM members WHERE id = ?", id))?.name || "A teammate");

  /** A robot's parts; the team's default robot also shows any row no robot holds (written by an older client). */
  async function robotParts(teamId: number, robotId: number) {
    const unassigned = robotId === (await defaultRobotId(deps, teamId)) ? " OR robot_id IS NULL" : "";
    const rows = await dbAll(
      `SELECT id, name, section, quantity, source, unit_cost, status, assignee, notes, created_at, updated_at, robot_id,
              ck_document_id, ck_element_id, ck_part_key, ck_import_id, ck_extra, ck_removed_at,
              choice_type, choice_type_set, choice_type_by, choice_type_at, choice_product, choice_product_by, choice_product_at
         FROM cad_parts WHERE team_id = ? AND (robot_id = ?${unassigned}) ORDER BY name COLLATE NOCASE, id`, teamId, robotId);
    return rows.map(partView);
  }

  function registerRoutes(app: Express) {
    // Seasons with their robots and each robot's BOM summary.
    app.get("/api/cad/robots", async (req, res) => {
      try {
        const auth = await deps.requireAuth(req, res);
        if (!auth) return;
        const teamId = teamOf(auth, res); if (!teamId) return;
        const robots = await dbAll(
          `SELECT r.*, (SELECT COUNT(*) FROM cad_docs d WHERE d.robot_id = r.id) AS files,
                  (SELECT COUNT(*) FROM cad_reviews v WHERE v.robot_id = r.id AND v.status = 'in_review') AS pending_reviews,
                  (SELECT COUNT(*) FROM cad_snapshots s WHERE s.robot_id = r.id) AS snapshots
             FROM cad_robots r WHERE r.team_id = ? ORDER BY r.season DESC, r.is_main DESC, r.id`, teamId);
        const parts = await dbAll(
          `SELECT robot_id, quantity, source, unit_cost, ck_extra, ck_removed_at, choice_type, choice_type_set, choice_type_at, choice_product, choice_product_at
             FROM cad_parts WHERE team_id = ?`, teamId);
        const byRobot = new Map<number, any[]>();
        // Rows no robot holds count on the default robot, as its page shows them.
        const fallback = robots.length ? Number(robots[0].id) : 0;
        for (const row of parts) {
          const k = Number(row.robot_id) || fallback;
          byRobot.set(k, [...(byRobot.get(k) ?? []), partView(row)]);
        }
        const imports = await dbAll(
          `SELECT i.robot_id, i.id, i.created_at, i.sent_by, i.assembly_name FROM cad_imports i
            WHERE i.team_id = ? AND i.id = (SELECT MAX(j.id) FROM cad_imports j WHERE j.team_id = i.team_id AND j.robot_id = i.robot_id)`, teamId);
        // Each robot's newest assembly picture, from whichever send carried one.
        const pictures = new Map<number, string>();
        for (const i of await dbAll("SELECT robot_id, files FROM cad_imports WHERE team_id = ? AND robot_id IS NOT NULL AND files LIKE '%.png%' ORDER BY id DESC", teamId)) {
          const url = importPicture(i.files);
          if (url && !pictures.has(Number(i.robot_id))) pictures.set(Number(i.robot_id), url);
        }
        const lastImport = new Map(imports.map((i) => [Number(i.robot_id), { id: Number(i.id), sentAt: i.created_at, sentBy: i.sent_by, assemblyName: i.assembly_name }]));
        const current = currentSeason();
        const seasons = [...new Set([current, ...robots.map((r) => Number(r.season))])].sort((a, b) => b - a);
        res.json({
          currentSeason: current,
          canManage: await canManage(auth),
          seasons: seasons.map((season) => ({
            season, name: seasonName(season),
            robots: robots.filter((r) => Number(r.season) === season).map((r) => ({
              id: Number(r.id), name: r.name, season: Number(r.season), isMain: !!r.is_main, assemblyUrl: r.assembly_url, documentId: r.document_id, elementId: r.element_id,
              notes: r.notes, files: Number(r.files) || 0, pendingReviews: Number(r.pending_reviews) || 0, snapshots: Number(r.snapshots) || 0,
              lastImport: lastImport.get(Number(r.id)) ?? null, picture: pictures.get(Number(r.id)) ?? null, bom: bomSummary(byRobot.get(Number(r.id)) ?? []),
            })),
          })),
        });
      } catch (e) { console.error("CAD robots list error:", e); res.status(500).json({ error: "Internal server error" }); }
    });

    app.post("/api/cad/robots", async (req, res) => {
      try {
        const auth = await deps.requireAuth(req, res);
        if (!auth) return;
        const teamId = teamOf(auth, res); if (!teamId) return;
        if (!(await canManage(auth))) return res.status(403).json({ error: "Your role can't manage CAD robots" });
        const season = Number(req.body?.season);
        if (!isSeason(season)) return res.status(400).json({ error: "Pick a season" });
        const name = str(req.body?.name, 80);
        if (!name) return res.status(400).json({ error: "Name the robot" });
        const assembly = req.body?.assemblyUrl ? parseOnshapeAssembly(req.body.assemblyUrl) : null;
        if (req.body?.assemblyUrl && !assembly) return res.status(400).json({ error: "Paste the link of an Onshape Assembly tab" });
        const count = await dbGet("SELECT COUNT(*) AS n FROM cad_robots WHERE team_id = ? AND season = ?", teamId, season);
        if (Number(count?.n) >= MAX_ROBOTS_PER_SEASON) return res.status(400).json({ error: `A season holds at most ${MAX_ROBOTS_PER_SEASON} robots` });
        try {
          const r = await insertRobot(deps, { teamId, season, name, documentId: assembly?.documentId, elementId: assembly?.elementId, assemblyUrl: assembly?.url, memberId: auth.memberId });
          res.json({ id: Number(r.lastInsertRowid) });
        } catch { res.status(409).json({ error: "Another robot already has that assembly" }); }
      } catch (e) { console.error("CAD robot create error:", e); res.status(500).json({ error: "Internal server error" }); }
    });

    app.patch("/api/cad/robots/:id", async (req, res) => {
      try {
        const auth = await deps.requireAuth(req, res);
        if (!auth) return;
        const teamId = teamOf(auth, res); if (!teamId) return;
        if (!(await canManage(auth))) return res.status(403).json({ error: "Your role can't manage CAD robots" });
        const robot = await dbGet("SELECT * FROM cad_robots WHERE id = ? AND team_id = ?", Number(req.params.id), teamId);
        if (!robot) return res.status(404).json({ error: "Not found" });
        const body = req.body || {};
        const sets: string[] = [];
        const args: any[] = [];
        if (body.name !== undefined) {
          const name = str(body.name, 80);
          if (!name) return res.status(400).json({ error: "Name the robot" });
          sets.push("name = ?"); args.push(name);
        }
        if (body.notes !== undefined) { sets.push("notes = ?"); args.push(str(body.notes, 2000)); }
        let season = Number(robot.season);
        if (body.season !== undefined) {
          if (!isSeason(Number(body.season))) return res.status(400).json({ error: "Pick a season" });
          season = Number(body.season);
          sets.push("season = ?"); args.push(season);
        }
        if (body.assemblyUrl !== undefined) {
          if (body.assemblyUrl === null || body.assemblyUrl === "") { sets.push("document_id = NULL, element_id = NULL, assembly_url = NULL"); }
          else {
            const a = parseOnshapeAssembly(body.assemblyUrl);
            if (!a) return res.status(400).json({ error: "Paste the link of an Onshape Assembly tab" });
            sets.push("document_id = ?, element_id = ?, assembly_url = ?"); args.push(a.documentId, a.elementId, a.url);
          }
        }
        const makeMain = body.isMain === true;
        if (!sets.length && !makeMain) return res.status(400).json({ error: "Nothing to update" });
        const now = new Date().toISOString();
        const stmts: { sql: string; args: any[] }[] = [];
        // One main robot per season (a unique index enforces it): a moving robot steps down before it changes season, and
        // the old main steps down before another takes over.
        const moved = season !== Number(robot.season);
        if (moved) stmts.push({ sql: "UPDATE cad_robots SET is_main = 0 WHERE id = ?", args: [robot.id] });
        if (sets.length) stmts.push({ sql: `UPDATE cad_robots SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, args: [...args, now, robot.id] });
        if (makeMain) {
          stmts.push({ sql: "UPDATE cad_robots SET is_main = 0 WHERE team_id = ? AND season = ? AND id <> ? AND is_main = 1", args: [teamId, season, robot.id] });
          stmts.push({ sql: "UPDATE cad_robots SET is_main = 1 WHERE id = ?", args: [robot.id] });
        } else if (moved) {
          // A moved robot leads its new season only when that season had none.
          stmts.push({ sql: "UPDATE cad_robots SET is_main = CASE WHEN EXISTS (SELECT 1 FROM cad_robots o WHERE o.team_id = ? AND o.season = ? AND o.id <> ? AND o.is_main = 1) THEN 0 ELSE 1 END WHERE id = ?", args: [teamId, season, robot.id, robot.id] });
        }
        // The season it left keeps a main robot, whichever way it moved.
        if (moved) {
          stmts.push({ sql: `UPDATE cad_robots SET is_main = 1 WHERE id = (SELECT id FROM cad_robots WHERE team_id = ? AND season = ? ORDER BY id LIMIT 1)
                               AND NOT EXISTS (SELECT 1 FROM cad_robots WHERE team_id = ? AND season = ? AND is_main = 1)`, args: [teamId, robot.season, teamId, robot.season] });
        }
        try { await deps.dbBatchResults(stmts); } catch { return res.status(409).json({ error: "Another robot already has that assembly" }); }
        res.json({ success: true });
      } catch (e) { console.error("CAD robot update error:", e); res.status(500).json({ error: "Internal server error" }); }
    });

    // One robot: its BOM with every Control Kit line, its imports and files.
    app.get("/api/cad/robots/:id", async (req, res) => {
      try {
        const auth = await deps.requireAuth(req, res);
        if (!auth) return;
        const teamId = teamOf(auth, res); if (!teamId) return;
        const robot = await dbGet("SELECT * FROM cad_robots WHERE id = ? AND team_id = ?", Number(req.params.id), teamId);
        if (!robot) return res.status(404).json({ error: "Not found" });
        const parts = await robotParts(teamId, Number(robot.id));
        const imports = (await dbAll(
          "SELECT id, created_at, sent_by, assembly_name, assembly_url, revision, part_count, files, result FROM cad_imports WHERE team_id = ? AND robot_id = ? ORDER BY id DESC LIMIT 10",
          teamId, robot.id)).map((i) => {
          let files: any[] = []; let result: any = {};
          try { files = JSON.parse(i.files || "[]") || []; } catch { /* none */ }
          try { result = JSON.parse(i.result || "{}") || {}; } catch { /* zeros */ }
          return { id: Number(i.id), sentAt: i.created_at, sentBy: i.sent_by, assemblyName: i.assembly_name, assemblyUrl: i.assembly_url, revision: i.revision,
            partCount: Number(i.part_count) || 0, files, created: Number(result.created) || 0, updated: Number(result.updated) || 0, markedRemoved: Number(result.markedRemoved) || 0 };
        });
        res.json({
          robot: { id: Number(robot.id), name: robot.name, season: Number(robot.season), seasonName: seasonName(Number(robot.season)), isMain: !!robot.is_main,
            assemblyUrl: robot.assembly_url, documentId: robot.document_id, elementId: robot.element_id, notes: robot.notes },
          canManage: await canManage(auth), parts, summary: bomSummary(parts), imports,
        });
      } catch (e) { console.error("CAD robot detail error:", e); res.status(500).json({ error: "Internal server error" }); }
    });

    // Which robot holds a record, for old /cad-parts?id= style links (null when it is on no robot).
    const RECORD_TABLES: Record<string, string> = { part: "cad_parts", doc: "cad_docs", review: "cad_reviews", snapshot: "cad_snapshots", import: "cad_imports" };
    app.get("/api/cad/records/:kind/:id/robot", async (req, res) => {
      try {
        const auth = await deps.requireAuth(req, res);
        if (!auth) return;
        const teamId = teamOf(auth, res); if (!teamId) return;
        const table = RECORD_TABLES[req.params.kind];
        if (!table) return res.status(400).json({ error: "Unknown record" });
        const row = await dbGet(`SELECT robot_id FROM ${table} WHERE id = ? AND team_id = ?`, Number(req.params.id), teamId);
        if (!row) return res.status(404).json({ error: "Not found" });
        res.json({ robotId: row.robot_id ? Number(row.robot_id) : await defaultRobotId(deps, teamId) });
      } catch (e) { console.error("CAD record robot error:", e); res.status(500).json({ error: "Internal server error" }); }
    });

    // A person's choice for an imported part: its type, its product, or both. Recorded in the part's history.
    app.post("/api/cad/parts/:id/choice", async (req, res) => {
      try {
        const auth = await deps.requireAuth(req, res);
        if (!auth) return;
        const teamId = teamOf(auth, res); if (!teamId) return;
        if (!(await canManage(auth))) return res.status(403).json({ error: "Your role can't make CAD choices" });
        const row = await dbGet("SELECT * FROM cad_parts WHERE id = ? AND team_id = ?", Number(req.params.id), teamId);
        if (!row) return res.status(404).json({ error: "Not found" });
        if (!row.ck_part_key) return res.status(400).json({ error: "Only parts from Control Kit take these choices" });
        const part = partView(row);
        const body = req.body || {};
        const hasType = Object.prototype.hasOwnProperty.call(body, "type");
        const hasProduct = Object.prototype.hasOwnProperty.call(body, "product");
        if (!hasType && !hasProduct) return res.status(400).json({ error: "Nothing to choose" });
        if (hasType && body.type !== null && !isChoosableType(body.type)) return res.status(400).json({ error: "Unknown part type" });
        let product: string | null = null;
        if (hasProduct && body.product !== null) {
          product = part.effective.candidates.find((c: any) => c.id === body.product)?.id ?? null;
          if (!product) return res.status(400).json({ error: "That product isn't one of this part's matches" });
        }
        const name = await memberName(auth.memberId);
        const now = new Date().toISOString();
        let type: string | null | undefined = hasType ? body.type : undefined;
        // Picking a product means buying it.
        if (product && type === undefined && part.effective.type !== "buy") type = "buy";
        const stmts: { sql: string; args: any[] }[] = [];
        if (type !== undefined) {
          stmts.push({ sql: "UPDATE cad_parts SET choice_type = ?, choice_type_set = 1, choice_type_by = ?, choice_type_by_id = ?, choice_type_at = ? WHERE id = ?", args: [type, name, auth.memberId, now, row.id] });
          stmts.push({ sql: "INSERT INTO cad_part_choices (team_id, part_id, kind, value, by_member_id, by_name, at) VALUES (?, ?, 'type', ?, ?, ?, ?)", args: [teamId, row.id, type, auth.memberId, name, now] });
        }
        if (hasProduct) {
          stmts.push({ sql: "UPDATE cad_parts SET choice_product = ?, choice_product_by = ?, choice_product_by_id = ?, choice_product_at = ? WHERE id = ?",
            args: [product, product ? name : null, product ? auth.memberId : null, product ? now : null, row.id] });
          stmts.push({ sql: "INSERT INTO cad_part_choices (team_id, part_id, kind, value, by_member_id, by_name, at) VALUES (?, ?, 'product', ?, ?, ?, ?)", args: [teamId, row.id, product, auth.memberId, name, now] });
        }
        await deps.dbBatchResults(stmts);
        const fresh = await dbGet("SELECT * FROM cad_parts WHERE id = ?", row.id);
        res.json(partView(fresh));
      } catch (e) { console.error("CAD part choice error:", e); res.status(500).json({ error: "Internal server error" }); }
    });

    app.get("/api/cad/parts/:id/choices", async (req, res) => {
      try {
        const auth = await deps.requireAuth(req, res);
        if (!auth) return;
        const teamId = teamOf(auth, res); if (!teamId) return;
        const rows = await dbAll("SELECT kind, value, by_name, at FROM cad_part_choices WHERE team_id = ? AND part_id = ? ORDER BY id DESC LIMIT 50", teamId, Number(req.params.id));
        res.json(rows);
      } catch (e) { console.error("CAD part choices error:", e); res.status(500).json({ error: "Internal server error" }); }
    });
  }

  /** Control Kit's read of the choices made here for one document (contract §5): newest per identity, at most 2,000. */
  async function decisionsFor(teamId: number, documentId: string) {
    const rows = await dbAll(
      `SELECT ck_part_key, ck_element_id, choice_type, choice_type_set, choice_type_by, choice_type_at, choice_product, choice_product_by, choice_product_at
         FROM cad_parts WHERE team_id = ? AND ck_document_id = ? AND ck_part_key IS NOT NULL AND (choice_type_set = 1 OR choice_product IS NOT NULL)
        ORDER BY MAX(COALESCE(choice_type_at, ''), COALESCE(choice_product_at, '')) DESC LIMIT 4000`, teamId, documentId);
    const out = new Map<string, any>();
    for (const r of rows) {
      const k = String(r.ck_part_key);
      const d = out.get(k) ?? { identity: k, elementId: String(r.ck_element_id), type: null, product: null };
      if (r.choice_type_set && (!d.type || r.choice_type_at > d.type.at)) d.type = { value: isChoosableType(r.choice_type) ? r.choice_type : null, by: r.choice_type_by || "A teammate", at: r.choice_type_at };
      if (r.choice_product && (!d.product || r.choice_product_at > d.product.at)) {
        const [vendor, normalizedSku] = String(r.choice_product).split(":");
        d.product = { vendor, normalizedSku, by: r.choice_product_by || "A teammate", at: r.choice_product_at };
      }
      out.set(k, d);
    }
    return [...out.values()].slice(0, 2000);
  }

  return { registerRoutes, decisionsFor };
}
