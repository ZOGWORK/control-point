// Owner feature toggles: the app owner turns a feature off for every team or
// for one team, from the Owner console (Features tab).
//
// Resolution for (team, feature): a feature that isn't registered here is
// never gated; a team override wins; else the global switch; else on. Every
// check reads the two small tables, so a flip applies on the next request.
// Turning a feature off hides and refuses it, it never deletes its data.
//
// Only features whose routes are actually gated are registered: a switch that
// flips but changes nothing is worse than no switch.
import type express from "express";
import type { Client } from "@libsql/client";
import { dbClient } from "../db.js";

export interface Feature { key: string; label: string; description: string }

export const FEATURES: readonly Feature[] = [
  { key: "messaging", label: "Messaging", description: "Team chat: channels and messages." },
  { key: "whats_new", label: "What's new", description: "Release notes: the What's new popup, its menu, command and Settings entries, and New badges on pages." },
];

const KEYS = new Set(FEATURES.map((f) => f.key));
export const isFeatureKey = (key: unknown): key is string => typeof key === "string" && KEYS.has(key);

/** The error a gated route answers with (403). */
export const featureDisabledBody = (key: string) => ({ error: "feature_disabled", feature: key });

export class FeatureFlags {
  constructor(private db: Client = dbClient) {}

  async isEnabled(teamId: number | null | undefined, key: string): Promise<boolean> {
    if (!isFeatureKey(key)) return true;
    const r = await this.db.execute({
      sql: `SELECT (SELECT enabled FROM team_feature_overrides WHERE team_id = ? AND key = ?) AS team,
                   (SELECT enabled FROM feature_flags WHERE key = ?) AS global`,
      args: [teamId ?? null, key, key],
    });
    const row = r.rows[0] as any;
    if (teamId != null && row?.team != null) return Number(row.team) === 1;
    if (row?.global != null) return Number(row.global) === 1;
    return true;
  }

  /** Every registered feature, resolved for one team. Teamless members get all on. */
  async effective(teamId: number | null | undefined): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const f of FEATURES) out[f.key] = teamId == null ? true : await this.isEnabled(teamId, f.key);
    return out;
  }

  /** The owner's view: registry + global switch + every team override, and the workspaces. */
  async list() {
    const globals = new Map(((await this.db.execute("SELECT key, enabled, updated_at FROM feature_flags")).rows as any[]).map((r) => [r.key, r]));
    const overrides = (await this.db.execute("SELECT team_id, key, enabled, updated_at FROM team_feature_overrides ORDER BY team_id")).rows as any[];
    const teams = ((await this.db.execute("SELECT id, name, number FROM teams ORDER BY name COLLATE NOCASE, id")).rows as any[])
      .map((t) => ({ id: Number(t.id), name: String(t.name ?? ""), number: t.number == null ? null : String(t.number) }));
    return {
      features: FEATURES.map((f) => {
        const g = globals.get(f.key);
        return {
          ...f,
          enabled: g ? Number(g.enabled) === 1 : true,
          updated_at: g?.updated_at ?? null,
          overrides: overrides.filter((o) => o.key === f.key).map((o) => ({ team_id: Number(o.team_id), enabled: Number(o.enabled) === 1, updated_at: o.updated_at ?? null })),
        };
      }),
      teams,
    };
  }

  async teamExists(teamId: number) {
    return (await this.db.execute({ sql: "SELECT 1 FROM teams WHERE id = ?", args: [teamId] })).rows.length > 0;
  }

  async setGlobal(key: string, enabled: boolean, by: number) {
    const v = enabled ? 1 : 0, now = new Date().toISOString();
    await this.db.batch([
      { sql: "INSERT INTO feature_flags (key, enabled, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at", args: [key, v, by, now] },
      { sql: "INSERT INTO feature_flag_audit (key, scope, team_id, enabled, changed_by, created_at) VALUES (?, 'global', NULL, ?, ?, ?)", args: [key, v, by, now] },
    ], "write");
  }

  /** `enabled: null` removes the override (the team inherits the global switch again). */
  async setTeam(teamId: number, key: string, enabled: boolean | null, by: number) {
    const now = new Date().toISOString();
    // The audit row records the value the team now has (an inherit records the global value).
    const write = enabled === null
      ? { sql: "DELETE FROM team_feature_overrides WHERE team_id = ? AND key = ?", args: [teamId, key] }
      : { sql: "INSERT INTO team_feature_overrides (team_id, key, enabled, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(team_id, key) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at", args: [teamId, key, enabled ? 1 : 0, by, now] };
    await this.db.batch([
      write,
      {
        sql: `INSERT INTO feature_flag_audit (key, scope, team_id, enabled, changed_by, created_at)
              VALUES (?, ?, ?, COALESCE(?, (SELECT enabled FROM feature_flags WHERE key = ?), 1), ?, ?)`,
        args: [key, enabled === null ? "inherit" : "team", teamId, enabled === null ? null : enabled ? 1 : 0, key, by, now],
      },
    ], "write");
  }

  async audit(limit: number) {
    const r = await this.db.execute({
      sql: `SELECT a.id, a.key, a.scope, a.team_id, t.name AS team_name, a.enabled, a.changed_by, m.name AS changed_by_name, m.email AS changed_by_email, a.created_at
              FROM feature_flag_audit a LEFT JOIN teams t ON t.id = a.team_id LEFT JOIN members m ON m.id = a.changed_by
             ORDER BY a.id DESC LIMIT ?`,
      args: [limit],
    });
    return (r.rows as any[]).map((a) => ({
      id: Number(a.id), key: String(a.key), scope: String(a.scope), team_id: a.team_id == null ? null : Number(a.team_id),
      team_name: a.team_name ?? null, enabled: Number(a.enabled) === 1, changed_by: a.changed_by == null ? null : Number(a.changed_by),
      changed_by_name: a.changed_by_name ?? null, changed_by_email: a.changed_by_email ?? null, created_at: a.created_at ?? null,
    }));
  }
}

type Auth = { memberId: number; teamId: number | null };
interface FeatureDeps {
  requireAuth: (req: any, res: any) => Promise<Auth | null>;
  requireOwner: (req: any, res: any) => Promise<Auth | null>;
  /** Tell open clients to re-read their features: one team, or everyone (null). */
  notify: (teamId: number | null) => void;
  flags?: FeatureFlags;
}

export function registerFeatureRoutes(app: express.Express, deps: FeatureDeps) {
  const flags = deps.flags ?? new FeatureFlags();

  // The signed-in member's team, resolved (the client hides what's off).
  app.get("/api/features", async (req, res) => {
    const auth = await deps.requireAuth(req, res);
    if (!auth) return;
    try { res.json(await flags.effective(auth.teamId)); } catch (e) {
      console.error("features read failed:", e);
      res.status(500).json({ error: "Could not load features" });
    }
  });

  app.get("/api/owner/features", async (req, res) => {
    if (!await deps.requireOwner(req, res)) return;
    res.json(await flags.list());
  });

  app.patch("/api/owner/features/:key", async (req, res) => {
    const auth = await deps.requireOwner(req, res);
    if (!auth) return;
    const key = req.params.key;
    if (!isFeatureKey(key)) return res.status(404).json({ error: "Unknown feature" });
    if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });
    await flags.setGlobal(key, req.body.enabled, auth.memberId);
    deps.notify(null);
    res.json({ success: true, key, enabled: req.body.enabled });
  });

  app.patch("/api/owner/features/:key/teams/:teamId", async (req, res) => {
    const auth = await deps.requireOwner(req, res);
    if (!auth) return;
    const key = req.params.key;
    if (!isFeatureKey(key)) return res.status(404).json({ error: "Unknown feature" });
    const teamId = Number(req.params.teamId);
    if (!Number.isInteger(teamId) || teamId <= 0) return res.status(400).json({ error: "Bad workspace id" });
    const enabled = req.body?.enabled;
    if (enabled !== null && typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be true, false or null" });
    if (!await flags.teamExists(teamId)) return res.status(404).json({ error: "Workspace not found" });
    await flags.setTeam(teamId, key, enabled, auth.memberId);
    deps.notify(teamId);
    res.json({ success: true, key, team_id: teamId, enabled, effective: await flags.isEnabled(teamId, key) });
  });

  app.get("/api/owner/feature-audit", async (req, res) => {
    if (!await deps.requireOwner(req, res)) return;
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    res.json(await flags.audit(limit));
  });

  return flags;
}
