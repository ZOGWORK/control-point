/**
 * Bruno reads Control Scout searches its own search can't (POST /internal/bruno/search, contract in the header
 * of server/sharedAccounts.ts).
 *
 * Scout sends a visitor's query only after its own search (names, numbers, topics, typo forgiveness) found
 * nothing. Bruno rewrites it as a short query Scout's search understands: a team number or a team or event name,
 * plus at most one topic word, with spelling fixed. He never answers the question himself: Scout runs the
 * rewrite through its own search, so every result and number still comes from Scout's database.
 *
 * Pure (no DB, no network): the query check, the prompt and the output parser are testable on their own; the
 * route wires them to aiChat.
 */
import { extractJson } from "./brunoPowerRankings.js";

export const MAX_QUERY = 120;
export const MAX_REWRITE = 80;

/** The topic words Scout's search reads (its src/shared/search.ts SEARCH_TOPICS): the only extra words a rewrite may add. */
export const SEARCH_TOPIC_WORDS = ["awards", "matches", "ranking points", "opr", "record", "stats", "rankings", "odds", "playoffs"] as const;

// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/** Scout's request: `{ query }`, 1..MAX_QUERY characters once cleaned. */
export function validateSearchQuery(body: unknown): { ok: boolean; value?: string; error?: string } {
  const q = (body as { query?: unknown } | null)?.query;
  if (typeof q !== "string") return { ok: false, error: "query_required" };
  const s = clean(q);
  if (!s) return { ok: false, error: "query_required" };
  if (s.length > MAX_QUERY) return { ok: false, error: "query_too_long" };
  return { ok: true, value: s };
}

export const SEARCH_SYSTEM = `SEARCH JOB (this outranks the chat instructions above for this reply):
You help Control Scout, an FTC (FIRST Tech Challenge) robotics scouting site, read a visitor's search that its own search engine could not match. Rewrite it as a short query that search engine understands.

The search engine matches: a team number (like 4215), a team name (like "Hypnotic Robotics"), an event name or code (like "New Jersey Championship" or USNJCMP), or a match (like "USNJCMP Q12"), optionally followed by ONE topic word from this list: ${SEARCH_TOPIC_WORDS.join(", ")}.

Rules:
- Fix spelling and grammar, and drop question words ("how many", "what is", "did ... win").
- Keep the team number, team name or event name the visitor typed; correct an obvious misspelling of it, but never swap in a different team or event, and never add a name, number, year or fact that isn't in the query.
- Add at most one topic word from the list, and only when the query asks about it.
- Do not answer the question. Do not mention any other scouting, stats or rankings website or app.
- If the query isn't a search for an FTC team, event or match, the query is null.
- Reply with JSON only, no code fences and nothing before or after it, exactly in this shape:
{"query": "hypnotic robotics awards"}  or  {"query": null}`;

export function buildSearchPrompt(query: string): string {
  return `Visitor's search: ${JSON.stringify(query)}`;
}

/**
 * Bruno's rewrite, or null when he found no FTC search in it. Throws when the reply is not the agreed JSON shape
 * (the route answers 502). A rewrite that is too long or carries anything but letters, digits, spaces and
 * ' & . - is treated as no answer, as is one identical to what was asked (Scout already searched that).
 */
export function parseSearchOutput(raw: string, asked: string): string | null {
  let data: any;
  try {
    data = extractJson(raw);
  } catch {
    throw new Error("malformed_output");
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || !("query" in data)) throw new Error("malformed_output");
  if (data.query === null) return null;
  if (typeof data.query !== "string") throw new Error("malformed_output");
  const q = clean(data.query);
  if (!q || q.length > MAX_REWRITE || !/^[\p{L}\p{N} '&.-]+$/u.test(q)) return null;
  return q.toLowerCase() === asked.toLowerCase() ? null : q;
}
