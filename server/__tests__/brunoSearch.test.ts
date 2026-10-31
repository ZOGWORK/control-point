/**
 * POST /internal/bruno/search: Bruno rewrites a Control Scout search its own search couldn't match
 * (server/brunoSearch.ts, contract in the header of server/sharedAccounts.ts). The model is always a fake here.
 */
import http from "http";
import express from "express";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createSharedAccounts, BRUNO_SEARCH_RATE } from "../sharedAccounts";
import { MAX_QUERY, SEARCH_SYSTEM, buildSearchPrompt, parseSearchOutput, validateSearchQuery } from "../brunoSearch";

const KEY = "test-internal-key-0123456789-abcdefghijklmnop";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function boot(opts: { env?: Record<string, string>; brunoWrite?: any; now?: () => number } = {}) {
  const shared = createSharedAccounts({
    dbGet: async () => null,
    dbAll: async () => [],
    dbRun: async () => ({ changes: 0, lastInsertRowid: 0 }),
    sessionEmail: async () => null,
    countAdmins: async () => 0,
    removeMembership: async () => {},
    brunoWrite: opts.brunoWrite,
    env: opts.env ?? { CONTROL_SCOUT_INTERNAL_KEY: KEY },
    now: opts.now,
  });
  const app = express();
  app.use("/internal", shared.internalRouter());
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as any).port;
  return async (body: unknown, key: string | null = KEY) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (key !== null) headers["x-internal-key"] = key;
    const r = await fetch(`http://127.0.0.1:${port}/internal/bruno/search`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null), retryAfter: r.headers.get("retry-after") };
  };
}

describe("validateSearchQuery", () => {
  it("takes a query, folding whitespace, up to MAX_QUERY characters", () => {
    expect(validateSearchQuery({ query: "  how many   awards\n did hypnotic win " })).toEqual({ ok: true, value: "how many awards did hypnotic win" });
    expect(validateSearchQuery({ query: "x".repeat(MAX_QUERY) }).ok).toBe(true);
    expect(validateSearchQuery({ query: "x".repeat(MAX_QUERY + 1) })).toEqual({ ok: false, error: "query_too_long" });
    expect(validateSearchQuery({ query: "  " })).toEqual({ ok: false, error: "query_required" });
    expect(validateSearchQuery({})).toEqual({ ok: false, error: "query_required" });
    expect(validateSearchQuery(null)).toEqual({ ok: false, error: "query_required" });
  });
});

describe("parseSearchOutput", () => {
  it("returns Bruno's rewrite, or null when there is none to use", () => {
    expect(parseSearchOutput('{"query": "hypnotic robotics awards"}', "hw many awrds did hypnotc win")).toBe("hypnotic robotics awards");
    expect(parseSearchOutput('```json\n{"query": "4215 ranking points"}\n```', "4215 rp?")).toBe("4215 ranking points");
    expect(parseSearchOutput('{"query": null}', "what's for lunch")).toBeNull();
    // The same query Scout already searched, too long, or with markup: nothing to use.
    expect(parseSearchOutput('{"query": "Hypnotic Awards"}', "hypnotic awards")).toBeNull();
    expect(parseSearchOutput(JSON.stringify({ query: "a".repeat(81) }), "x")).toBeNull();
    expect(parseSearchOutput('{"query": "<b>4215</b>"}', "x")).toBeNull();
    expect(parseSearchOutput('{"query": "visit https://example.com"}', "x")).toBeNull();
  });
  it("throws on anything that isn't the agreed shape", () => {
    for (const raw of ["no json here", "[1, 2]", '{"answer": "4215"}', '{"query": 4215}']) expect(() => parseSearchOutput(raw, "x")).toThrow("malformed_output");
  });
});

describe("POST /internal/bruno/search", () => {
  it("is 401 without the key, and never calls Bruno", async () => {
    const write = vi.fn();
    const post = await boot({ brunoWrite: write });
    expect((await post({ query: "hypnotic awrds" }, null)).status).toBe(401);
    expect(write).not.toHaveBeenCalled();
  });

  it("answers Bruno's rewrite, sending the search job and the query (offline job, 'search' usage)", async () => {
    const write = vi.fn(async () => '{"query": "hypnotic robotics awards"}');
    const post = await boot({ brunoWrite: write });
    const r = await post({ query: "how many awards did hypnotc robtics win" });
    expect(r).toMatchObject({ status: 200, body: { query: "hypnotic robotics awards" } });
    expect(write).toHaveBeenCalledWith({ endpoint: "search", system: SEARCH_SYSTEM, user: buildSearchPrompt("how many awards did hypnotc robtics win"), maxTokens: 200 });
  });

  it("is 400 on a bad query, 503 with no model, 502 on a failed or malformed reply", async () => {
    expect((await (await boot({ brunoWrite: vi.fn() }))({ query: "" })).body).toEqual({ error: "invalid_query", field: "query_required" });
    expect((await (await boot())({ query: "4215" })).status).toBe(503);
    expect((await (await boot({ brunoWrite: async () => { throw new Error("Gemini not configured"); } }))({ query: "4215" })).status).toBe(503);
    expect((await (await boot({ brunoWrite: async () => { throw new Error("boom"); } }))({ query: "4215" })).body).toEqual({ error: "ai_failed" });
    expect((await (await boot({ brunoWrite: async () => "sorry, no" }))({ query: "4215" })).body).toEqual({ error: "malformed_output" });
  });

  it("rate-limits to BRUNO_SEARCH_RATE an hour, with Retry-After", async () => {
    let t = 1_000_000;
    const post = await boot({ brunoWrite: async () => '{"query": null}', now: () => t });
    for (let i = 0; i < BRUNO_SEARCH_RATE.max; i++) expect((await post({ query: `q${i}` })).status).toBe(200);
    const over = await post({ query: "one more" });
    expect(over.status).toBe(429);
    expect(Number(over.retryAfter)).toBeGreaterThan(0);
    t += BRUNO_SEARCH_RATE.windowMs + 1;
    expect((await post({ query: "later" })).status).toBe(200);
  });
});
