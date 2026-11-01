/**
 * POST /internal/bruno/search-answer: Bruno answers a Control Scout search question from the facts Scout's search
 * found (server/brunoSearchAnswer.ts, contract in the header of server/sharedAccounts.ts). The model is always a
 * fake here; no test reaches Gemini or Anthropic.
 */
import http from "http";
import express from "express";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createSharedAccounts, SEARCH_ANSWER_RATE } from "../sharedAccounts";
import {
  MAX_FACTS,
  SEARCH_ANSWER_SYSTEM,
  buildSearchAnswerPrompt,
  parseSearchAnswerOutput,
  validateAnswerPacket,
} from "../brunoSearchAnswer";

const KEY = "test-internal-key-0123456789-abcdefghijklmnop";
const FACTS = [
  "Control Scout's event records start with the 2023–24 FTC season; nothing earlier is recorded.",
  "State championships for team 4215 Hypnotic Robotics: 3 found (3 times).",
  "- New Jersey Championship - Turnpike Division: 2024–25 · Mar 16, 2025 · ranked #7 · 3-2-0 in quals · OPR 117.3",
];
const packet = (extra: Record<string, unknown> = {}) => ({ question: "how many times did 4215 go to states", facts: FACTS, ...extra });

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
    const r = await fetch(`http://127.0.0.1:${port}/internal/bruno/search-answer`, {
      method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null), retryAfter: r.headers.get("retry-after") };
  };
}

describe("auth", () => {
  it("is 404 without CONTROL_SCOUT_INTERNAL_KEY and 401 on a wrong key, never calling Bruno", async () => {
    const write = vi.fn();
    expect((await (await boot({ env: {}, brunoWrite: write }))(packet())).status).toBe(404);
    const post = await boot({ brunoWrite: write });
    expect((await post(packet(), "wrong-key")).status).toBe(401);
    expect((await post(packet(), null)).status).toBe(401);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("input validation", () => {
  const bad: [string, unknown, string][] = [
    ["not an object", [], "invalid_body"],
    ["no question", packet({ question: "  " }), "question_required"],
    ["long question", packet({ question: "q".repeat(201) }), "question_too_long"],
    ["no facts", packet({ facts: [] }), "facts"],
    ["too many facts", packet({ facts: Array.from({ length: MAX_FACTS + 1 }, (_, i) => `fact ${i}`) }), "facts"],
    ["a fact not a string", packet({ facts: ["ok", 3] }), "facts[1]"],
    ["an empty fact", packet({ facts: ["ok", "   "] }), "facts[1]"],
    ["a long fact", packet({ facts: ["f".repeat(401)] }), "facts[0]"],
    ["too much in all", packet({ facts: Array.from({ length: 30 }, () => "f".repeat(300)) }), "facts_too_large"],
  ];
  for (const [label, body, field] of bad) {
    it(`rejects ${label}`, () => {
      const r = validateAnswerPacket(body);
      expect(r.ok).toBe(false);
      expect(r.error).toBe(field);
    });
  }
  it("keeps only the question and the facts, whitespace folded", () => {
    const r = validateAnswerPacket({ ...packet({ question: "  how many\ntimes  " }), secret: "x" });
    expect(r.value).toEqual({ question: "how many times", facts: FACTS });
  });
  it("answers 400 with the field, and never calls Bruno", async () => {
    const write = vi.fn();
    const post = await boot({ brunoWrite: write });
    const r = await post(packet({ facts: [] }));
    expect(r).toMatchObject({ status: 400, body: { error: "invalid_packet", field: "facts" } });
    expect(write).not.toHaveBeenCalled();
  });
});

describe("prompt", () => {
  it("holds the question and every fact, and the job forbids anything not in them", () => {
    const p = buildSearchAnswerPrompt(validateAnswerPacket(packet()).value!);
    expect(p).toContain('Question: "how many times did 4215 go to states"');
    for (const f of FACTS) expect(p).toContain(f.replace(/^- /, ""));
    expect(SEARCH_ANSWER_SYSTEM).toMatch(/only from the FACTS/);
    expect(SEARCH_ANSWER_SYSTEM).toMatch(/Never add a number/);
    expect(SEARCH_ANSWER_SYSTEM).toMatch(/other scouting, stats or rankings website/);
  });
});

describe("output", () => {
  it("reads the answer, with code fences and markdown stripped", () => {
    expect(parseSearchAnswerOutput('```json\n{"text": "**Yes**, 3 times since 2023–24."}\n```')).toBe("Yes, 3 times since 2023–24.");
  });
  it("any other Markdown comes back as plain text: single emphasis, links, lists, headings", () => {
    expect(parseSearchAnswerOutput('{"text": "*Yes*, _3_ times."}')).toBe("Yes, 3 times.");
    expect(parseSearchAnswerOutput('{"text": "See [Hypnotic Robotics](https://controlscout.org/teams/4215)."}')).toBe("See Hypnotic Robotics.");
    expect(parseSearchAnswerOutput('{"text": "## Answer\\n- 3 times\\n1. since 2023–24"}')).toBe("Answer 3 times since 2023–24");
    // Plain text is left alone: a record, a dash, an underscore inside a word.
    expect(parseSearchAnswerOutput('{"text": "Went 8-2-0 - ranked #3 in team_name 4215."}')).toBe("Went 8-2-0 - ranked #3 in team_name 4215.");
  });
  it("null stays null; an over-long answer counts as none; any other shape is malformed", () => {
    expect(parseSearchAnswerOutput('{"text": null}')).toBeNull();
    expect(parseSearchAnswerOutput(JSON.stringify({ text: "x".repeat(601) }))).toBeNull();
    expect(() => parseSearchAnswerOutput("Sure! 3 times.")).toThrow("malformed_output");
    expect(() => parseSearchAnswerOutput('{"answer": "3"}')).toThrow("malformed_output");
    expect(() => parseSearchAnswerOutput('{"text": 3}')).toThrow("malformed_output");
  });
});

describe("route", () => {
  it("sends the job to Bruno offline and answers his text", async () => {
    const write = vi.fn(async () => '{"text": "Hypnotic Robotics (4215) went to states 3 times since 2023–24."}');
    const post = await boot({ brunoWrite: write });
    const r = await post(packet());
    expect(r).toMatchObject({ status: 200, body: { text: "Hypnotic Robotics (4215) went to states 3 times since 2023–24." } });
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "search-answer", system: SEARCH_ANSWER_SYSTEM }));
  });
  it("503 when no AI is configured, 502 when it fails or replies off-shape", async () => {
    expect((await (await boot())(packet())).status).toBe(503);
    expect((await (await boot({ brunoWrite: async () => { throw new Error("AI not configured"); } }))(packet())).body).toEqual({ error: "ai_unavailable" });
    expect((await (await boot({ brunoWrite: async () => { throw new Error("boom"); } }))(packet())).body).toEqual({ error: "ai_failed" });
    expect((await (await boot({ brunoWrite: async () => "no json here" }))(packet())).body).toEqual({ error: "malformed_output" });
  });
  it("is rate limited to SEARCH_ANSWER_RATE calls an hour", async () => {
    let t = 1_000_000;
    const post = await boot({ brunoWrite: async () => '{"text": null}', now: () => t });
    for (let i = 0; i < SEARCH_ANSWER_RATE.max; i++) expect((await post(packet())).status).toBe(200);
    const r = await post(packet());
    expect(r.status).toBe(429);
    expect(Number(r.retryAfter)).toBeGreaterThan(0);
    t += SEARCH_ANSWER_RATE.windowMs;
    expect((await post(packet())).status).toBe(200);
  });
});
