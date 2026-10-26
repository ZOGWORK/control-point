// One line under Bruno's answer pointing to a sister app when the question is
// about its subject: team, event or match stats → Control Scout (detailed
// overviews and predictions), CAD / Onshape / the BOM / what to buy or print
// → Control Kit for Onshape. Decided here in code from the member's own
// question, not by the model, so it is predictable and tested
// (server/__tests__/suiteSuggestions.test.ts). At most one line per answer,
// none on unrelated questions, and none again once the conversation already
// links that app.
import { CONTROL_KIT_URL } from "../src/utils/controlKit.js";
import { CONTROL_SCOUT_URL, controlScoutEventUrl, controlScoutTeamUrl } from "../src/utils/controlScout.js";

export type SuiteIntent = "stats" | "cad";

// Enough on its own: these only mean FTC stats or CAD.
const STATS_STRONG = [
  /\b(opr|npopr|epa|ccwm|dpr)s?\b/i,
  /\bwin[ -]?(rate|loss|percentage)\b/i,
  /\b(rankings|standings|leaderboard)\b/i,
  /\b(world|state|regional|league|event|global)\s+(rank|ranking|stats?)\b/i,
  /\b(team|event|match|season)\s+(stats?|statistics|results?|scores?|predictions?|record)\b/i,
  /\b(match|score)\s+predictions?\b/i,
  /\bpredicted\s+(score|winner|rank)/i,
  /\bwho\s+(will|is\s+going\s+to|would)\s+win\b/i,
  /\b(high|top|average|avg|best)\s+scores?\b/i,
  /\balliance\s+(selection|partners?|picks?)\b/i,
  /\b(top|best|strongest)\s+teams\b/i,
];
// Only with an FTC subject in the same question (a team, event, match or a team number).
const STATS_WEAK = /\b(stats?|statistics|rank(ed|s|ing)?|record|predict(ion|ions|ed)?|forecast|odds|scores?|scored|advance|advancement|averag(e|ed|ing))\b/i;
const FTC_SUBJECT = /\b(teams?|events?|match(es)?|qualifiers?|quals?|league|regionals?|worlds|championships?|states|alliances?|ftc|opponents?)\b|#?\b\d{3,5}\b/i;
// Control Point's own records: "task stats", "attendance record", "budget odds" are not Scout's.
const CP_SUBJECT = /\b(tasks?|attendance|budget|expenses?|notebook|outreach|hours|inventory|checklists?|chats?|messages?|calendar|meetings?)\b/i;

const CAD_STRONG = [
  /\bon[ -]?shape\b/i,
  /\bcad\b/i,
  /\b(bom|boms)\b/i,
  /\bbill\s+of\s+materials?\b/i,
  /\b(parts?|buy|make|cut|shopping)\s+list\b/i,
  /\bstep\s+files?\b|\.step\b|\bstl\s+files?\b|\.stl\b/i,
  /\b3d[ -]?print(ed|ing|s)?\b/i,
];
// "what do we need to buy / order / print" about robot parts.
const CAD_BUY = /\b(buy|order|purchase|print|machine|make)\b/i;
const CAD_PARTS = /\b(parts?|hardware|motors?|servos?|brackets?|channels?|gears?|wheels?|bearings?|screws?|standoffs?|extrusions?|plates?)\b/i;

const score = (q: string, list: RegExp[]) => list.reduce((n, re) => n + (re.test(q) ? 1 : 0), 0);

/** What the question is about, for the sister-app line: Scout's stats, Kit's CAD, or neither. */
export function detectSuiteIntent(question: string): SuiteIntent | null {
  const q = String(question || "").slice(0, 4000);
  if (!q.trim()) return null;
  let stats = score(q, STATS_STRONG);
  if (!stats && STATS_WEAK.test(q) && FTC_SUBJECT.test(q) && !CP_SUBJECT.test(q)) stats = 1;
  let cad = score(q, CAD_STRONG);
  if (!cad && CAD_BUY.test(q) && CAD_PARTS.test(q)) cad = 1;
  if (!stats && !cad) return null;
  // Both: the stronger signal wins; a tie goes to stats (CAD words like
  // "parts" turn up in stats questions more than the other way round).
  return cad > stats ? "cad" : "stats";
}

/** One team number the question names ("team 6980", "#6980", "6980's OPR"), or null for none or several. */
export function teamNumberIn(question: string): number | null {
  const found = new Set<number>();
  const re = /(?:\bteam\s*#?\s*|#)(\d{1,5})\b|\b(\d{3,5})['’]s\b|\b(\d{3,5})\s+(?:opr|epa|stats?|rank(?:ing)?|record)\b/gi;
  for (const m of String(question || "").matchAll(re)) {
    const n = Number(m[1] || m[2] || m[3]);
    // "our 2025 OPR" names a season, not team 2025; "team 2025" and "2010's OPR" still name teams.
    if (m[3] && n >= 2000 && n <= 2099) continue;
    if (n > 0 && n < 100000) found.add(n);
  }
  return found.size === 1 ? [...found][0] : null;
}

const OWN_TEAM = /\b(we|us|our|ours|my team)\b/i;
const EVENT_CODE = /^[A-Z0-9]{3,16}$/i;

export interface SuiteSuggestionInput {
  /** The member's latest message, as typed (no attached files). */
  question: string;
  /** Bruno's reply so far (the line is skipped when it already links the app). */
  reply: string;
  /** Earlier turns' text: the line is not repeated once the chat has it. */
  history?: string[];
  season: number;
  /** Teams Bruno looked up this turn (its ```scout block). */
  lookedUpTeams?: number[] | null;
  /** The event Bruno looked up this turn (its ```scout-event block). */
  lookedUpEvent?: string | null;
  /** This workspace's FTC team number, for "our OPR". */
  ownTeam?: number | null;
}

function scoutHref(i: SuiteSuggestionInput): { href: string; label: string } {
  const teams = (i.lookedUpTeams || []).filter((n) => Number.isInteger(n) && n > 0);
  if (teams.length === 1) return { href: controlScoutTeamUrl(teams[0], i.season), label: `Team ${teams[0]} on Control Scout` };
  const event = i.lookedUpEvent && EVENT_CODE.test(i.lookedUpEvent) ? i.lookedUpEvent.toUpperCase() : null;
  if (event && !teams.length) return { href: controlScoutEventUrl(event, i.season), label: `${event} on Control Scout` };
  const named = teams.length ? null : teamNumberIn(i.question);
  if (named) return { href: controlScoutTeamUrl(named, i.season), label: `Team ${named} on Control Scout` };
  const own = Number(i.ownTeam) || 0;
  if (!teams.length && own > 0 && OWN_TEAM.test(i.question)) return { href: controlScoutTeamUrl(own, i.season), label: `Team ${own} on Control Scout` };
  return { href: CONTROL_SCOUT_URL, label: "Control Scout" };
}

/** The line to append under the answer ("\n\n…"), or "" when none fits. */
export function suiteSuggestion(i: SuiteSuggestionInput): string {
  // A team or event Bruno looked up this turn makes it a stats answer, whatever the wording.
  const lookedUp = !!(i.lookedUpTeams?.length || i.lookedUpEvent);
  const intent = detectSuiteIntent(i.question) ?? (lookedUp ? "stats" : null);
  if (!intent) return "";
  const host = intent === "stats" ? "controlscout.org" : new URL(CONTROL_KIT_URL).host;
  const seen = [i.reply, ...(i.history || [])].some((t) => String(t || "").toLowerCase().includes(host));
  if (seen) return "";
  if (intent === "cad") {
    return `\n\n_For a BOM, buy list and STEP files straight from your Onshape assembly, try [Control Kit for Onshape](${CONTROL_KIT_URL})._`;
  }
  const { href, label } = scoutHref(i);
  return `\n\n_For detailed team, event and match overviews and predictions, see [${label}](${href})._`;
}
