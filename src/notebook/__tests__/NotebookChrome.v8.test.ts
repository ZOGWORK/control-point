import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// v8: the notebook's chrome (explorer, pages list, ribbon, split view, history,
// trash) takes its colours from the app tokens. Volt yellow is retired and the
// accent is the app's (so a workspace's own colour keeps working); the paper
// keeps its own colours and accent (paperAccentContrast.test.ts).
const dir = join(process.cwd(), 'src/notebook');
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
const CHROME = ['notebook.css', 'notebook-desktop.css', 'ribbon/ribbon.css', 'split.css', 'history.css', 'trash.css', 'canvas.css', 'attachments.css'];
const VOLT = /#ffc700|#ffd84d|#fed305|#e0b000|#eab308|#ca8a04|#a16207|#854d0e|255 199 0|255,\s*199,\s*0/i;
const TEAL = /#22b6ce|#35bdd4|#22a9bd|#17252c|#20262b|#87d4be/i;

describe('notebook chrome in the v8 look', () => {
  it.each(CHROME)('%s hard-codes no volt yellow', file => {
    expect(read(file)).not.toMatch(VOLT);
  });

  it.each(['split.css', 'history.css', 'trash.css', 'notebook-desktop.css', 'attachments.css'])('%s has no teal chrome', file => {
    expect(read(file)).not.toMatch(TEAL);
  });

  it('lets the app accent through the desktop shell (a team colour still applies)', () => {
    const shell = read('notebook-desktop.css').match(/\.nb-shell\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(shell).not.toMatch(/--color-accent\s*:/);
  });

  it('keeps the paper accent the paper has always had', () => {
    const paper = read('notebook-desktop.css').match(/\.nb-document\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(paper).toMatch(/--color-accent:\s*#8a6100/i);
  });

  it('marks the selected row and tab with the accent, and fills nothing with it', () => {
    const base = read('notebook.css'), ribbon = read('ribbon/ribbon.css');
    expect(base).toMatch(/\.nb-tree-row\.is-selected::before\{[^}]*background:var\(--color-accent\)/);
    expect(ribbon).toMatch(/\.nb-command-tabs button\[aria-selected=true\]::after \{[^}]*background: var\(--color-accent\)/);
    // The default "New page" is neutral; only a workspace that picked a colour fills it (as the kit's Button does).
    const primary = ribbon.match(/^\.nb-bar-primary \{([^}]*)\}/m)?.[1] ?? '';
    expect(primary).not.toMatch(/accent/);
  });
});
