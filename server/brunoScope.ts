/**
 * Bruno stays on FTC. A message that is plainly schoolwork for class (an
 * essay on chocolate milk, "solve 3x + 5 = 20") is refused here, before any
 * model call, and scores as a homework flag for the owner's review queue.
 * Anything that mentions the robot or the team goes to Bruno, whose own
 * rules (BUILD_HELPER_SYSTEM, "STAY ON FTC") decide the borderline cases.
 */

/** Weighted signals that a message is homework; a score of
 *  HOMEWORK_THRESHOLD or more is treated as homework. */
export const HOMEWORK_SIGNALS: [RegExp, number][] = [
  [/\bhomework\b/i, 2], [/\bassignment\b/i, 2], [/\bessay\b/i, 2],
  [/\bquiz\b/i, 2], [/\btest answers\b/i, 3], [/\bmath problem\b/i, 2],
  [/write my\b/i, 3], [/do my (homework|assignment|essay|quiz)\b/i, 3],
  [/solve (this|these|the|for me)\b/i, 2], [/answer (this|these|the) (question|problem)/i, 2],
  [/summarize (this|the) (article|chapter|book|passage|reading)\b/i, 2],
  [/complete (this|the|my) (worksheet|assignment|homework)\b/i, 3],
  // "write an essay on …", "draft a poem about …", "give me a book report"
  [/\b(write|draft|compose|give me|make me)\b[^.?!\n]{0,40}\b(essays?|poems?|short stor(y|ies)|book reports?|research papers?|thesis|speech|lab reports?|paragraphs?)\b/i, 3],
  // "math homework", "english essay", "history test"
  [/\b(math|algebra|geometry|calculus|english|history|science|chemistry|biology|physics|spanish|french|economics) (homework|class|assignment|worksheet|test|quiz|essay|project|exam)\b/i, 2],
  [/\bsolve for [a-z]\b/i, 4],
  [/\b(derivative|integral|antiderivative) of\b/i, 4],
  // "solve 3x + 5 = 20", "solve x^2 - 4 = 0"
  [/\bsolve\b[^.?!\n]{0,40}\b\d*[a-z](\s*\^\s*\d+)?\s*[+\-*/]\s*\d+\s*=/i, 4],
];
export const HOMEWORK_THRESHOLD = 4;

/** Words that tie a message to the robot or the team: those always reach
 *  Bruno (a portfolio essay, gear-ratio math, an outreach write-up). */
const FTC_CONTEXT = /\b(ftc|first tech|robot\w*|drive ?train|intake|outtake|servos?|motors?|gear(s|ing|box|boxes)?|odometry|encoders?|autonomous|auto|tele-?op|op ?modes?|control hub|expansion hub|gobilda|rev robotics|notebook|portfolio|outreach|judg(e|es|ing)|inspire|awards?|scrimmages?|alliances?|opr|biobuzz|onshape|cad|chassis|slides?|sponsors?|fundrais\w*|control point|bruno)\b/i;

export function homeworkScore(text: string): number {
  let score = 0;
  for (const [re, pts] of HOMEWORK_SIGNALS) if (re.test(text)) score += pts;
  return score;
}

/** Plain schoolwork with nothing about FTC or the team in it. */
export function isOffTopicSchoolwork(text: string): boolean {
  const t = String(text || "");
  return homeworkScore(t) >= HOMEWORK_THRESHOLD && !FTC_CONTEXT.test(t);
}

/** What Bruno says instead (shown and saved like any reply). */
export const OFF_TOPIC_REPLY =
  "I'm your FTC mentor, so I stick to robotics and your team's work. I can't write essays or do homework for school.\n\n" +
  "If this is for the team (an engineering notebook entry, a portfolio page, an outreach write-up), tell me and I'm in. Otherwise, ask me about your robot, your code, match strategy or the season.";
