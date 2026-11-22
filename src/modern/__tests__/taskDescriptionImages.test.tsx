// Task editor description: pasting or dropping an image uploads it and shows
// it as a picture under the box (no download needed); the task view shows it
// inline; removing it takes the token out of the text.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../services/api', async (orig) => ({ ...(await orig<object>()), apiFetch: api.apiFetch }));
const dialog = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('../../components/dialog', async (orig) => ({ ...(await orig<object>()), notify: dialog.notify }));

import { TaskDescriptionField } from '../pages/tasks/TaskDescriptionField';
import { DescriptionView } from '../pages/tasks/TaskSheets';

afterEach(cleanup);
let nextId = 40;
beforeEach(() => {
  api.apiFetch.mockReset();
  api.apiFetch.mockImplementation(async (_url: string, init: any) => {
    const file = (init.body as FormData).get('image') as File;
    return new Response(JSON.stringify({ url: `/api/files/${(nextId += 1)}`, name: file.name }), { status: 200 });
  });
  dialog.notify.mockReset();
});

function Harness({ initial = '', onPending }: { initial?: string; onPending?: (n: number) => void }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <TaskDescriptionField id="d" value={v} onChange={setV} onPendingChange={onPending} />
      <output data-testid="value">{v}</output>
    </>
  );
}

const png = (name = 'shot.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });

describe('task description images', () => {
  it('pasting a screenshot uploads it and previews it inline', async () => {
    const onPending = vi.fn();
    render(<Harness initial="Mount the hub" onPending={onPending} />);
    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => png() }], files: [], types: ['Files'] },
    });
    const img = await screen.findByRole('img', { name: 'shot' });
    expect(img.getAttribute('src')).toMatch(/^\/api\/files\/\d+$/);
    expect(screen.getByTestId('value').textContent).toMatch(/^Mount the hub\n!\[shot\]\(\/api\/files\/\d+\)\n$/);
    expect(api.apiFetch).toHaveBeenCalledWith('/api/tasks/images', expect.objectContaining({ method: 'POST' }));
    // The form was told an upload was running, then that it finished.
    expect(onPending).toHaveBeenCalledWith(1);
    await waitFor(() => expect(onPending).toHaveBeenLastCalledWith(0));
  });

  it('dropping photos adds each one', async () => {
    render(<Harness />);
    const a = png('a.png');
    const b = png('b.jpg');
    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: { items: [], files: [a, b], types: ['Files'] } });
    expect(await screen.findByRole('img', { name: 'a' })).toBeTruthy();
    expect(await screen.findByRole('img', { name: 'b' })).toBeTruthy();
  });

  it('pasting plain text is left to the browser', () => {
    render(<Harness />);
    const ev = fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { items: [], files: [], types: ['text/plain'] } });
    expect(ev).toBe(true); // not prevented
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it('a failed upload says why and adds nothing', async () => {
    api.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Images must be 10 MB or smaller.' }), { status: 413 }));
    render(<Harness initial="x" />);
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { items: [], files: [png()], types: ['Files'] } });
    await waitFor(() => expect(dialog.notify).toHaveBeenCalledWith('Images must be 10 MB or smaller.', 'error'));
    expect(screen.getByTestId('value').textContent).toBe('x');
  });

  it('removing an image takes it out of the text', () => {
    render(<Harness initial={'a\n![wiring](/api/files/7)\nb'} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove wiring' }));
    expect(screen.getByTestId('value').textContent).toBe('a\nb');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('the task view shows the images inline between the text', () => {
    render(<DescriptionView text={'Before\n![wiring](/api/files/7)\nAfter ![x](https://elsewhere.example/p.png)'} />);
    expect(screen.getByRole('img', { name: 'wiring' }).getAttribute('src')).toBe('/api/files/7');
    expect(screen.getByText('Before')).toBeTruthy();
    // An outside image link stays text.
    expect(screen.getByText(/elsewhere\.example/)).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});
