// Member text with swear words blurred (src/utils/profanity.ts). Members who
// said they're 18 or older (Settings → Account, or at signup; an honesty
// system) can tap a blurred word to read it. Everyone else gets a mask: the
// word itself never reaches the page, so it can't be copied or read aloud.
import { createContext, useContext, useState, type ReactNode } from 'react';
import { censorParts } from '../utils/profanity';

/** Whether the signed-in member said they're 18 or older. */
export const AdultContext = createContext(false);

function HiddenWord({ word, adult }: { word: string; adult: boolean }) {
  const [shown, setShown] = useState(false);
  if (!adult) {
    return (
      <span role="img" aria-label="Hidden word" title="Hidden word" className="inline-block select-none rounded bg-muted px-0.5 blur-[3px]">
        {'•'.repeat(Math.min(Math.max(word.length, 3), 8))}
      </span>
    );
  }
  if (shown) return <>{word}</>;
  return (
    <button
      type="button"
      aria-label="Hidden word, tap to show"
      title="Tap to show"
      onClick={(e) => { e.stopPropagation(); setShown(true); }}
      className="inline cursor-pointer select-none rounded bg-muted px-0.5 align-baseline blur-[3px] transition-[filter] hover:blur-[2px]"
    >
      {word}
    </button>
  );
}

/** `text` with each swear word blurred; plain text comes back as is. */
export function censorText(text: string, adult: boolean, keyPrefix = 'c'): ReactNode {
  const parts = censorParts(text);
  if (!parts.some((p) => p.hidden)) return text;
  return parts.map((p, i) => (p.hidden ? <HiddenWord key={`${keyPrefix}-${i}`} word={p.text} adult={adult} /> : p.text));
}

/** `preview`: inside a button or a one-line preview, where a word can't be
 *  tapped open: masked for everyone (open the message itself to show it). */
export function CensoredText({ text, preview }: { text: string; preview?: boolean }) {
  const adult = useContext(AdultContext);
  return <>{censorText(text, adult && !preview)}</>;
}
