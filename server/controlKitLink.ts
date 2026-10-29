// Control Kit link (contract: control-kit docs/control-point-link.md, v1.2).
// Control Kit, the Onshape BOM app, links to a Control Point account with an
// authorization code, then sends reviewed BOMs into a workspace's parts list
// with a bearer token. A grant belongs to an account (its email), never to a
// workspace: every bearer call names the workspace, and membership (plus CAD
// edit rights for a send) is checked on every call.
//
// Codes and tokens are stored as SHA-256 only. The bearer routes are server
// to server (the Control Kit Worker), so they are registered before the /api
// session and CSRF guard, like /internal; the consent routes use the normal
// session and sit behind it.
import express, { type Express } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { RateLimiter, clientIp } from "./rateLimit.js";
import { sanitizePartInput } from "./cad.js";
import { robotForAssembly } from "./cadRobots.js";
import { checkReviewAsk, reviewConfigured, ReviewError, runReview } from "./controlKitAi.js";
import { parseDisabledModules } from "../src/types/teamModules.js";

type Auth = { memberId: number; teamId: number | null; teamless?: boolean; email?: string };
export interface ControlKitDeps {
  dbGet: (sql: string, ...args: any[]) => Promise<any>;
  dbAll: (sql: string, ...args: any[]) => Promise<any[]>;
  dbRun: (sql: string, ...args: any[]) => Promise<{ lastInsertRowid: number; changes: number }>;
  dbBatchResults: (stmts: { sql: string; args?: any[] }[]) => Promise<{ lastInsertRowid: number; changes: number; rows: any[] }[]>;
  requireAuth: (req: any, res: any) => Promise<Auth | null>;
  authEmail: (auth: Auth) => Promise<string>;
  storeFile: (opts: { teamId: number; memberId: number; kind: string; filename: string; mimeType: string; buffer: Buffer }) => Promise<number>;
  fileUrl: (id: number) => string;
  /** This server's public origin, e.g. https://tryctrlpoint.org. */
  appUrl: (req: any) => string;
  env: Record<string, string | undefined>;
  /** Choices made in Control Point for one document's parts (cadRobots.decisionsFor). */
  decisionsFor: (teamId: number, documentId: string) => Promise<any[]>;
  /** Delete a stored file by its /api/files/:id URL (best effort): a replaced upload or picture. */
  deleteStoredFile?: (url: string) => Promise<void>;
  /** The fetch behind AI review's model calls (controlKitAi.runReview); tests swap it. */
  reviewFetch?: typeof fetch;
  /**
   * A STEP zip stored for an import on a robot: the Prints library files its 3D-print STEPs under
   * "Season / Robot / Control Kit" (server/prints.ts fileControlKitStepZip). Called after the answer, best effort.
   */
  fileStepZip?: (input: { teamId: number; robotId: number; zip: Buffer; sentBy: string | null }) => Promise<unknown>;
}

export const CONTROL_KIT_CLIENT_ID = "control-kit";
export const DEFAULT_CONTROL_KIT_REDIRECT_URIS = ["https://control-kit.control-kit-worker.workers.dev/control-point/callback"];
export const CODE_TTL_MS = 5 * 60 * 1000;
export const BOM_LIMIT = "12mb";
const MAX_CAD_PARTS = 5000;
const MAX_FILES = 20;
const TOKEN_PREFIX = "ckp_";
/** A file uploaded after a send (contract v1.2 §6): the STEP zip, a large workbook, or a CSV. */
export const FILE_LIMIT_BYTES = 64 * 1024 * 1024;
export const UPLOAD_TYPES: Record<string, RegExp> = {
  "application/zip": /\.zip$/i,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": /\.xlsx$/i,
  "text/csv": /\.csv$/i,
};
/** Part pictures: one call holds at most this many, each a PNG of at most 1 MB. */
export const PICTURES_PER_CALL = 40;
export const PICTURE_LIMIT_BYTES = 1024 * 1024;
export const PICTURES_BODY_LIMIT = "8mb";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** AI review per workspace (contract v1.2 §7): at most this many an hour and a day. Control Kit keeps its own per-person limits. */
export const AI_REVIEWS_PER_HOUR = 20;
export const AI_REVIEWS_PER_DAY = 100;

/** A file name as uploaded: 1 to 160 characters, no path separators or control characters. */
export function uploadName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.trim();
  return name && name.length <= 160 && !/[\\/\u0000-\u001f\u007f]/.test(name) && name !== "." && name !== ".." ? name : null;
}
/** Which placeholder an uploaded file fills: a bundle lists a missing STEP zip or workbook by a label, not a file name. */
function fillsPlaceholder(entry: any, name: string): boolean {
  if (entry?.stored) return false;
  const n = String(entry?.name || "");
  if (/\.zip$/i.test(name)) return /\.zip$/i.test(n) || /\bSTEP\b/i.test(n);
  if (/\.xlsx$/i.test(name)) return /\.xlsx$/i.test(n) || /\b(Excel|workbook)\b/i.test(n);
  if (/\.csv$/i.test(name)) return /\.csv$/i.test(n);
  return false;
}
/** How many entries an import's file list may reach through uploads; a full list refuses a new name rather than drop one. */
export const MAX_IMPORT_FILES = 2 * MAX_FILES;
/**
 * An import's files with `upload` in place of the entry of the same name, or of the placeholder it fills, else appended.
 * Null when appending would pass MAX_IMPORT_FILES: no existing entry is ever dropped to make room.
 */
export function withUploadedFile(files: any[], upload: any): any[] | null {
  const same = files.findIndex((f) => f?.name === upload.name);
  const at = same >= 0 ? same : files.findIndex((f) => fillsPlaceholder(f, upload.name));
  if (at < 0) return files.length >= MAX_IMPORT_FILES ? null : [...files, upload];
  return files.map((f, i) => (i === at ? upload : f));
}
/** An unfinished import whose claim is older than this was abandoned; a retry finishes it. */
export const IMPORT_STALL_MS = 2 * 60 * 1000;
/** A claim on an unfinished import: when it was taken (so it ages and sorts like a timestamp) plus who took it. */
const newClaim = () => `${new Date().toISOString()}#${randomBytes(6).toString("hex")}`;

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const hexColor = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The redirect URIs Control Point will send a code to: CONTROL_KIT_REDIRECT_URIS (comma-separated) or the production Worker. */
export function redirectAllowlist(env: Record<string, string | undefined>): string[] {
  const list = String(env.CONTROL_KIT_REDIRECT_URIS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_CONTROL_KIT_REDIRECT_URIS;
}

/** Exact match only: no prefixes, no added paths or query strings. */
export function isAllowedRedirect(uri: unknown, env: Record<string, string | undefined>): uri is string {
  return typeof uri === "string" && redirectAllowlist(env).includes(uri);
}

/** `Authorization: Basic base64("control-kit:" + secret)` against CONTROL_KIT_CLIENT_SECRET, in constant time. */
export function clientSecretMatches(header: unknown, secret: string | undefined): boolean {
  if (!secret || typeof header !== "string" || !/^Basic\s+/i.test(header)) return false;
  let decoded = "";
  try { decoded = Buffer.from(header.replace(/^Basic\s+/i, "").trim(), "base64").toString("utf8"); } catch { return false; }
  const at = decoded.indexOf(":");
  if (at < 0 || decoded.slice(0, at) !== CONTROL_KIT_CLIENT_ID) return false;
  return timingSafeEqual(Buffer.from(sha256(decoded.slice(at + 1)), "hex"), Buffer.from(sha256(secret), "hex"));
}

/** Where a code (or a refusal) goes: the allowlisted redirect URI with its query added. */
export function redirectWith(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** Control Kit's stable identity for a part: extra.identity, or the same document:element:part:configuration built from the line.
 *  Never cut short: an identity over 500 characters (long configurations) is kept as its SHA-256, so two parts can't merge. */
export function partKey(extra: any): string | null {
  const whole = (k: string) => (k.length <= 500 ? k : `sha256:${sha256(k)}`);
  const identity = typeof extra?.identity === "string" ? extra.identity.trim() : "";
  if (identity) return whole(identity);
  if (typeof extra?.documentId === "string" && typeof extra?.elementId === "string" && typeof extra?.partId === "string" && extra.partId) {
    return whole(`${extra.documentId}:${extra.elementId}:${extra.partId}:${typeof extra.configuration === "string" ? extra.configuration : ""}`);
  }
  return null;
}

type PayloadCheck = { ok: boolean; detail?: string };
/** The checks the contract names for a BOM payload (400 bad_payload). */
export function checkPayload(body: any): PayloadCheck {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, detail: "Body must be a JSON object." };
  if (body.source !== "control-kit") return { ok: false, detail: 'source must be "control-kit".' };
  if (body.bundleVersion !== 2) return { ok: false, detail: "bundleVersion must be 2." };
  if (!Array.isArray(body.cadParts)) return { ok: false, detail: "cadParts is missing." };
  if (body.cadParts.length > MAX_CAD_PARTS) return { ok: false, detail: `At most ${MAX_CAD_PARTS} cadParts.` };
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() || body.idempotencyKey.length > 200) return { ok: false, detail: "idempotencyKey is missing." };
  if (!str(body.assembly?.documentId, 100) || !str(body.assembly?.elementId, 100)) return { ok: false, detail: "assembly.documentId and assembly.elementId are required." };
  if (body.files !== undefined && (!Array.isArray(body.files) || body.files.length > MAX_FILES)) return { ok: false, detail: `files must be a list of at most ${MAX_FILES}.` };
  for (let i = 0; i < body.cadParts.length; i++) {
    const p = body.cadParts[i];
    if (!partKey(p?.extra)) return { ok: false, detail: `cadParts[${i}].extra.identity is missing.` };
    const parsed = sanitizePartInput(p);
    if (!parsed.ok) return { ok: false, detail: `cadParts[${i}]: ${parsed.error}` };
  }
  return { ok: true };
}

/** Revoke every Control Kit token of an account and void its unused codes (Disconnect). */
export function revokeGrantsSql(email: string, now: string) {
  return [
    { sql: "UPDATE control_kit_tokens SET revoked_at = ? WHERE LOWER(email) = LOWER(?) AND revoked_at IS NULL", args: [now, email] },
    { sql: "UPDATE control_kit_codes SET used_at = ? WHERE LOWER(email) = LOWER(?) AND used_at IS NULL", args: [now, email] },
  ];
}

/** Forget an account's Control Kit grants entirely (account deletion): a later account with the same email starts unlinked. */
export function deleteGrantsSql(email: string) {
  return [
    { sql: "DELETE FROM control_kit_tokens WHERE LOWER(email) = LOWER(?)", args: [email] },
    { sql: "DELETE FROM control_kit_codes WHERE LOWER(email) = LOWER(?)", args: [email] },
  ];
}

export function createControlKitLink(deps: ControlKitDeps) {
  const { dbGet, dbAll, dbRun } = deps;
  const limiter = new RateLimiter();
  setInterval(() => limiter.sweep(), 10 * 60 * 1000).unref();
  const configured = () => !!deps.env.CONTROL_KIT_CLIENT_SECRET;
  // How long a retry waits for an import another request is still finishing before answering 503 in_progress.
  const replayWaitMs = deps.env.CONTROL_KIT_REPLAY_WAIT_MS ? Math.max(0, Number(deps.env.CONTROL_KIT_REPLAY_WAIT_MS) || 0) : 20_000;
  const cadUrl = (req: any) => `${deps.appUrl(req)}/cad-parts`;
  /** An import opens on its robot's BOM; one without a robot (sent before robots existed) on /cad-parts, which redirects. */
  const importUrl = (req: any, id: number, robotId?: number | null) => robotId ? `${deps.appUrl(req)}/cad/robots/${robotId}?import=${id}` : `${cadUrl(req)}?import=${id}`;
  /** 429 with Retry-After once `key` is over `max` calls a minute. */
  const throttled = (res: any, key: string, max: number) => {
    const wait = limiter.hit(key, { max, windowMs: 60 * 1000 });
    if (!wait) return false;
    res.setHeader("Retry-After", String(wait));
    res.status(429).json({ error: "rate_limited", retryAfter: wait });
    return true;
  };

  async function accountOf(email: string) {
    const row = await dbGet("SELECT name FROM members WHERE LOWER(email) = LOWER(?) ORDER BY COALESCE(is_active, 1) DESC, id DESC LIMIT 1", email);
    return { email, name: row?.name || email.split("@")[0] };
  }
  /** The account's active memberships, one per workspace, as Control Kit sees them. */
  async function workspacesOf(req: any, email: string) {
    const rows = await dbAll(
      `SELECT t.id, t.name, t.ftc_team_number, t.accent_color, t.disabled_modules FROM members m JOIN teams t ON t.id = m.team_id
        WHERE LOWER(m.email) = LOWER(?) AND COALESCE(m.is_active, 1) = 1 ORDER BY t.id`, email);
    return rows.map((t) => ({
      id: Number(t.id), name: String(t.name), ftcNumber: t.ftc_team_number ? String(t.ftc_team_number) : null,
      accentColor: hexColor(t.accent_color), canEditCad: canEditCad(t), cadUrl: cadUrl(req),
    }));
  }
  /** CAD parts are edited by any active member (server.ts /api/cad/parts); a workspace that switched the CAD module off takes no BOMs. */
  const canEditCad = (team: any) => !parseDisabledModules(team?.disabled_modules).includes("cad");
  async function membership(email: string, teamId: number) {
    if (!Number.isInteger(teamId) || teamId <= 0) return null;
    return await dbGet(
      `SELECT m.id AS member_id, m.name AS member_name, t.id, t.name, t.ftc_team_number, t.disabled_modules FROM members m JOIN teams t ON t.id = m.team_id
        WHERE LOWER(m.email) = LOWER(?) AND m.team_id = ? AND COALESCE(m.is_active, 1) = 1 LIMIT 1`, email, teamId) || null;
  }

  /** The bearer token's account, or a 401/429 already sent. */
  async function bearer(req: any, res: any): Promise<{ id: number; email: string; hash: string } | null> {
    if (throttled(res, `ip:${clientIp(req)}`, 120)) return null;
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ""));
    const token = m?.[1] || "";
    const row = token.startsWith(TOKEN_PREFIX)
      ? await dbGet("SELECT id, email FROM control_kit_tokens WHERE token_hash = ? AND revoked_at IS NULL", sha256(token))
      : null;
    if (!row) { res.status(401).json({ error: "revoked" }); return null; }
    const hash = sha256(token);
    if (throttled(res, `token:${hash}`, 30)) return null;
    await dbRun("UPDATE control_kit_tokens SET last_used_at = ? WHERE id = ?", new Date().toISOString(), row.id).catch(() => {});
    return { id: Number(row.id), email: String(row.email), hash };
  }
  /** Bearer token plus an active membership of :id; `cad` also needs CAD edit rights. */
  const guard = (cad: boolean) => async (req: any, res: any, next: any) => {
    try {
      const who = await bearer(req, res);
      if (!who) return;
      const team = await membership(who.email, Number(req.params.id));
      if (!team) return res.status(403).json({ error: "not_member" });
      if (cad && !canEditCad(team)) return res.status(403).json({ error: "no_cad_edit" });
      req.ck = { ...who, team };
      next();
    } catch (e) { console.error("Control Kit guard error:", e); res.status(500).json({ error: "server_error" }); }
  };

  function importSummary(req: any, row: any) {
    let result: any = {};
    try { result = JSON.parse(row.result || "{}") || {}; } catch { /* keep zeros */ }
    return {
      importId: Number(row.id), idempotencyKey: String(row.idempotency_key), sentAt: String(row.created_at), sentBy: row.sent_by || null,
      created: Number(result.created) || 0, updated: Number(result.updated) || 0, markedRemoved: Number(result.markedRemoved) || 0,
      filesStored: Number(result.filesStored) || 0, url: importUrl(req, Number(row.id), row.robot_id ? Number(row.robot_id) : null),
    };
  }
  const bomResponse = async (req: any, row: any, team: any, duplicate: boolean) => {
    const s = importSummary(req, row);
    const robot = row.robot_id ? await dbGet("SELECT id, name, season FROM cad_robots WHERE id = ?", row.robot_id) : null;
    return {
      importId: s.importId, duplicate, workspace: { id: Number(team.id), name: String(team.name), ftcNumber: team.ftc_team_number ? String(team.ftc_team_number) : null },
      created: s.created, updated: s.updated, markedRemoved: s.markedRemoved, filesStored: s.filesStored, url: s.url, sentAt: s.sentAt,
      robot: robot ? { id: Number(robot.id), name: String(robot.name), season: Number(robot.season) } : null,
    };
  };

  /** Hold on to an import's claim a little longer; false once another request took it over. */
  async function renewClaim(importId: number, claim: { value: string }) {
    const next = newClaim();
    const r = await dbRun("UPDATE cad_imports SET claimed_at = ? WHERE id = ? AND claimed_at = ? AND finished_at IS NULL", next, importId, claim.value);
    if (r.changes) claim.value = next;
    return r.changes > 0;
  }

  /** Store the bundle's inline files as CAD docs of the import; references are recorded as available in Control Kit.
   *  The claim is renewed around every file, and a file is recorded only while it is still held: null once it was lost. */
  async function storeFiles(teamId: number, memberId: number, importId: number, body: any, claim: { value: string }) {
    const out: any[] = [];
    let stored = 0;
    // A retry finishing a stalled import keeps the files that were already stored.
    const already = new Map<string, string>((await dbAll("SELECT name, url FROM cad_docs WHERE team_id = ? AND ck_import_id = ?", teamId, importId))
      .map((r) => [String(r.name), String(r.url)]));
    for (const f of Array.isArray(body.files) ? body.files : []) {
      const name = str(f?.name, 160) || "Control Kit file";
      const base = { name, mediaType: str(f?.mediaType, 120) || "application/octet-stream", sizeBytes: Number(f?.sizeBytes) || null, sha256: str(f?.sha256, 64) || null };
      const content = typeof f?.contentBase64 === "string" ? f.contentBase64 : typeof f?.content === "string" ? f.content : null;
      if (f?.delivery === "reference" || content === null) { out.push({ ...base, stored: false, note: "Available in Control Kit" }); continue; }
      if (already.has(name)) { out.push({ ...base, stored: true, url: already.get(name) }); stored++; continue; }
      const buffer = Buffer.from(content, "base64");
      if (base.sha256 && sha256(buffer) !== base.sha256.toLowerCase()) { out.push({ ...base, stored: false, note: "Not stored: its checksum did not match" }); continue; }
      if (!(await renewClaim(importId, claim))) return null;
      try {
        const fileId = await deps.storeFile({ teamId, memberId, kind: "cad", filename: name, mimeType: base.mediaType, buffer });
        const url = deps.fileUrl(fileId);
        // Recorded only by the claim's holder, renewing it in the same transaction.
        const next = newClaim();
        const [held] = await deps.dbBatchResults([
          { sql: "UPDATE cad_imports SET claimed_at = ? WHERE id = ? AND claimed_at = ? AND finished_at IS NULL", args: [next, importId, claim.value] },
          { sql: "INSERT INTO cad_docs (team_id, name, url, created_by, created_at, ck_import_id, robot_id) SELECT ?, ?, ?, ?, ?, ?, (SELECT robot_id FROM cad_imports WHERE id = ?) WHERE changes() = 1",
            args: [teamId, name, url, memberId, new Date().toISOString(), importId, importId] },
        ]);
        if (!held.changes) return null;
        claim.value = next;
        out.push({ ...base, sizeBytes: buffer.length, stored: true, url });
        stored++;
      } catch (e) {
        console.error("Control Kit file store failed:", (e as any)?.message || e);
        out.push({ ...base, stored: false, note: "Not stored: saving it failed" });
      }
    }
    for (const f of Array.isArray(body.filesNotIncluded) ? body.filesNotIncluded.slice(0, MAX_FILES) : []) {
      out.push({ name: str(f?.name, 160) || "File", stored: false, note: str(f?.reason, 300) || "Not included in this bundle" });
    }
    return { files: out, stored };
  }

  /** Store the import's files, mark it finished and answer. Only the request holding the import's claim gets here;
   *  if another request takes the claim over meanwhile, this one stops writing and waits for that one's result. */
  async function finishImport(req: any, res: any, importId: number, team: any, body: any, duplicate: boolean, claim: { value: string }) {
    const files = await storeFiles(Number(team.id), Number(team.member_id), importId, body, claim);
    const done = files && await dbRun(
      "UPDATE cad_imports SET files = ?, result = json_set(COALESCE(result, '{}'), '$.filesStored', ?), finished_at = ? WHERE id = ? AND claimed_at = ? AND finished_at IS NULL",
      JSON.stringify(files.files), files.stored, new Date().toISOString(), importId, claim.value);
    const row = await dbGet("SELECT * FROM cad_imports WHERE id = ?", importId);
    if (!done?.changes) return replayImport(req, res, row, team, body);
    res.json(await bomResponse(req, row, team, duplicate));
  }

  /** The same key again: the earlier result once it is finished. An import whose
   *  parts committed but whose files never finished (the request stalled or the
   *  server restarted) is finished by the retry; its parts are never written twice. */
  async function replayImport(req: any, res: any, row: any, team: any, body: any) {
    const deadline = Date.now() + replayWaitMs;
    for (;;) {
      if (row.finished_at) return res.json(await bomResponse(req, row, team, true));
      const now = Date.now();
      const claim = { value: newClaim() };
      const took = await dbAll(
        "UPDATE cad_imports SET claimed_at = ? WHERE id = ? AND finished_at IS NULL AND (claimed_at IS NULL OR claimed_at < ?) RETURNING id",
        claim.value, row.id, new Date(now - IMPORT_STALL_MS).toISOString());
      if (took.length) return finishImport(req, res, Number(row.id), team, body, true, claim);
      if (now >= deadline) {
        res.setHeader("Retry-After", "5");
        return res.status(503).json({ error: "in_progress", retryAfter: 5 });
      }
      await new Promise((r) => setTimeout(r, 250));
      row = await dbGet("SELECT * FROM cad_imports WHERE id = ?", row.id);
    }
  }

  async function importBom(req: any, res: any) {
    const { team, email } = req.ck;
    const teamId = Number(team.id);
    const body = req.body;
    const check = checkPayload(body);
    if (!check.ok) return res.status(400).json({ error: "bad_payload", detail: check.detail });
    const key = body.idempotencyKey.trim();
    const findImport = () => dbGet("SELECT * FROM cad_imports WHERE team_id = ? AND idempotency_key = ?", teamId, key);
    const earlier = await findImport();
    if (earlier) return replayImport(req, res, earlier, team, body);

    const documentId = str(body.assembly.documentId, 100);
    const elementId = str(body.assembly.elementId, 100);
    const now = new Date().toISOString();
    // One row per part identity; the same identity twice in a bundle adds up.
    const parts = new Map<string, any>();
    for (const p of body.cadParts) {
      const k = partKey(p.extra)!;
      const v = sanitizePartInput(p).value!;
      const prior = parts.get(k);
      if (prior) prior.quantity += v.quantity;
      else parts.set(k, { ...v, extra: p.extra });
    }
    const revision = body.revision && typeof body.revision === "object" ? `${str(body.revision.type, 2)}/${str(body.revision.id, 100)}` : null;
    // The robot this assembly belongs to (contract v1.1 "Where an import lands"); its rows and files follow it.
    const assemblyUrl = str(body.assembly.assemblyUrl, 500);
    const robot = await robotForAssembly(deps, teamId, documentId, elementId,
      { name: str(body.assembly.name, 80), url: /^https:\/\/([\w-]+\.)*onshape\.com\//i.test(assemblyUrl) ? assemblyUrl : null }, Number(team.member_id));
    const robotId = robot ? Number(robot.id) : null;
    const importIdSql = "(SELECT id FROM cad_imports WHERE team_id = ? AND idempotency_key = ?)";
    const assembly = [teamId, documentId, elementId];
    const keys = JSON.stringify([...parts.keys()]);
    const claim = { value: newClaim() };
    const stmts: { sql: string; args: any[] }[] = [{
      sql: `INSERT INTO cad_imports (team_id, idempotency_key, document_id, element_id, assembly_name, assembly_url, revision, part_count, sent_by, sent_by_member_id, created_at, claimed_at, robot_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [teamId, key, documentId, elementId, str(body.assembly.name, 200) || null, str(body.assembly.assemblyUrl, 500) || null, revision,
        parts.size, team.member_name || email, Number(team.member_id), now, claim.value, robotId],
    }, {
      // Counted inside the same write transaction as the upserts below, so a
      // send racing this one can't make both report every part as new.
      sql: `WITH had AS (SELECT COUNT(*) AS n FROM cad_parts WHERE team_id = ? AND ck_document_id = ? AND ck_element_id = ?
                           AND ck_part_key IN (SELECT value FROM json_each(?))),
                 gone AS (SELECT COUNT(*) AS n FROM cad_parts WHERE team_id = ? AND ck_document_id = ? AND ck_element_id = ?
                           AND ck_part_key IS NOT NULL AND ck_removed_at IS NULL AND ck_part_key NOT IN (SELECT value FROM json_each(?)))
            UPDATE cad_imports SET result = json_object('created', ? - (SELECT n FROM had), 'updated', (SELECT n FROM had),
                                                        'markedRemoved', (SELECT n FROM gone), 'filesStored', 0)
             WHERE team_id = ? AND idempotency_key = ?`,
      args: [...assembly, keys, ...assembly, keys, parts.size, teamId, key],
    }];
    for (const [k, v] of parts) {
      // People's fields stay theirs: the assignee and Control Point choices
      // (choice_*) are never touched, and the status only moves while it is
      // still "to order". A row follows its assembly's robot.
      stmts.push({
        sql: `INSERT INTO cad_parts (team_id, name, section, quantity, source, unit_cost, status, assignee, notes, created_by, created_at, updated_at,
                ck_document_id, ck_element_id, ck_part_key, ck_import_id, ck_extra, ck_removed_at, robot_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ${importIdSql}, ?, NULL, ?)
              ON CONFLICT(team_id, ck_document_id, ck_element_id, ck_part_key) WHERE ck_part_key IS NOT NULL DO UPDATE SET
                name = excluded.name, section = excluded.section, quantity = excluded.quantity, source = excluded.source,
                unit_cost = excluded.unit_cost, notes = excluded.notes, ck_extra = excluded.ck_extra, ck_import_id = excluded.ck_import_id,
                ck_removed_at = NULL, updated_at = excluded.updated_at, robot_id = excluded.robot_id,
                status = CASE WHEN cad_parts.status = 'to_order' THEN excluded.status ELSE cad_parts.status END`,
        args: [teamId, v.name, v.section, v.quantity, v.source, v.unit_cost, v.status, v.notes, Number(team.member_id), now, now,
          documentId, elementId, k, teamId, key, JSON.stringify(v.extra ?? null), robotId],
      });
    }
    // Rows of this assembly the new scan doesn't have stay, marked.
    stmts.push({
      sql: `UPDATE cad_parts SET ck_removed_at = ?, updated_at = ? WHERE team_id = ? AND ck_document_id = ? AND ck_element_id = ?
              AND ck_part_key IS NOT NULL AND ck_removed_at IS NULL AND ck_import_id IS NOT ${importIdSql}`,
      args: [now, now, teamId, documentId, elementId, teamId, key],
    });
    let importId: number;
    try {
      importId = (await deps.dbBatchResults(stmts))[0].lastInsertRowid;
    } catch (e: any) {
      // The same scan arriving twice at once: the second insert hits the unique key and its whole batch rolls back.
      const won = await findImport();
      if (won) return replayImport(req, res, won, team, body);
      throw e;
    }
    await finishImport(req, res, importId, team, body, false, claim);
  }

  /** One finished import of the guarded workspace, or a 404/409 already sent. */
  async function finishedImport(req: any, res: any) {
    const row = await dbGet("SELECT * FROM cad_imports WHERE id = ? AND team_id = ?", Number(req.params.importId), Number(req.ck.team.id));
    if (!row) { res.status(404).json({ error: "not_found", detail: "No such import in this workspace." }); return null; }
    if (!row.finished_at) { res.setHeader("Retry-After", "5"); res.status(409).json({ error: "in_progress", retryAfter: 5 }); return null; }
    return row;
  }
  const parseFiles = (raw: unknown): any[] => { try { const v = JSON.parse(String(raw || "[]")); return Array.isArray(v) ? v : []; } catch { return []; } };
  const dropStored = async (url: string | null | undefined) => { if (url && deps.deleteStoredFile) await deps.deleteStoredFile(url).catch(() => {}); };

  /**
   * A file uploaded after its send (contract v1.2 §6): raw bytes, checked against the SHA-256 Control Kit names, stored as
   * a CAD doc of the import, and put in the import's file list in place of the entry it completes. The list is swapped
   * only from the value it was read as, so two uploads to one import never drop each other.
   */
  async function uploadFile(req: any, res: any) {
    const teamId = Number(req.ck.team.id);
    const row = await finishedImport(req, res);
    if (!row) return;
    const name = uploadName(req.query.name);
    const mediaType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!name) return res.status(400).json({ error: "bad_file", detail: "name is missing or not a plain file name." });
    if (!UPLOAD_TYPES[mediaType]?.test(name)) return res.status(415).json({ error: "bad_file", detail: "Only a .zip, .xlsx or .csv file of the matching type." });
    const want = String(req.headers["x-content-sha256"] || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(want)) return res.status(400).json({ error: "bad_file", detail: "X-Content-SHA256 is missing." });
    const buffer: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buffer.length) return res.status(400).json({ error: "bad_file", detail: "The file is empty." });
    if (sha256(buffer) !== want) return res.status(400).json({ error: "checksum_mismatch", detail: "The bytes do not match X-Content-SHA256." });
    const earlier = parseFiles(row.files).find((f) => f?.name === name && f?.stored);
    if (earlier && String(earlier.sha256 || "").toLowerCase() === want) {
      return res.json({ name, url: earlier.url, sizeBytes: buffer.length, sha256: want, duplicate: true });
    }
    if (!withUploadedFile(parseFiles(row.files), { name })) return res.status(409).json({ error: "too_many_files", detail: `An import holds at most ${MAX_IMPORT_FILES} files.` });
    const fileId = await deps.storeFile({ teamId, memberId: Number(req.ck.team.member_id), kind: "cad", filename: name, mimeType: mediaType, buffer });
    const url = deps.fileUrl(fileId);
    const entry = { name, mediaType, sizeBytes: buffer.length, sha256: want, stored: true, url, uploadedAt: new Date().toISOString() };
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await dbGet("SELECT files FROM cad_imports WHERE id = ?", row.id);
      const before = parseFiles(current?.files);
      const replaced = before.find((f) => f?.name === name && f?.stored && f?.url);
      // The same bytes arrived meanwhile (a retry racing this one): keep that file, drop this copy.
      if (replaced && String(replaced.sha256 || "").toLowerCase() === want) {
        await dropStored(url);
        return res.json({ name, url: replaced.url, sizeBytes: buffer.length, sha256: want, duplicate: true });
      }
      const next = withUploadedFile(before, entry);
      if (!next) { await dropStored(url); return res.status(409).json({ error: "too_many_files", detail: `An import holds at most ${MAX_IMPORT_FILES} files.` }); }
      const nextJson = JSON.stringify(next);
      // One transaction: the list swap, this file's document, and removing the document it replaces. The document
      // statements run only when this request's swap is the list now, so an overlapping upload never leaves a
      // document pointing at bytes another upload deleted.
      const [swapped] = await deps.dbBatchResults([
        { sql: "UPDATE cad_imports SET files = ?, result = json_set(COALESCE(result, '{}'), '$.filesStored', ?) WHERE id = ? AND COALESCE(files, '') = COALESCE(?, '')",
          args: [nextJson, next.filter((f) => f?.stored).length, row.id, current?.files ?? null] },
        { sql: "INSERT INTO cad_docs (team_id, name, url, created_by, created_at, ck_import_id, robot_id) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM cad_imports WHERE id = ? AND files = ?)",
          args: [teamId, name, url, Number(req.ck.team.member_id), entry.uploadedAt, row.id, row.robot_id ?? null, row.id, nextJson] },
        { sql: "DELETE FROM cad_docs WHERE team_id = ? AND ck_import_id = ? AND url = ? AND EXISTS (SELECT 1 FROM cad_imports WHERE id = ? AND files = ?)",
          args: [teamId, row.id, replaced?.url ?? "", row.id, nextJson] },
      ]);
      if (!swapped.changes) continue;
      if (replaced) await dropStored(replaced.url);
      res.json({ name, url, sizeBytes: buffer.length, sha256: want, duplicate: false });
      // The STEP zip's prints go to the Prints library too, after the answer so a large zip never delays it.
      if (mediaType === "application/zip" && row.robot_id && deps.fileStepZip) {
        void deps.fileStepZip({ teamId, robotId: Number(row.robot_id), zip: buffer, sentBy: row.sent_by ?? null })
          .catch((e) => console.error("Filing Control Kit prints failed:", e?.message || e));
      }
      return;
    }
    await dropStored(url);
    res.setHeader("Retry-After", "2");
    res.status(409).json({ error: "busy", detail: "The import's files changed while saving. Try again.", retryAfter: 2 });
  }

  /** Which parts of an import's assembly already have a picture, and of which revision (Control Kit's key). */
  async function pictureKeys(req: any, res: any) {
    const row = await finishedImport(req, res);
    if (!row) return;
    const rows = await dbAll(
      "SELECT ck_part_key, ck_picture_key, ck_picture_at FROM cad_parts WHERE team_id = ? AND ck_document_id = ? AND ck_element_id = ? AND ck_part_key IS NOT NULL AND ck_picture_key IS NOT NULL",
      Number(req.ck.team.id), row.document_id, row.element_id);
    res.json({ pictures: rows.map((r) => ({ identity: String(r.ck_part_key), key: String(r.ck_picture_key), at: r.ck_picture_at || null })) });
  }

  /**
   * Part pictures for an import's assembly (contract v1.2 §6): PNGs keyed by part identity and Control Kit's revision
   * key. A part already holding that key is left alone; a newer one replaces the old file. Unknown parts are counted.
   */
  async function uploadPictures(req: any, res: any) {
    const teamId = Number(req.ck.team.id);
    const row = await finishedImport(req, res);
    if (!row) return;
    const list = req.body?.pictures;
    if (!Array.isArray(list) || !list.length || list.length > PICTURES_PER_CALL) return res.status(400).json({ error: "bad_payload", detail: `pictures must hold 1 to ${PICTURES_PER_CALL} items.` });
    let stored = 0, unchanged = 0, unknown = 0, rejected = 0;
    for (const p of list) {
      const key = typeof p?.key === "string" && /^[\w:.-]{1,128}$/.test(p.key) ? p.key : null;
      const identity = partKey({ identity: p?.identity });
      const buffer = typeof p?.contentBase64 === "string" && p.contentBase64.length <= Math.ceil(PICTURE_LIMIT_BYTES / 3) * 4 + 4 ? Buffer.from(p.contentBase64, "base64") : null;
      if (!key || !identity || !buffer || buffer.length > PICTURE_LIMIT_BYTES || buffer.length < 16 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) { rejected++; continue; }
      const part = await dbGet("SELECT id, ck_picture_url, ck_picture_key FROM cad_parts WHERE team_id = ? AND ck_document_id = ? AND ck_element_id = ? AND ck_part_key = ?",
        teamId, row.document_id, row.element_id, identity);
      if (!part) { unknown++; continue; }
      if (part.ck_picture_key === key) { unchanged++; continue; }
      const fileId = await deps.storeFile({ teamId, memberId: Number(req.ck.team.member_id), kind: "cad", filename: `${String(row.assembly_name || "part").slice(0, 60)} part.png`, mimeType: "image/png", buffer });
      const url = deps.fileUrl(fileId);
      // Swapped only from the picture this read saw: a picture stored meanwhile by another send keeps its place.
      const swapped = await dbRun("UPDATE cad_parts SET ck_picture_url = ?, ck_picture_key = ?, ck_picture_at = ? WHERE id = ? AND COALESCE(ck_picture_url, '') = ?",
        url, key, new Date().toISOString(), part.id, part.ck_picture_url || "");
      if (!swapped.changes) { await dropStored(url); unchanged++; continue; }
      await dropStored(part.ck_picture_url);
      stored++;
    }
    res.json({ stored, unchanged, unknown, rejected });
  }

  /** Control Kit's AI review with Control Point's own model keys (contract v1.2 §7), within a per-workspace allowance. */
  async function aiReview(req: any, res: any) {
    if (!reviewConfigured(deps.env)) return res.status(501).json({ error: "ai_unavailable", detail: "AI review is not set up on this Control Point server." });
    const check = checkReviewAsk(req.body);
    if (check.ok === false) return res.status(400).json({ error: "bad_payload", detail: check.detail });
    const teamId = Number(req.ck.team.id);
    const wait = limiter.hit(`ai-hour:${teamId}`, { max: AI_REVIEWS_PER_HOUR, windowMs: 3600_000 }) || limiter.hit(`ai-day:${teamId}`, { max: AI_REVIEWS_PER_DAY, windowMs: 86400_000 });
    if (wait) {
      res.setHeader("Retry-After", String(wait));
      return res.status(429).json({ error: "rate_limited", detail: "This workspace has used its AI reviews for now.", retryAfter: wait });
    }
    try {
      const answer = await runReview(deps.env, check.ask, deps.reviewFetch ?? fetch);
      res.setHeader("Cache-Control", "no-store");
      // The model's items as it gave them; Control Kit keeps only those that fit its own request.
      const items = Array.isArray((answer.output as any)?.items) ? (answer.output as any).items.slice(0, 200) : [];
      res.json({ items, provider: answer.provider, usage: answer.usage });
    } catch (e) {
      if (e instanceof ReviewError) {
        if (e.status === 429) res.setHeader("Retry-After", "60");
        return res.status(e.status).json({ error: e.code, detail: e.message });
      }
      throw e;
    }
  }

  /** Token exchange, workspaces, BOM send, import history, revoke. Register before the /api session and CSRF guard. */
  function registerBearerRoutes(app: Express) {
    const base = "/api/integrations/control-kit";
    app.post(`${base}/token`, express.json({ limit: "16kb" }), express.urlencoded({ extended: false, limit: "16kb" }), async (req, res) => {
      try {
        if (throttled(res, `tokenip:${clientIp(req)}`, 30)) return;
        if (!clientSecretMatches(req.headers.authorization, deps.env.CONTROL_KIT_CLIENT_SECRET)) return res.status(401).json({ error: "invalid_client" });
        const body = req.body || {};
        if (body.grant_type !== "authorization_code") return res.status(400).json({ error: "unsupported_grant_type" });
        const code = typeof body.code === "string" ? body.code : "";
        if (!code || !isAllowedRedirect(body.redirect_uri, deps.env)) return res.status(400).json({ error: "invalid_grant" });
        // One use, atomically: a code used, expired, or sent with another redirect URI is refused.
        // The token is issued in the same transaction that uses the code, so a
        // Disconnect (which also voids unused codes) lands wholly before or after.
        const now = new Date().toISOString();
        const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
        const [used] = await deps.dbBatchResults([
          { sql: "UPDATE control_kit_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? AND redirect_uri = ? RETURNING email",
            args: [now, sha256(code), now, body.redirect_uri] },
          // changes() is the UPDATE's: 0 when the code was refused, so nothing is issued.
          { sql: "INSERT INTO control_kit_tokens (token_hash, email, created_at) SELECT ?, email, ? FROM control_kit_codes WHERE code_hash = ? AND changes() = 1",
            args: [sha256(token), now, sha256(code)] },
        ]);
        const hit = used.rows[0];
        if (!hit) return res.status(400).json({ error: "invalid_grant" });
        res.setHeader("Cache-Control", "no-store");
        res.json({ access_token: token, token_type: "Bearer", account: await accountOf(String(hit.email)) });
      } catch (e) { console.error("Control Kit token error:", e); res.status(500).json({ error: "server_error" }); }
    });

    app.get(`${base}/workspaces`, async (req, res) => {
      try {
        const who = await bearer(req, res);
        if (!who) return;
        res.json({ account: await accountOf(who.email), workspaces: await workspacesOf(req, who.email) });
      } catch (e) { console.error("Control Kit workspaces error:", e); res.status(500).json({ error: "server_error" }); }
    });

    app.post(`${base}/workspaces/:id/bom`, guard(true), express.json({ limit: BOM_LIMIT }), (err: any, _req: any, res: any, next: any) => {
      if (err?.type === "entity.too.large") return res.status(413).json({ error: "too_large", detail: `A BOM can be at most ${BOM_LIMIT.toUpperCase()}.` });
      if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "bad_payload", detail: "Body is not valid JSON." });
      next(err);
    }, async (req: any, res: any) => {
      try { await importBom(req, res); } catch (e) { console.error("Control Kit BOM import error:", e); res.status(500).json({ error: "server_error" }); }
    });

    app.get(`${base}/workspaces/:id/imports`, guard(false), async (req: any, res) => {
      try {
        const document = str(req.query.document, 100);
        const element = str(req.query.element, 100);
        const rows = await dbAll(
          `SELECT * FROM cad_imports WHERE team_id = ?${document ? " AND document_id = ?" : ""}${element ? " AND element_id = ?" : ""} ORDER BY id DESC LIMIT 10`,
          Number(req.ck.team.id), ...(document ? [document] : []), ...(element ? [element] : []));
        res.json(rows.map((r) => { const { filesStored: _f, ...s } = importSummary(req, r); return s; }));
      } catch (e) { console.error("Control Kit imports error:", e); res.status(500).json({ error: "server_error" }); }
    });

    // Choices made in Control Point for one document's parts (contract v1.1 §5), for Control Kit's next scan.
    app.get(`${base}/workspaces/:id/decisions`, guard(false), async (req: any, res) => {
      try {
        const document = str(req.query.document, 100);
        if (!document) return res.status(400).json({ error: "bad_request", detail: "document is required." });
        res.json({ decisions: await deps.decisionsFor(Number(req.ck.team.id), document) });
      } catch (e) { console.error("Control Kit decisions error:", e); res.status(500).json({ error: "server_error" }); }
    });

    // Contract v1.2 §6: files uploaded after a send, and part pictures.
    app.post(`${base}/workspaces/:id/imports/:importId/files`, guard(true), express.raw({ type: () => true, limit: FILE_LIMIT_BYTES }), (err: any, _req: any, res: any, next: any) => {
      if (err?.type === "entity.too.large") return res.status(413).json({ error: "too_large", detail: `A file can be at most ${FILE_LIMIT_BYTES / 1024 / 1024} MB.` });
      next(err);
    }, async (req: any, res: any) => {
      try { await uploadFile(req, res); } catch (e) { console.error("Control Kit file upload error:", e); res.status(500).json({ error: "server_error" }); }
    });
    app.get(`${base}/workspaces/:id/imports/:importId/pictures`, guard(false), async (req: any, res) => {
      try { await pictureKeys(req, res); } catch (e) { console.error("Control Kit picture list error:", e); res.status(500).json({ error: "server_error" }); }
    });
    app.post(`${base}/workspaces/:id/imports/:importId/pictures`, guard(true), express.json({ limit: PICTURES_BODY_LIMIT }), (err: any, _req: any, res: any, next: any) => {
      if (err?.type === "entity.too.large") return res.status(413).json({ error: "too_large", detail: `Pictures go at most ${PICTURES_BODY_LIMIT.toUpperCase()} per call.` });
      if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "bad_payload", detail: "Body is not valid JSON." });
      next(err);
    }, async (req: any, res: any) => {
      try { await uploadPictures(req, res); } catch (e) { console.error("Control Kit picture upload error:", e); res.status(500).json({ error: "server_error" }); }
    });
    // Contract v1.2 §7: AI review with Control Point's keys.
    app.post(`${base}/workspaces/:id/ai/review`, guard(true), express.json({ limit: "256kb" }), (err: any, _req: any, res: any, next: any) => {
      if (err?.type === "entity.too.large") return res.status(413).json({ error: "too_large", detail: "An AI review can be at most 256 KB." });
      if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "bad_payload", detail: "Body is not valid JSON." });
      next(err);
    }, async (req: any, res: any) => {
      try { await aiReview(req, res); } catch (e) { console.error("Control Kit AI review error:", e); res.status(500).json({ error: "server_error" }); }
    });

    app.post(`${base}/revoke`, async (req, res) => {
      try {
        const who = await bearer(req, res);
        if (!who) return;
        await dbRun("UPDATE control_kit_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", new Date().toISOString(), who.id);
        res.status(204).end();
      } catch (e) { console.error("Control Kit revoke error:", e); res.status(500).json({ error: "server_error" }); }
    });
  }

  /** The consent page's calls, Settings → Connected apps, and an import's details for the Parts tab. Normal session auth. */
  function registerSessionRoutes(app: Express) {
    const base = "/api/integrations/control-kit";
    const signedIn = async (req: any, res: any) => {
      const auth = await deps.requireAuth(req, res);
      if (!auth) return null;
      const email = await deps.authEmail(auth);
      if (!email) { res.status(401).json({ error: "Not signed in" }); return null; }
      return { auth, email };
    };
    // What the consent page shows, after checking the redirect URI (anything not allowlisted gets an error page and no redirect).
    app.get(`${base}/consent`, async (req, res) => {
      try {
        const who = await signedIn(req, res);
        if (!who) return;
        if (!configured()) return res.status(503).json({ error: "not_configured" });
        if (!isAllowedRedirect(req.query.redirect_uri, deps.env)) return res.status(400).json({ error: "bad_redirect_uri" });
        res.json({ account: await accountOf(who.email), workspaces: await workspacesOf(req, who.email) });
      } catch (e) { console.error("Control Kit consent error:", e); res.status(500).json({ error: "Internal server error" }); }
    });

    app.post(`${base}/authorize`, async (req, res) => {
      try {
        const who = await signedIn(req, res);
        if (!who) return;
        if (!configured()) return res.status(503).json({ error: "not_configured" });
        const redirectUri = req.body?.redirect_uri;
        if (!isAllowedRedirect(redirectUri, deps.env)) return res.status(400).json({ error: "bad_redirect_uri" });
        const state = typeof req.body?.state === "string" ? req.body.state : "";
        if (!state || state.length > 512) return res.status(400).json({ error: "bad_state" });
        const code = randomBytes(32).toString("base64url");
        const now = Date.now();
        await dbRun("DELETE FROM control_kit_codes WHERE expires_at < ?", new Date(now - CODE_TTL_MS).toISOString()).catch(() => {});
        await dbRun("INSERT INTO control_kit_codes (code_hash, email, redirect_uri, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
          sha256(code), who.email.toLowerCase(), redirectUri, new Date(now).toISOString(), new Date(now + CODE_TTL_MS).toISOString());
        res.json({ redirect: redirectWith(redirectUri, { code, state }) });
      } catch (e) { console.error("Control Kit authorize error:", e); res.status(500).json({ error: "Internal server error" }); }
    });

    app.get("/api/integrations/connected-apps", async (req, res) => {
      try {
        const who = await signedIn(req, res);
        if (!who) return;
        const row = await dbGet(
          "SELECT MIN(created_at) AS linked_at, MAX(last_used_at) AS last_used_at, COUNT(*) AS n FROM control_kit_tokens WHERE LOWER(email) = LOWER(?) AND revoked_at IS NULL",
          who.email);
        res.json(Number(row?.n) ? [{ id: "control-kit", name: "Control Kit", linkedAt: row.linked_at, lastUsedAt: row.last_used_at || null }] : []);
      } catch (e) { console.error("Connected apps error:", e); res.status(500).json({ error: "Internal server error" }); }
    });

    // Disconnect: every Control Kit token of this account, on every device, and
    // any code it approved that hasn't been exchanged yet.
    app.post(`${base}/disconnect`, async (req, res) => {
      try {
        const who = await signedIn(req, res);
        if (!who) return;
        const now = new Date().toISOString();
        const [r] = await deps.dbBatchResults(revokeGrantsSql(who.email, now));
        res.json({ revoked: r.changes });
      } catch (e) { console.error("Control Kit disconnect error:", e); res.status(500).json({ error: "Internal server error" }); }
    });

    // One import of the active workspace, for the Parts tab's ?import= link.
    app.get("/api/cad/imports/:id", async (req, res) => {
      try {
        const who = await signedIn(req, res);
        if (!who) return;
        const teamId = who.auth.teamId;
        if (!teamId) return res.status(400).json({ error: "Join a team first" });
        const row = await dbGet("SELECT * FROM cad_imports WHERE id = ? AND team_id = ?", Number(req.params.id), teamId);
        if (!row) return res.status(404).json({ error: "Not found" });
        let files: any[] = [];
        try { files = JSON.parse(row.files || "[]") || []; } catch { /* none */ }
        const s = importSummary(req, row);
        res.json({ ...s, robotId: row.robot_id ? Number(row.robot_id) : null, assemblyName: row.assembly_name, assemblyUrl: row.assembly_url, revision: row.revision, partCount: Number(row.part_count) || 0, files });
      } catch (e) { console.error("CAD import detail error:", e); res.status(500).json({ error: "Internal server error" }); }
    });
  }

  return { registerBearerRoutes, registerSessionRoutes };
}
