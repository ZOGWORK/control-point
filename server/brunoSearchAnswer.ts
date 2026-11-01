/**
 * Bruno answers a Control Scout search question (POST /internal/bruno/search-answer, contract in the header of
 * server/sharedAccounts.ts).
 *
 * Scout sends a visitor's question ("how many times did 4215 go to states") with the facts its own search found
 * for it, each a line of plain text (the team's championships with dates, ranks, records and OPRs; the top
 * results; the team's latest season). Bruno writes a short answer from those lines and nothing else, or null when
 * they don't answer it. Scout checks every number in the answer against the facts before showing it.
 *
 * Pure (no DB, no network): the packet check, the prompt and the output parser are testable on their own; the
 * route wires them to aiChat.
 */
import { extractJson } from "./brunoPowerRankings.js";

export const MAX_QUESTION = 200;
export const MAX_FACTS = 40;
export const MAX_FACT = 400;
export const MAX_FACTS_CHARS = 8000;
export const MAX_ANSWER = 600;

// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

export interface SearchAnswerPacket { question: string; facts: string[] }

/** Scout's request: `{ question, facts }`. Unknown fields are dropped, never echoed to the model. */
export function validateAnswerPacket(body: unknown): { ok: boolean; value?: SearchAnswerPacket; error?: string } {
  const b = body as { question?: unknown; facts?: unknown } | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return { ok: false, error: "invalid_body" };
  if (typeof b.question !== "string" || !clean(b.question)) return { ok: false, error: "question_required" };
  const question = clean(b.question);
  if (question.length > MAX_QUESTION) return { ok: false, error: "question_too_long" };
  if (!Array.isArray(b.facts) || b.facts.length < 1 || b.facts.length > MAX_FACTS) return { ok: false, error: "facts" };
  const facts: string[] = [];
  for (let i = 0; i < b.facts.length; i++) {
    const f = b.facts[i];
    if (typeof f !== "string") return { ok: false, error: `facts[${i}]` };
    const s = clean(f);
    if (!s || s.length > MAX_FACT) return { ok: false, error: `facts[${i}]` };
    facts.push(s);
  }
  if (facts.join("\n").length > MAX_FACTS_CHARS) return { ok: false, error: "facts_too_large" };
  return { ok: true, value: { question, facts } };
}

/** Appended to Bruno's system prompt for this job. */
export const SEARCH_ANSWER_SYSTEM = `SEARCH ANSWER JOB (this outranks the chat instructions above for this reply):
You answer a visitor's question on Control Scout, an FTC (FIRST Tech Challenge) robotics scouting site, above its search results. You are given the question and a list of FACTS: the records the site's own search found for it.

Rules:
- Answer only from the FACTS. Never add a number, year, date, event, rank, record, OPR, award or team that isn't in them, and never guess or estimate.
- Answer the question directly first ("Yes, 3 times: ..."), then the key specifics from the FACTS. 1 to 3 short sentences, at most 70 words. Plain text: no markdown, no lists, no links.
- Copy numbers exactly as the FACTS write them (OPR 237.4, ranked #3, 8-2-0). Write counts as digits.
- When the FACTS say the records start at a season, and the question is about a whole history ("how many times", "ever"), say the count is from that season on.
- If the FACTS don't answer the question, the text is null. Do not say what you would need.
- Friendly and neutral. Do not mention any other scouting, stats or rankings website or app.
- Reply with JSON only, no code fences and nothing before or after it, exactly in this shape:
{"text": "Yes, Hypnotic Robotics (4215) went to states 3 times since 2023-24: ..."}  or  {"text": null}`;

export function buildSearchAnswerPrompt(p: SearchAnswerPacket): string {
  return `Question: ${JSON.stringify(p.question)}\n\nFACTS:\n${p.facts.map((f) => `- ${f.replace(/^- /, "")}`).join("\n")}`;
}

/**
 * Bruno's answer, or null when he found none in the facts. Throws when the reply is not the agreed JSON shape (the
 * route answers 502). Markdown he slipped in is stripped; an answer past MAX_ANSWER characters is treated as none.
 */
export function parseSearchAnswerOutput(raw: string): string | null {
  let data: any;
  try {
    data = extractJson(raw);
  } catch {
    throw new Error("malformed_output");
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || !("text" in data)) throw new Error("malformed_output");
  if (data.text === null) return null;
  if (typeof data.text !== "string") throw new Error("malformed_output");
  const t = clean(plain(data.text));
  if (!t || t.length > MAX_ANSWER) return null;
  return t;
}

/** Markdown he slipped in, as plain text: links keep their words, emphasis, code, headings and list markers go. */
function plain(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*{1,3}|_{1,3})(?=\S)([^*_]*?\S)\1/g, "$2")
    .replace(/`+/g, "");
}
