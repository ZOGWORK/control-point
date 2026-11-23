/**
 * The accent colour on <html>: a workspace's or member's chosen colour, or the
 * stylesheet's default slate blue when there is none.
 *
 * `--color-accent` and `data-accent="team"` always change together: the
 * attribute tells the stylesheet a chosen colour is in effect (primary
 * buttons fill with it, Light darkens it for small text; index.css and the
 * `team-accent:` variant). Setting one without the other leaves buttons in the
 * wrong state, so every writer goes through here.
 */
export function applyAccent(hex: string | null | undefined, root: HTMLElement = document.documentElement): void {
  if (hex) {
    root.style.setProperty('--color-accent', hex);
    root.dataset.accent = 'team';
  } else {
    root.style.removeProperty('--color-accent');
    delete root.dataset.accent;
  }
}

/**
 * Settings › Profile previews an unsaved colour across the app. While a preview
 * is active, App's colour effect (which re-runs on theme toggles, team loads,
 * user changes…) must not paint the saved colour over it: it calls
 * applySavedAccent, which yields to the preview. Explicit state, so listener
 * order never matters.
 */
let preview: { hex: string | null } | null = null;

/** Start (active) or end the preview. The previewed colour may be null (the default). */
export function setAccentPreview(active: boolean, hex?: string | null): void {
  preview = active ? { hex: hex ?? null } : null;
}

/** Apply the saved colour, unless a preview is active (then keep the preview). */
export function applySavedAccent(hex: string | null | undefined, root: HTMLElement = document.documentElement): void {
  applyAccent(preview ? preview.hex : hex, root);
}
