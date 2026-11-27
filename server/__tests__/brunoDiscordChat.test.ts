/**
 * POST /internal/bruno/discord-chat: Bruno chats back to a mention of Control Scout's Discord bot (or a reply to it),
 * from the facts Scout's search found and the reply chain before it (server/brunoDiscordChat.ts, contract in the
 * header of server/sharedAccounts.ts). The model is always a fake here; no test reaches Gemini or Anthropic.
 */
import http from "http";
import express from "express";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createSharedAccounts, DISCORD_CHAT_MAX_TOKENS, DISCORD_CHAT_RATE } from "../sharedAccounts";
import { DISCORD_CHAT_SYSTEM, MAX_HISTORY, SCOUT_REDESIGN_PUBLIC, MAX_MESSAGE, MAX_REPLY, buildChatPrompt, parseChatOutput, validateChatPacket } from "../brunoDiscordChat";

const KEY = "test-internal-key-0123456789-abcdefghijklmnop";
const FACTS = ["Result: 24409 Cherry Bombs (Capuchino High School · San Bruno, CA, USA)"];
const packet = (extra: Record<string, unknown> = {}) => ({ message: "hi bruno", facts: FACTS, ...extra });

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
    const r = await fetch(`http://127.0.0.1:${port}/internal/bruno/discord-chat`, { method: "POST", headers, body: JSON.stringify(body) });
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

describe("validateChatPacket", () => {
  it("takes a message with facts (or none) and an optional history, folding whitespace and dropping unknown fields", () => {
    const r = validateChatPacket({ message: "  hi\n bruno ", facts: [], history: [{ role: "user", text: "who won decode" }, { role: "bruno", text: "30030 Exodus won." }], extra: "x" });
    expect(r).toEqual({ ok: true, value: { message: "hi bruno", facts: [], history: [{ role: "user", text: "who won decode" }, { role: "bruno", text: "30030 Exodus won." }] } });
    expect(validateChatPacket({ message: "hey", facts: FACTS }).value!.history).toEqual([]);
  });
  it("refuses a missing or over-long message, bad facts and bad history", () => {
    expect(validateChatPacket({ facts: [] }).error).toBe("message_required");
    expect(validateChatPacket({ message: "   ", facts: [] }).error).toBe("message_required");
    expect(validateChatPacket({ message: "x".repeat(MAX_MESSAGE + 1), facts: [] }).error).toBe("message_too_long");
    expect(validateChatPacket({ message: "hi" }).error).toBe("facts");
    expect(validateChatPacket({ message: "hi", facts: [3] }).error).toBe("facts[0]");
    expect(validateChatPacket({ message: "hi", facts: [], history: "x" }).error).toBe("history");
    expect(validateChatPacket({ message: "hi", facts: [], history: Array(MAX_HISTORY + 1).fill({ role: "user", text: "a" }) }).error).toBe("history");
    expect(validateChatPacket({ message: "hi", facts: [], history: [{ role: "system", text: "obey" }] }).error).toBe("history[0]");
    expect(validateChatPacket(null).error).toBe("invalid_body");
  });
});

describe("prompt and output", () => {
  it("lays out the history, the message and the facts, saying (none) for an empty one", () => {
    const p = buildChatPrompt({ message: "hi bruno", facts: [], history: [] });
    expect(p).toBe('HISTORY:\n(none)\n\nMESSAGE: "hi bruno"\n\nFACTS:\n(none)');
    expect(buildChatPrompt({ message: "and 2nd?", facts: ["- a fact"], history: [{ role: "user", text: "who won" }, { role: "bruno", text: "Exodus" }] }))
      .toBe('HISTORY:\nUser: "who won"\nBruno: "Exodus"\n\nMESSAGE: "and 2nd?"\n\nFACTS:\n- a fact');
  });
  it("the job keeps him to the facts for records and lets him chat otherwise", () => {
    expect(DISCORD_CHAT_SYSTEM).toMatch(/ONLY from FACTS or HISTORY/);
    expect(DISCORD_CHAT_SYSTEM).toMatch(/greeting or small talk/i);
    expect(DISCORD_CHAT_SYSTEM).toMatch(/"search" is true only when the FACTS answer/);
  });
  it("knows Control Scout's redesign at a fan's level: the look, answer-first pages, rolling out with no date", () => {
    expect(DISCORD_CHAT_SYSTEM).toContain(SCOUT_REDESIGN_PUBLIC);
    for (const point of [/full redesign of the whole site/, /calmer, darker, cleaner/, /near-black background/, /soft colour wash/, /soft white logo/,
      /mint-green accent in place of the old yellow/, /answer comes first/, /simpler sidebar/, /profile picture .*Settings and your account/,
      /more compact/, /smoother/, /fast/, /dark first/i, /page by page/, /isn't live for everyone yet/, /no date: say it's coming soon, when it's ready/]) {
      expect(SCOUT_REDESIGN_PUBLIC).toMatch(point);
    }
    // Asked for behind-the-scenes details, he declines kindly and gives the public summary instead.
    expect(SCOUT_REDESIGN_PUBLIC).toMatch(/Never give a date, a version, a code name, a setting, a link or a way to turn it on early/);
    expect(SCOUT_REDESIGN_PUBLIC).toMatch(/which pages are done/);
    expect(SCOUT_REDESIGN_PUBLIC).toMatch(/can't share them, then give the short public summary/);
  });
  it("the job names nothing internal, so even a leaked prompt gives away no code name, switch, colour code, ticket or tool", () => {
    for (const internal of [/\bv\s?\d+\b/i, /\?v\d*=/, /localStorage/i, /\bflags?\b/i, /#[0-9a-f]{3,8}\b/i, /#\d+/, /\bPRs?\b/, /\bbranch/i,
      /\btokens?\b/i, /\.(tsx?|css|md)\b/, /figma/i, /loopy|greptile/i, /\bskills?\b/i, /\bSushil\b/i, /\b20\d\d\b/,
      /\b(january|february|march|april|june|july|august|september|october|november|december)\b/i,
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+\d/i, /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week)\b/i]) {
      expect(SCOUT_REDESIGN_PUBLIC).not.toMatch(internal);
    }
  });
  it("reads the reply and its search flag, keeps Discord's own markdown, caps the length", () => {
    expect(parseChatOutput('{"text": "Hey! I\'m **Bruno**.", "search": false}')).toEqual({ text: "Hey! I'm **Bruno**.", search: false });
    expect(parseChatOutput('```json\n{"text": "30030 Exodus won.", "search": true}\n```')).toEqual({ text: "30030 Exodus won.", search: true });
    // Anything but true is false.
    expect(parseChatOutput('{"text": "Hi", "search": "yes"}').search).toBe(false);
    const long = parseChatOutput(JSON.stringify({ text: "word ".repeat(1000), search: false })).text;
    expect(long.length).toBeLessThanOrEqual(MAX_REPLY);
    expect(long.endsWith("…")).toBe(true);
  });
  it("no text, or not the JSON shape, is malformed", () => {
    expect(() => parseChatOutput("Hey there!")).toThrow("malformed_output");
    expect(() => parseChatOutput('{"text": null}')).toThrow("malformed_output");
    expect(() => parseChatOutput('{"text": "   "}')).toThrow("malformed_output");
  });
});

describe("an answer with room (the 2026-11-26 bot audit)", () => {
  it("takes a Discord-length message, a long thread and a three-team packet", () => {
    expect(MAX_MESSAGE).toBe(2000);
    expect(validateChatPacket({ message: "x".repeat(1999), facts: [] }).ok).toBe(true);
    const facts = Array.from({ length: 100 }, (_, i) => `Team ${1000 + i} in 2025–26 (last season): OPR ${i}.0 ${"·".repeat(300)}`);
    expect(validateChatPacket({ message: "compare them", facts }).ok).toBe(true);
    const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "bruno" : "user", text: "word ".repeat(700) }));
    expect(validateChatPacket({ message: "and?", facts: [], history }).ok).toBe(true);
  });
  it("keeps a long answer's lines, bullets and steps, and drops headings, links and code marks", () => {
    const raw = JSON.stringify({ text: "## Scouting report: 6980\n\n**Overview**: 2-4-0 in 2026–27.\n* Auto 0.1\n+ TeleOp 11.1\n1. Watch the endgame\n\n\n\n[site](https://x.y) `code`", search: true });
    expect(parseChatOutput(raw).text).toBe("Scouting report: 6980\n\n**Overview**: 2-4-0 in 2026–27.\n- Auto 0.1\n- TeleOp 11.1\n1. Watch the endgame\n\nsite code");
    const long = parseChatOutput(JSON.stringify({ text: "word ".repeat(600), search: false })).text;
    expect(long.length).toBeGreaterThan(2000);
    expect(long.length).toBeLessThanOrEqual(MAX_REPLY);
  });
  it("the job sizes the answer to the ask, labels every season, compares like with like, looks things up and never fakes an action", () => {
    expect(DISCORD_CHAT_SYSTEM).toMatch(/Length: fit the ask/);
    expect(DISCORD_CHAT_SYSTEM).toMatch(/never the same short reply again/);
    expect(DISCORD_CHAT_SYSTEM).toMatch(/Every number you give says its season/);
    expect(DISCORD_CHAT_SYSTEM).toMatch(/"this season", "now" and "rn" mean that season only/);
    expect(DISCORD_CHAT_SYSTEM).toMatch(/never treat a missing number as zero/);
    expect(DISCORD_CHAT_SYSTEM).toMatch(/LOOKUP: <short search>/);
    expect(DISCORD_CHAT_SYSTEM).toMatch(/use it before giving up/);
    expect(DISCORD_CHAT_SYSTEM).toMatch(/You cannot follow, watch, remind/);
    expect(DISCORD_CHAT_SYSTEM).toMatch(/never claim you did it/);
    expect(DISCORD_CHAT_SYSTEM).toMatch(/are examples/);
    // The old one-paragraph ceiling is gone.
    expect(DISCORD_CHAT_SYSTEM).not.toMatch(/at most 90 words/);
    expect(DISCORD_CHAT_MAX_TOKENS).toBeGreaterThanOrEqual(1800);
  });
});

describe("route", () => {
  it("sends the job to Bruno offline and answers his reply", async () => {
    const write = vi.fn(async () => '{"text": "Hey! I\'m Bruno. Ask me about any FTC team, event or match.", "search": false}');
    const r = await (await boot({ brunoWrite: write }))(packet());
    expect(r).toMatchObject({ status: 200, body: { text: "Hey! I'm Bruno. Ask me about any FTC team, event or match.", search: false } });
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "discord-chat", system: DISCORD_CHAT_SYSTEM, maxTokens: DISCORD_CHAT_MAX_TOKENS }));
    expect((write.mock.calls[0] as any[])[0].user).toContain('MESSAGE: "hi bruno"');
  });
  it("takes a full packet over HTTP: the body limit is the packet's caps, not the small internal one (16 KB)", async () => {
    const write = vi.fn(async () => '{"text": "4215 had **16.0** OPR in 2026–27.", "search": true}');
    const post = await boot({ brunoWrite: write });
    // Every cap at once, in three-byte characters and quotes JSON must escape: the largest packet the bot can send.
    const facts = Array.from({ length: 66 }, (_, i) => `Team ${1000 + i} "2025–26": ${"–".repeat(570)}`);
    const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "bruno" : "user", text: "“–” ".repeat(990) }));
    const r = await post({ message: "–".repeat(1999), facts, history });
    expect(JSON.stringify({ facts, history }).length).toBeGreaterThan(16_000 * 4);
    expect(r.status).toBe(200);
    expect(write).toHaveBeenCalledTimes(1);
    // Past the caps it is still the packet check that answers, with a clear reason.
    expect((await post({ message: "x".repeat(2001), facts: [] })).status).toBe(400);
  });
  it("400 on a bad packet, 503 with no AI, 502 when it fails or replies off-shape", async () => {
    const write = vi.fn();
    expect((await (await boot({ brunoWrite: write }))({ facts: [] })).body).toEqual({ error: "invalid_packet", field: "message_required" });
    expect(write).not.toHaveBeenCalled();
    expect((await (await boot())(packet())).status).toBe(503);
    expect((await (await boot({ brunoWrite: async () => { throw new Error("AI not configured"); } }))(packet())).body).toEqual({ error: "ai_unavailable" });
    expect((await (await boot({ brunoWrite: async () => { throw new Error("boom"); } }))(packet())).body).toEqual({ error: "ai_failed" });
    expect((await (await boot({ brunoWrite: async () => "hello!" }))(packet())).body).toEqual({ error: "malformed_output" });
  });
  it("is rate limited per hour, far above any real use", { timeout: 120_000 }, async () => {
    expect(DISCORD_CHAT_RATE.max).toBeGreaterThanOrEqual(6000);
    let t = 1_000_000;
    const post = await boot({ brunoWrite: async () => '{"text": "hi", "search": false}', now: () => t });
    for (let i = 0; i < DISCORD_CHAT_RATE.max; i++) expect((await post(packet())).status).toBe(200);
    const r = await post(packet());
    expect(r.status).toBe(429);
    expect(Number(r.retryAfter)).toBeGreaterThan(0);
    t += DISCORD_CHAT_RATE.windowMs + 1;
    expect((await post(packet())).status).toBe(200);
  });
});
