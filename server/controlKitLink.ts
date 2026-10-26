// Control Kit link (contract: control-kit docs/control-point-link.md, v1).
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
}

export const CONTROL_KIT_CLIENT_ID = "control-kit";
export const DEFAULT_CONTROL_KIT_REDIRECT_URIS = ["https://control-kit.control-kit-worker.workers.dev/control-point/callback"];
export const CODE_TTL_MS = 5 * 60 * 1000;
export const BOM_LIMIT = "12mb";
const MAX_CAD_PARTS = 5000;
const MAX_FILES = 20;
const TOKEN_PREFIX = "ckp_";
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
  const importUrl = (req: any, id: number) => `${cadUrl(req)}?import=${id}`;
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
      filesStored: Number(result.filesStored) || 0, url: importUrl(req, Number(row.id)),
    };
  }
  const bomResponse = (req: any, row: any, team: any, duplicate: boolean) => {
    const s = importSummary(req, row);
    return {
      importId: s.importId, duplicate, workspace: { id: Number(team.id), name: String(team.name), ftcNumber: team.ftc_team_number ? String(team.ftc_team_number) : null },
      created: s.created, updated: s.updated, markedRemoved: s.markedRemoved, filesStored: s.filesStored, url: s.url, sentAt: s.sentAt,
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
          { sql: "INSERT INTO cad_docs (team_id, name, url, created_by, created_at, ck_import_id) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1",
            args: [teamId, name, url, memberId, new Date().toISOString(), importId] },
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
    res.json(bomResponse(req, row, team, duplicate));
  }

  /** The same key again: the earlier result once it is finished. An import whose
   *  parts committed but whose files never finished (the request stalled or the
   *  server restarted) is finished by the retry; its parts are never written twice. */
  async function replayImport(req: any, res: any, row: any, team: any, body: any) {
    const deadline = Date.now() + replayWaitMs;
    for (;;) {
      if (row.finished_at) return res.json(bomResponse(req, row, team, true));
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
    const importIdSql = "(SELECT id FROM cad_imports WHERE team_id = ? AND idempotency_key = ?)";
    const assembly = [teamId, documentId, elementId];
    const keys = JSON.stringify([...parts.keys()]);
    const claim = { value: newClaim() };
    const stmts: { sql: string; args: any[] }[] = [{
      sql: `INSERT INTO cad_imports (team_id, idempotency_key, document_id, element_id, assembly_name, assembly_url, revision, part_count, sent_by, sent_by_member_id, created_at, claimed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [teamId, key, documentId, elementId, str(body.assembly.name, 200) || null, str(body.assembly.assemblyUrl, 500) || null, revision,
        parts.size, team.member_name || email, Number(team.member_id), now, claim.value],
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
      // People's fields stay theirs: the assignee is never touched, and the
      // status only moves while it is still "to order".
      stmts.push({
        sql: `INSERT INTO cad_parts (team_id, name, section, quantity, source, unit_cost, status, assignee, notes, created_by, created_at, updated_at,
                ck_document_id, ck_element_id, ck_part_key, ck_import_id, ck_extra, ck_removed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ${importIdSql}, ?, NULL)
              ON CONFLICT(team_id, ck_document_id, ck_element_id, ck_part_key) WHERE ck_part_key IS NOT NULL DO UPDATE SET
                name = excluded.name, section = excluded.section, quantity = excluded.quantity, source = excluded.source,
                unit_cost = excluded.unit_cost, notes = excluded.notes, ck_extra = excluded.ck_extra, ck_import_id = excluded.ck_import_id,
                ck_removed_at = NULL, updated_at = excluded.updated_at,
                status = CASE WHEN cad_parts.status = 'to_order' THEN excluded.status ELSE cad_parts.status END`,
        args: [teamId, v.name, v.section, v.quantity, v.source, v.unit_cost, v.status, v.notes, Number(team.member_id), now, now,
          documentId, elementId, k, teamId, key, JSON.stringify(v.extra ?? null)],
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
        res.json({ ...s, assemblyName: row.assembly_name, assemblyUrl: row.assembly_url, revision: row.revision, partCount: Number(row.part_count) || 0, files });
      } catch (e) { console.error("CAD import detail error:", e); res.status(500).json({ error: "Internal server error" }); }
    });
  }

  return { registerBearerRoutes, registerSessionRoutes };
}
