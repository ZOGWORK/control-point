// Swear words and slurs in what members write (messages, task comments).
// They're shown blurred: members who said they're 18 or older can tap one to
// read it, everyone else sees a mask (src/components/CensoredText.tsx).
// Each pattern matches a whole word, so "class", "assess", "cocktail",
// "Scunthorpe" and "shiitake" are left alone, and catches the usual
// disguises: repeated letters (fuuuck), symbols (f*ck, sh!t, $hit) and digits
// (sh1t, b1tch).

const PATTERNS: string[] = [
  // f-word and its compounds
  '(mother|mutha)?f+[u*v@]*c*k+(ing?|in|ed|er|ers|s|face|head|wit|tard|boy)?',
  'f+[u*]+k+(ing?|ed|er|s)?',
  'wtf', 'stfu', 'gtfo', 'fml',
  // s-word
  '(bull|horse|dip|chicken)?[s$5]+h+[i1!*]+t+(s|ty|tier|ting|head|heads|hole|show|face|load)?',
  // b-word
  'b+[i1!*]+t+c+h+(es|ed|ing|y)?',
  // a-word (alone or compounds, never inside a longer word)
  '[a@]+[s$5]{2,}(es|hole|holes|hat|hats|wipe|wipes|clown)?',
  'bastards?',
  'd[i1!*]ck(s|head|heads|wad)?',
  'c[u*]nts?',
  'c[o0*]ck(s|sucker|suckers)?',
  'puss(y|ies)',
  'wh[o0*]res?',
  'sl[u*]ts?',
  'piss(ed|ing|es)?',
  'jack(ass|asses)',
  'dumbass(es)?',
  // slurs
  'n+[i1!*]+g{2,}(a|ah|as|az|er|ers)',
  'f[a@4*]g+(s|got|gots|gy)?',
  'tranny', 'kikes?', 'chinks?', 'spics?', 'retard(s|ed)?',
];

// Whole words only: no letter or digit right before or after (punctuation,
// as in "shit!" or "**fuck**", still counts as a word edge).
const WORD_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${PATTERNS.join('|')})(?![\\p{L}\\p{N}])`, 'giu');

export type TextPart = { text: string; hidden: boolean };

/** The text split into plain runs and words to hide, in order. */
export function censorParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of String(text || '').matchAll(WORD_RE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), hidden: false });
    parts.push({ text: m[0], hidden: true });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hidden: false });
  return parts;
}

export function hasProfanity(text: string): boolean {
  return censorParts(text).some((p) => p.hidden);
}

/** Plain text with each hidden word replaced by dots (copying, for a
 *  member who hasn't said they're 18 or older). */
export function maskProfanity(text: string): string {
  return censorParts(text).map((p) => (p.hidden ? '•'.repeat(p.text.length) : p.text)).join('');
}
