// Images in a task's description. The editor uploads a pasted, dropped or
// picked image (POST /api/tasks/images) and writes ![name](/api/files/N)
// into the description; the task view shows those as pictures. Only this
// app's own file URLs count: an image link to anywhere else stays text, so a
// description can't make every teammate's browser load an outside image.

/** ![alt](/api/files/N): one image token. */
const TOKEN = /!\[([^\]\n]*)\]\((\/api\/files\/\d+)\)/g;

export type DescriptionPart =
  | { kind: 'text'; text: string }
  | { kind: 'image'; alt: string; url: string };

/** The description as text runs and images, in order. */
export function splitDescription(text: string | null | undefined): DescriptionPart[] {
  const s = String(text || '');
  const parts: DescriptionPart[] = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ kind: 'text', text: s.slice(last, at) });
    parts.push({ kind: 'image', alt: m[1], url: m[2] });
    last = at + m[0].length;
  }
  if (last < s.length) parts.push({ kind: 'text', text: s.slice(last) });
  return parts;
}

/** The images in a description, in order. */
export function descriptionImages(text: string | null | undefined): { alt: string; url: string }[] {
  return splitDescription(text).flatMap((p) => (p.kind === 'image' ? [{ alt: p.alt, url: p.url }] : []));
}

/** The description without its image tokens (for one-line previews). */
export function stripDescriptionImages(text: string | null | undefined): string {
  return String(text || '').replace(TOKEN, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** The token for an uploaded image. Brackets in the name would end the alt early. */
export function imageToken(name: string, url: string): string {
  const alt = String(name || 'image').replace(/[[\]\n\r]/g, ' ').replace(/\.[a-z0-9]{2,5}$/i, '').trim().slice(0, 80) || 'image';
  return `![${alt}](${url})`;
}

/** Remove one image (by URL) from a description, with the line it sat on if it was alone there. */
export function removeDescriptionImage(text: string, url: string): string {
  const esc = url.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const token = `!\\[[^\\]\\n]*\\]\\(${esc}\\)`;
  const ownLine = new RegExp(`(^|\\n)${token}(\\n|$)`);
  if (ownLine.test(text)) return text.replace(ownLine, '$1');
  return text.replace(new RegExp(token), '');
}

/** Put `token` at the caret (start..end), on a line of its own. */
export function insertAtCaret(text: string, start: number, end: number, token: string): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !before.endsWith('\n') ? '\n' : '';
  const trail = after.startsWith('\n') ? '' : '\n';
  const next = `${before}${lead}${token}${trail}${after}`;
  return { text: next, caret: before.length + lead.length + token.length + trail.length };
}
