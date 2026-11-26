// A team's videos from Control Scout (Scout's GET /internal/teams/:n/videos, its docs/shared-accounts.md): the
// creator episodes it's featured in (Behind the Bot) and its latest match clips, for the team dashboard. Public
// data only, read with the shared key (CONTROL_SCOUT_INTERNAL_KEY, the same secret Scout sends here); nothing
// about the workspace or any account is sent, only the team number in the path.
//
// Cached per team for CACHE_MS. A failure (Scout down, slow, a bad answer, no key) gives null, never an error:
// the dashboard then hides the section. A failure is remembered for FAIL_MS so a dashboard load never waits on a
// Scout that just didn't answer.

export interface FeaturedVideo { series: string; videoId: string; season: number | null; title: string }
export interface TeamClip { videoId: string; start: number; end: number | null; event: string; match: string; title: string }
export interface TeamVideos { featured: FeaturedVideo[]; clips: TeamClip[] }

export const CACHE_MS = 5 * 60_000;
export const FAIL_MS = 60_000;
/** Most of each sent on (Scout sends at most 6 clips). */
export const MAX_FEATURED = 6;
export const MAX_CLIPS = 6;
const TIMEOUT_MS = 4000;

const VIDEO_ID = /^[\w-]{11}$/;
const text = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const seconds = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** Scout's answer → only the fields named here, each checked; null when it isn't the shape at all. */
export function parseTeamVideos(body: unknown): TeamVideos | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { featured?: unknown; clips?: unknown };
  if (!Array.isArray(b.featured) || !Array.isArray(b.clips)) return null;
  const featured: FeaturedVideo[] = [];
  for (const r of b.featured as any[]) {
    const series = text(r?.series, 60), videoId = text(r?.videoId, 11), title = text(r?.title);
    if (!series || !videoId || !VIDEO_ID.test(videoId) || !title) continue;
    const season = Number.isInteger(r?.season) ? (r.season as number) : null;
    featured.push({ series, videoId, season, title });
  }
  const clips: TeamClip[] = [];
  for (const r of b.clips as any[]) {
    const videoId = text(r?.videoId, 11), start = seconds(r?.start), event = text(r?.event), match = text(r?.match, 20);
    if (!videoId || !VIDEO_ID.test(videoId) || start == null || !event || !match) continue;
    const end = seconds(r?.end);
    clips.push({ videoId, start, end: end != null && end > start ? end : null, event, match, title: text(r?.title) ?? `${match} · ${event}` });
  }
  return { featured: featured.slice(0, MAX_FEATURED), clips: clips.slice(0, MAX_CLIPS) };
}

/** YouTube's watch link at the clip's start. */
export const watchUrl = (videoId: string, start = 0) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${start > 0 ? `&t=${start}s` : ""}`;

export function createTeamVideosClient(o: { origin: string | null; key: string | null; fetchImpl?: typeof fetch; now?: () => number }) {
  const fetchImpl = o.fetchImpl ?? fetch;
  const now = o.now ?? Date.now;
  const cache = new Map<number, { at: number; value: TeamVideos | null }>();
  const inflight = new Map<number, Promise<TeamVideos | null>>();
  return {
    /** The team's videos, or null when Scout can't say (off, unreachable, a bad answer). Never throws. */
    async get(team: number): Promise<TeamVideos | null> {
      if (!o.origin || !o.key || !Number.isInteger(team) || team < 1 || team > 999999) return null;
      const t = now();
      const hit = cache.get(team);
      if (hit && t - hit.at < (hit.value ? CACHE_MS : FAIL_MS)) return hit.value;
      // One call per team at a time: a workspace's members opening the dashboard together share it.
      const pending = inflight.get(team);
      if (pending) return pending;
      const p = (async () => {
        let value: TeamVideos | null = null;
        try {
          const res = await fetchImpl(`${o.origin}/internal/teams/${team}/videos`, {
            headers: { "X-Internal-Key": o.key!, Accept: "application/json" },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          value = res.ok ? parseTeamVideos(await res.json()) : null;
        } catch { /* Scout unreachable: hidden this time, asked again after FAIL_MS */ }
        if (cache.size > 5000) cache.clear();
        cache.set(team, { at: now(), value });
        return value;
      })().finally(() => inflight.delete(team));
      inflight.set(team, p);
      return p;
    },
  };
}
