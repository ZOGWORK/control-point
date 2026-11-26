// A team's videos from Control Scout (server/scoutTeamVideos.ts, GET /api/ftc/team-videos): only the named fields
// pass, answers are cached per team, the shared key is sent, and any failure means null (the dashboard hides the
// section), never an error. The route test boots the real server against a stub Scout.
import http from "http";
import express from "express";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CACHE_MS, FAIL_MS, MAX_CLIPS, createTeamVideosClient, parseStill, parseTeamVideos, watchUrl } from "../scoutTeamVideos";
import { startTestServer, seedTeam, seedMember, type TestServer } from "./helpers/testServer";

const KEY = "test-internal-key-0123456789-abcdefghijklmnop";
const clip = (n: number, extra: Record<string, unknown> = {}) => ({ videoId: "ccccccccccc", start: n * 100, end: n * 100 + 160, event: "NJ Championship", match: `Q${n}`, title: `Q${n} · NJ Championship`, ...extra });
const answer = {
  featured: [{ series: "behind-the-bot", videoId: "ddddddddddd", season: 2025, title: "Behind the Bot: Team 100", secret: "x" }],
  clips: [clip(3), clip(1)],
};

describe("parseTeamVideos", () => {
  it("keeps the named fields only and drops bad rows", () => {
    const p = parseTeamVideos({
      featured: [...answer.featured, { series: "behind-the-bot", videoId: "<script>", title: "x" }, { series: "behind-the-bot", videoId: "eeeeeeeeeee", season: "2024", title: "No season" }],
      clips: [clip(3, { extra: 1 }), clip(2, { start: -5 }), clip(4, { videoId: "short" }), clip(5, { end: 10 }), { videoId: "ccccccccccc", start: 0, event: "E", match: "P1" }],
    })!;
    expect(p.featured).toEqual([
      { series: "behind-the-bot", videoId: "ddddddddddd", season: 2025, title: "Behind the Bot: Team 100" },
      { series: "behind-the-bot", videoId: "eeeeeeeeeee", season: null, title: "No season" },
    ]);
    expect(p.clips).toEqual([
      { videoId: "ccccccccccc", start: 300, end: 460, event: "NJ Championship", match: "Q3", title: "Q3 · NJ Championship" },
      // An end before the start is no end.
      { videoId: "ccccccccccc", start: 500, end: null, event: "NJ Championship", match: "Q5", title: "Q5 · NJ Championship" },
      { videoId: "ccccccccccc", start: 0, end: null, event: "E", match: "P1", title: "P1 · E" },
    ]);
  });
  it("is null when the answer isn't the shape, and caps the clips", () => {
    for (const bad of [null, "x", {}, { featured: [] }, { clips: [] }, { featured: {}, clips: [] }]) expect(parseTeamVideos(bad)).toBeNull();
    expect(parseTeamVideos({ featured: [], clips: Array.from({ length: 10 }, (_, i) => clip(i + 1)) })!.clips).toHaveLength(MAX_CLIPS);
  });
  it("passes a clip's still only from YouTube's image host, with its tile inside the sheet", () => {
    const ok = { src: "https://i.ytimg.com/sb/ccccccccccc/storyboard3_L2/M0.jpg?sigh=x", col: 2, row: 1, cols: 5, rows: 5 };
    expect(parseStill({ ...ok, extra: 1 })).toEqual(ok);
    for (const bad of [null, "x", { ...ok, src: "https://evil.test/a.jpg" }, { ...ok, src: "javascript:alert(1)" }, { ...ok, col: 5 }, { ...ok, row: -1 }, { ...ok, cols: 0 }, { ...ok, col: 1.5 }]) expect(parseStill(bad)).toBeNull();
    const p = parseTeamVideos({ featured: [], clips: [clip(1, { still: ok }), clip(2, { still: { ...ok, src: "http://i.ytimg.com/x" } })] })!;
    expect(p.clips[0].still).toEqual(ok);
    expect(p.clips[1]).not.toHaveProperty("still");
  });
  it("links to YouTube at the clip's start", () => {
    expect(watchUrl("ccccccccccc", 300)).toBe("https://www.youtube.com/watch?v=ccccccccccc&t=300s");
    expect(watchUrl("ddddddddddd")).toBe("https://www.youtube.com/watch?v=ddddddddddd");
  });
});

describe("team videos client", () => {
  const fake = (respond: (url: string) => Response | Promise<Response>) => {
    const calls: { url: string; key: string | null }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, key: new Headers(init?.headers).get("X-Internal-Key") });
      return respond(url);
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };
  const ok = () => new Response(JSON.stringify(answer), { status: 200 });

  it("asks Scout with the shared key, once per team within the cache window", async () => {
    let t = 0;
    const f = fake(ok);
    const c = createTeamVideosClient({ origin: "https://scout.test", key: KEY, fetchImpl: f.fetchImpl, now: () => t });
    expect((await c.get(100))!.clips).toHaveLength(2);
    await c.get(100);
    expect(f.calls).toEqual([{ url: "https://scout.test/internal/teams/100/videos", key: KEY }]);
    t = CACHE_MS;
    await c.get(100);
    expect(f.calls).toHaveLength(2);
  });

  it("shares one call between dashboards opened together", async () => {
    const f = fake(ok);
    const c = createTeamVideosClient({ origin: "https://scout.test", key: KEY, fetchImpl: f.fetchImpl });
    await Promise.all([c.get(100), c.get(100), c.get(100)]);
    expect(f.calls).toHaveLength(1);
  });

  it("is null (never throws) when Scout is down, says no or sends nonsense; a failure is asked again after FAIL_MS", async () => {
    let t = 0;
    for (const respond of [() => { throw new Error("ECONNREFUSED"); }, () => new Response("{}", { status: 401 }), () => new Response("not json", { status: 200 })]) {
      const f = fake(respond as any);
      const c = createTeamVideosClient({ origin: "https://scout.test", key: KEY, fetchImpl: f.fetchImpl, now: () => t });
      expect(await c.get(100)).toBeNull();
      await c.get(100);
      expect(f.calls).toHaveLength(1);
      t += FAIL_MS;
      await c.get(100);
      expect(f.calls).toHaveLength(2);
    }
  });

  it("never calls without an origin or key, or for a number that isn't a team", async () => {
    const f = fake(ok);
    expect(await createTeamVideosClient({ origin: null, key: KEY, fetchImpl: f.fetchImpl }).get(100)).toBeNull();
    expect(await createTeamVideosClient({ origin: "https://scout.test", key: null, fetchImpl: f.fetchImpl }).get(100)).toBeNull();
    const c = createTeamVideosClient({ origin: "https://scout.test", key: KEY, fetchImpl: f.fetchImpl });
    for (const n of [0, -1, 1.5, 1_000_000]) expect(await c.get(n)).toBeNull();
    expect(f.calls).toHaveLength(0);
  });
});

describe("GET /api/ftc/team-videos", () => {
  let srv: TestServer;
  let scout: http.Server;
  const seen: { path: string; key?: string }[] = [];
  let admin: string, other: string;

  beforeAll(async () => {
    const app = express();
    app.get("/internal/teams/:n/videos", (req, res) => {
      seen.push({ path: req.path, key: req.get("X-Internal-Key") });
      if (req.get("X-Internal-Key") !== KEY) { res.status(401).json({ error: "unauthorized" }); return; }
      if (req.params.n === "200") { res.status(500).end(); return; }
      res.json(req.params.n === "100" ? answer : { featured: [], clips: [] });
    });
    scout = http.createServer(app);
    await new Promise<void>((r) => scout.listen(0, "127.0.0.1", () => r()));
    srv = await startTestServer("cp-team-videos-", { CONTROL_SCOUT_URL: `http://127.0.0.1:${(scout.address() as any).port}`, CONTROL_SCOUT_INTERNAL_KEY: KEY });
    const withTeam = await seedTeam(srv.db, "Featured Team");
    await srv.db.execute({ sql: "UPDATE teams SET ftc_team_number = 100 WHERE id = ?", args: [withTeam] });
    admin = await srv.session(await seedMember(srv.db, withTeam, "Ada", "ada@example.test", "admin"));
    const noTeam = await seedTeam(srv.db, "No FTC Team");
    other = await srv.session(await seedMember(srv.db, noTeam, "Grace", "grace@example.test"));
  }, 120_000);
  afterAll(async () => {
    await srv?.stop();
    await new Promise((r) => scout?.close(r));
  });

  it("needs a signed-in member", async () => {
    expect((await srv.api("/api/ftc/team-videos")).status).toBe(401);
  });

  it("answers the workspace's own team's videos, read from Scout with the shared key", async () => {
    const r = await srv.api("/api/ftc/team-videos", { session: admin });
    expect(r.status).toBe(200);
    expect(r.body.team).toBe(100);
    expect(r.body.videos.featured).toEqual([{ series: "behind-the-bot", videoId: "ddddddddddd", season: 2025, title: "Behind the Bot: Team 100" }]);
    expect(r.body.videos.clips.map((c: any) => c.match)).toEqual(["Q3", "Q1"]);
    expect(seen.at(-1)).toEqual({ path: "/internal/teams/100/videos", key: KEY });
    // The URL is the same for every workspace: the browser must never answer it from its cache after a switch.
    const raw = await fetch(`${srv.base}/api/ftc/team-videos`, { headers: { cookie: `cp_session=${encodeURIComponent(admin)}` } });
    expect(raw.headers.get("cache-control")).toBe("no-store");
  });

  it("a workspace with no FTC team: nothing, and Scout isn't asked", async () => {
    const before = seen.length;
    expect((await srv.api("/api/ftc/team-videos", { session: other })).body).toEqual({ team: null, videos: null });
    expect(seen.length).toBe(before);
  });

  it("Scout failing: nothing (hidden), never an error", async () => {
    await srv.db.execute({ sql: "UPDATE teams SET ftc_team_number = 200 WHERE name = 'No FTC Team'", args: [] });
    expect(await srv.api("/api/ftc/team-videos", { session: other })).toEqual({ status: 200, body: { team: null, videos: null } });
  });
});
