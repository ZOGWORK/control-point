// Control Kit consent (/connect/control-kit), opened in Control Kit's popup.
// Shows who is signed in and the workspaces Control Kit will see, then Allow
// (a one-use code back to Control Kit) or Cancel (access_denied). A redirect
// URI the server doesn't allowlist gets an error and no redirect at all.
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowLeftRight, Check, Loader2, LogOut, Package, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button } from '../../../components/ui-kit';
import { BrandLogo } from '../../../components/BrandMark';
import { apiFetch } from '../../../services/api';
import { CONTROL_KIT_ICON } from '../../../utils/controlKit';
import { controlKitRedirect } from '../../../utils/controlKitConnect';
import { AuthHeading, AuthLayout } from '../auth/AuthLayout';

type Workspace = { id: number; name: string; ftcNumber: string | null; accentColor: string | null; canEditCad: boolean };
type Consent = { account: { email: string; name: string }; workspaces: Workspace[] };

const ERRORS: Record<string, { title: string; body: string }> = {
  bad_redirect_uri: { title: 'This link didn’t come from Control Kit', body: 'Control Point only sends access to Control Kit itself. Start linking again from Control Kit’s Control Point card.' },
  not_configured: { title: 'Control Kit linking isn’t switched on yet', body: 'Control Point isn’t set up to link Control Kit right now. Nothing was shared.' },
  missing: { title: 'This link is incomplete', body: 'Start linking again from Control Kit’s Control Point card.' },
};

export function ControlKitConsentPage({ onSignOut }: { onSignOut: () => void }) {
  const params = new URLSearchParams(useLocation().search);
  const state = params.get('state') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const [consent, setConsent] = useState<Consent | null>(null);
  const [error, setError] = useState<string | null>(state && redirectUri ? null : 'missing');
  const [busy, setBusy] = useState<'allow' | 'cancel' | null>(null);

  useEffect(() => { document.title = 'Link Control Kit · Control Point'; }, []);
  useEffect(() => {
    if (!state || !redirectUri) return;
    let live = true;
    apiFetch(`/api/integrations/control-kit/consent?redirect_uri=${encodeURIComponent(redirectUri)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.ok) setConsent(data);
        else setError(ERRORS[data.error] ? data.error : 'failed');
      })
      .catch(() => { if (live) setError('failed'); });
    return () => { live = false; };
  }, [state, redirectUri]);

  const allow = async () => {
    setBusy('allow');
    try {
      const res = await apiFetch('/api/integrations/control-kit/authorize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, redirect_uri: redirectUri }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.redirect) { setError(ERRORS[data.error] ? data.error : 'failed'); setBusy(null); return; }
      window.location.assign(data.redirect);
    } catch { setError('failed'); setBusy(null); }
  };
  // Only reachable once the server accepted this redirect URI.
  const cancel = () => { setBusy('cancel'); window.location.assign(controlKitRedirect(redirectUri, { error: 'access_denied', state })); };

  const marks = (
    <div className="flex items-center gap-3" aria-hidden>
      <img src={CONTROL_KIT_ICON} alt="" className="size-12 rounded-xl" />
      <ArrowLeftRight className="size-5 text-muted-foreground" />
      <BrandLogo className="size-12 rounded-xl" />
    </div>
  );

  if (error) {
    const e = ERRORS[error] || { title: 'Something went wrong', body: 'Control Point couldn’t load this page. Close this window and try linking again from Control Kit.' };
    return (
      <AuthLayout>
        <AuthHeading icon={<span className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><TriangleAlert className="size-6" /></span>} title={e.title} description={e.body} />
        <Button variant="outline" className="h-11 w-full" onClick={() => window.close()}>Close this window</Button>
      </AuthLayout>
    );
  }
  if (!consent) {
    return (
      <AuthLayout>
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" /> Checking the link…</p>
      </AuthLayout>
    );
  }
  const { account, workspaces } = consent;
  return (
    <AuthLayout>
      <AuthHeading
        icon={marks}
        title="Control Kit wants to send BOMs from Onshape to your workspaces"
        description={<>Signed in as <span className="font-medium text-foreground">{account.email}</span>.</>}
      />
      <div className="mb-5 rounded-xl border border-border bg-card">
        <p className="border-b border-border px-4 py-3 text-sm font-medium">
          {workspaces.length ? `Workspaces it will see (${workspaces.length})` : 'You’re not on a workspace yet'}
        </p>
        {workspaces.length ? (
          <ul className="max-h-56 divide-y divide-border overflow-y-auto">
            {workspaces.map((w) => (
              <li key={w.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="size-3 shrink-0 rounded-full border border-border" style={{ background: w.accentColor || 'var(--sh-muted)' }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{w.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {w.ftcNumber ? `FTC ${w.ftcNumber}` : 'No FTC number'}
                    {!w.canEditCad && ' · CAD is switched off, so it can’t take BOMs'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">You can link now. Once you create or join one, Control Kit will see it.</p>
        )}
      </div>
      <ul className="mb-6 grid gap-2 text-sm text-muted-foreground">
        <li className="flex gap-2"><Package className="mt-0.5 size-4 shrink-0 text-accent" />When you press Send in Control Kit, it adds and updates parts in the workspace’s parts list you pick. Statuses and assignees your team set stay as they are.</li>
        <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />It sees workspace names, team numbers and colours, nothing else. Disconnect any time in Settings → Account.</li>
      </ul>
      <div className="grid gap-2">
        <Button className="h-11 w-full" onClick={() => void allow()} disabled={!!busy}>{busy === 'allow' ? <Loader2 className="animate-spin" /> : <Check />} Allow</Button>
        <Button variant="outline" className="h-11 w-full" onClick={cancel} disabled={!!busy}>Cancel</Button>
        <Button variant="ghost" className="h-11 w-full text-muted-foreground" onClick={onSignOut} disabled={!!busy}><LogOut /> Not {account.name}? Sign out</Button>
      </div>
    </AuthLayout>
  );
}
