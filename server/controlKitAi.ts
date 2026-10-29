// Control Kit's AI review, answered with Control Point's own model keys
// (contract: control-kit docs/control-point-link.md v1.2 §7). Control Kit's
// Worker sends a review it has already rebuilt from the person's stored scan;
// this asks Gemini first and Anthropic once, only when Gemini is rate limited,
// failing on its side, or unreachable (never on an auth or request error, which
// would hide a bad key), the same policy as Bruno (ai-hybrid.ts). Nothing is
// retried blindly. The answer is the model's JSON as it came; Control Kit
// validates every item against its own request.

const GEMINI_TIMEOUT_MS = 90_000;
const ANTHROPIC_TIMEOUT_MS = 90_000;
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
export const MAX_REVIEW_LINES = 150;
export const MAX_INSTRUCTIONS = 8000;
export const MAX_SCHEMA = 8000;

export type ReviewProvider = "gemini" | "anthropic";
export type ReviewAnswer = { output: unknown; provider: ReviewProvider; usage: { inputTokens: number | null; outputTokens: number | null } };
export type ReviewAsk = { instructions: string; schema: Record<string, unknown>; geminiSchema: Record<string, unknown>; request: Record<string, unknown> };
/** A failed review: `status` is what Control Point answers (429 rate limit, 502 refused or failed, 504 timeout). */
export class ReviewError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly failover = false) { super(message); }
}

type Env = Record<string, string | undefined>;
const geminiKey = (env: Env) => String(env.GEMINI_API_KEY || "").trim();
const anthropicKey = (env: Env) => String(env.ANTHROPIC_API_KEY || "").trim();
export const reviewConfigured = (env: Env) => !!(geminiKey(env) || anthropicKey(env));

const isStr = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const isStrOrNull = (v: unknown, max: number) => v === null || v === undefined || isStr(v, max);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const jsonSize = (v: unknown) => { try { return JSON.stringify(v).length; } catch { return Infinity; } };

/**
 * The review Control Kit may ask for, and nothing else: its instructions and output schemas (bounded), and a request of
 * the documented shape (version 1, 1 to 150 lines of part facts and catalog candidates). Anything else is refused, so the
 * route cannot be used as a general model proxy.
 */
export function checkReviewAsk(body: unknown): { ok: true; ask: ReviewAsk } | { ok: false; detail: string } {
  if (!isObj(body)) return { ok: false, detail: "Body must be a JSON object." };
  const { instructions, schema, geminiSchema, request } = body;
  if (typeof instructions !== "string" || !instructions.trim() || instructions.length > MAX_INSTRUCTIONS) return { ok: false, detail: "instructions are missing or too long." };
  if (!isObj(schema) || jsonSize(schema) > MAX_SCHEMA) return { ok: false, detail: "schema is missing or too large." };
  if (!isObj(geminiSchema) || jsonSize(geminiSchema) > MAX_SCHEMA) return { ok: false, detail: "geminiSchema is missing or too large." };
  if (!isObj(request) || request.version !== 1 || !isStr(request.assembly, 300) || !Array.isArray(request.lines)) return { ok: false, detail: "request must be a version 1 review." };
  if (!request.lines.length || request.lines.length > MAX_REVIEW_LINES) return { ok: false, detail: `request.lines must hold 1 to ${MAX_REVIEW_LINES} lines.` };
  for (const [i, line] of (request.lines as unknown[]).entries()) {
    if (!isObj(line) || !isStr(line.id, 8) || !isStr(line.name, 500) || !isStrOrNull(line.description, 2000) || !isStrOrNull(line.material, 300) || !isStrOrNull(line.partNumber, 300)
      || !Array.isArray(line.candidates) || line.candidates.length > 8 || (line.quantity !== undefined && typeof line.quantity !== "number")) {
      return { ok: false, detail: `request.lines[${i}] is not a review line.` };
    }
    for (const c of line.candidates as unknown[]) {
      if (!isObj(c) || !isStr(c.id, 140) || !isStr(c.sku, 80) || !isStr(c.vendor, 40) || !isStr(c.name, 200)) return { ok: false, detail: `request.lines[${i}] has a bad candidate.` };
    }
    if (jsonSize(line) > 6000) return { ok: false, detail: `request.lines[${i}] is too large.` };
  }
  return { ok: true, ask: { instructions, schema, geminiSchema, request } };
}

/**
 * One provider call, its body read inside the same deadline: a dropped connection or the deadline passing while the body
 * arrives is a failure (worth failing over for), never an empty answer. A 2xx whose body is not the provider's JSON
 * envelope fails the same way; only the model's own text may be unparseable, which is an answer with no items.
 */
async function call(fetcher: typeof fetch, url: string, init: RequestInit, ms: number, label: string): Promise<{ res: Response; body: any }> {
  let res: Response;
  let text: string;
  try {
    res = await fetcher(url, { ...init, signal: AbortSignal.timeout(ms) });
    text = await res.text();
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new ReviewError(504, "ai_timeout", `${label} did not answer within ${ms / 1000} seconds.`, true);
    throw new ReviewError(502, "ai_failed", `Could not reach ${label}.`, true);
  }
  if (!res.ok) return { res, body: null };
  const body = parsed(text);
  if (!body || typeof body !== "object") throw new ReviewError(502, "ai_failed", `${label} sent an unreadable response.`, true);
  return { res, body };
}
const parsed = (text: string) => { try { return JSON.parse(text); } catch { return null; } };

async function askGemini(env: Env, ask: ReviewAsk, fetcher: typeof fetch): Promise<ReviewAnswer> {
  const base = env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const { res, body } = await call(fetcher, `${base}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey(env) },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: ask.instructions }] }, contents: [{ role: "user", parts: [{ text: JSON.stringify(ask.request) }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: ask.geminiSchema } }),
  }, GEMINI_TIMEOUT_MS, "Gemini");
  if (!res.ok) {
    const failover = res.status === 429 || res.status >= 500;
    throw new ReviewError(res.status === 429 ? 429 : 502, res.status === 429 ? "rate_limited" : "ai_failed",
      res.status === 429 ? "Gemini rate limit reached." : failover ? `Gemini failed (HTTP ${res.status}).` : `Gemini rejected the request (HTTP ${res.status}).`, failover);
  }
  const text = (body?.candidates?.[0]?.content?.parts ?? []).map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
  return { output: parsed(text), provider: "gemini", usage: { inputTokens: body?.usageMetadata?.promptTokenCount ?? null, outputTokens: body?.usageMetadata?.candidatesTokenCount ?? null } };
}

async function askAnthropic(env: Env, ask: ReviewAsk, fetcher: typeof fetch): Promise<ReviewAnswer> {
  const base = env.ANTHROPIC_API_BASE || "https://api.anthropic.com/v1";
  const { res, body } = await call(fetcher, `${base}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": anthropicKey(env), "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01" },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL, max_tokens: 16000, system: ask.instructions, fallbacks: "default",
      messages: [{ role: "user", content: JSON.stringify(ask.request) }], output_config: { effort: "low", format: { type: "json_schema", schema: ask.schema } } }),
  }, ANTHROPIC_TIMEOUT_MS, "Anthropic");
  if (!res.ok) {
    throw new ReviewError(res.status === 429 ? 429 : 502, res.status === 429 ? "rate_limited" : "ai_failed",
      res.status === 429 ? "Anthropic rate limit reached." : res.status >= 500 ? `Anthropic failed (HTTP ${res.status}).` : `Anthropic rejected the request (HTTP ${res.status}).`);
  }
  if (body?.stop_reason === "refusal") throw new ReviewError(502, "ai_failed", "Anthropic declined the request.");
  if (body?.stop_reason === "max_tokens") throw new ReviewError(502, "ai_failed", "Anthropic's answer was cut off.");
  const text = (body?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => String(b.text ?? "")).join("");
  return { output: parsed(text), provider: "anthropic", usage: { inputTokens: body?.usage?.input_tokens ?? null, outputTokens: body?.usage?.output_tokens ?? null } };
}

/** One review: Gemini when its key is set, Anthropic once when Gemini cannot answer for a reason worth failing over for. */
export async function runReview(env: Env, ask: ReviewAsk, fetcher: typeof fetch = fetch): Promise<ReviewAnswer> {
  if (!reviewConfigured(env)) throw new ReviewError(501, "ai_unavailable", "AI review is not set up on this Control Point server.");
  if (!geminiKey(env)) return askAnthropic(env, ask, fetcher);
  try { return await askGemini(env, ask, fetcher); }
  catch (e) {
    if (!(e instanceof ReviewError) || !e.failover || !anthropicKey(env)) throw e;
    console.warn(`[Control Kit AI] ${e.message} Asking Anthropic once.`);
    return askAnthropic(env, ask, fetcher);
  }
}
