// v8 type: dialog and sheet titles are set in Inter (font-sans, semibold, tight tracking) like the rest of the v8
// headings, not in Space Grotesk (font-display), which the old volt-era kit used.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Dialog, DialogContent, DialogDescription, DialogTitle, Sheet, SheetContent, SheetDescription, SheetTitle } from '..';

afterEach(cleanup);

describe('kit overlay titles', () => {
  it('dialog title uses the sans face, not Space Grotesk', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>Change the details.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const title = screen.getByText('Edit task');
    expect(title.className).toContain('font-sans');
    expect(title.className).toContain('font-semibold');
    expect(title.className).not.toContain('font-display');
  });

  it('sheet title matches the dialog title', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Narrow the list.</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const title = screen.getByText('Filters');
    expect(title.className).toContain('font-sans');
    expect(title.className).not.toContain('font-display');
  });
});
