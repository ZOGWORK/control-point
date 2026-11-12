/**
 * POST /internal/bruno/discord-chat: Bruno chats back to a mention of Control Scout's Discord bot (or a reply to it),
 * from the facts Scout's search found and the reply chain before it (server/brunoDiscordChat.ts, contract in the
 * header of server/sharedAccounts.ts). The model is always a fake here; no test reaches Gemini or Anthropic.
 */
import http from "http";
import express from "express";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createSharedAccounts, DISCORD_CHAT_MAX_TOKENS, DISCORD_CHAT_RATE } from "../sharedAccounts";
import { DISCORD_CHAT_SYSTEM, MAX_HISTORY, MAX_MESSAGE, MAX_REPLY, buildChatPrompt, parseChatOutput, validateChatPacket } from "../brunoDiscordChat";

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
  it("reads the reply and its search flag, strips markdown, caps the length", () => {
    expect(parseChatOutput('{"text": "Hey! I\'m **Bruno**.", "search": false}')).toEqual({ text: "Hey! I'm Bruno.", search: false });
    expect(parseChatOutput('```json\n{"text": "30030 Exodus won.", "search": true}\n```')).toEqual({ text: "30030 Exodus won.", search: true });
    // Anything but true is false.
    expect(parseChatOutput('{"text": "Hi", "search": "yes"}').search).toBe(false);
    const long = parseChatOutput(JSON.stringify({ text: "word ".repeat(300), search: false })).text;
    expect(long.length).toBeLessThanOrEqual(MAX_REPLY);
    expect(long.endsWith("…")).toBe(true);
  });
  it("no text, or not the JSON shape, is malformed", () => {
    expect(() => parseChatOutput("Hey there!")).toThrow("malformed_output");
    expect(() => parseChatOutput('{"text": null}')).toThrow("malformed_output");
    expect(() => parseChatOutput('{"text": "   "}')).toThrow("malformed_output");
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
  it("400 on a bad packet, 503 with no AI, 502 when it fails or replies off-shape", async () => {
    const write = vi.fn();
    expect((await (await boot({ brunoWrite: write }))({ facts: [] })).body).toEqual({ error: "invalid_packet", field: "message_required" });
    expect(write).not.toHaveBeenCalled();
    expect((await (await boot())(packet())).status).toBe(503);
    expect((await (await boot({ brunoWrite: async () => { throw new Error("AI not configured"); } }))(packet())).body).toEqual({ error: "ai_unavailable" });
    expect((await (await boot({ brunoWrite: async () => { throw new Error("boom"); } }))(packet())).body).toEqual({ error: "ai_failed" });
    expect((await (await boot({ brunoWrite: async () => "hello!" }))(packet())).body).toEqual({ error: "malformed_output" });
  });
  it("is rate limited per hour", async () => {
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
