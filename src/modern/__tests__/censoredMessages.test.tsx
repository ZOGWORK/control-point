// Swear words in team messages and task comments are blurred. A member who
// said they're 18 or older can tap one to read it; everyone else gets a mask,
// and the word itself never reaches the page.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui-kit';

vi.mock('../../services/api', async (orig) => ({ ...(await orig<object>()), apiFetch: vi.fn(async () => ({ ok: false, json: async () => ({}) })) }));

import { MessageRow } from '../pages/messages/MessageRow';
import { AdultContext, CensoredText } from '../../components/CensoredText';

afterEach(cleanup);
const noop = () => {};

function row(content: string, adult: boolean, extra: any = {}) {
  render(
    <AdultContext.Provider value={adult}>
      <TooltipProvider>
        <MessageRow
          msg={{ id: 5, sender_id: 2, sender_name: 'Ada', content, timestamp: new Date().toISOString(), ...extra }} sender={null} grouped={false} mine={false} canDelete={false} flash={false} active pickerOpen={false}
          currentUserId={1} memberNames={{}} onRef={noop} onActivate={noop} onReply={noop} onForward={noop} onCopy={noop}
          onDelete={noop} onOpenPicker={noop} onClosePicker={noop} onPick={noop} onReactionsChange={noop} onJumpTo={noop}
        />
      </TooltipProvider>
    </AdultContext.Provider>,
  );
}

describe('swear words in messages', () => {
  it('under 18 (or not confirmed): masked, and the word is not on the page', () => {
    row('the intake is shit today', false);
    expect(screen.getByRole('img', { name: 'Hidden word' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/shit/);
    expect(document.body.textContent).toMatch(/the intake is .+ today/);
  });

  it('18 or older: blurred until tapped', () => {
    row('the intake is shit today', true);
    const word = screen.getByRole('button', { name: 'Hidden word, tap to show' });
    expect(word.className).toMatch(/blur/);
    fireEvent.click(word);
    expect(screen.queryByRole('button', { name: 'Hidden word, tap to show' })).not.toBeInTheDocument();
    expect(document.body.textContent).toMatch(/the intake is shit today/);
  });

  it('mentions and links still work around a hidden word', () => {
    row('@[Ada] fuck, see https://example.com', false);
    expect(screen.getByText('@Ada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.com' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/fuck/);
  });

  it('a reply quote is masked for everyone (it is a button: open the message to read it)', () => {
    row('ok', true, { reply_to_id: 4, reply_content: 'this bitch of a servo', reply_sender_name: 'Bo' });
    expect(document.body.textContent).not.toMatch(/bitch/);
  });

  it('clean text comes back unchanged', () => {
    render(<CensoredText text="assess the class" />);
    expect(document.body.textContent).toBe('assess the class');
  });
});
