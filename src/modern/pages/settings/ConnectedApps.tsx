// Settings → Account → Connected apps: Control Kit while it is linked to this
// account, with Disconnect (revokes every Control Kit link of the account,
// on every device). Control Kit asks to link again the next time it is used.
import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, RotateCw, Unplug } from 'lucide-react';
import { Button } from '../../../components/ui-kit';
import { apiFetch } from '../../../services/api';
import { confirmDialog, notify } from '../../../components/dialog';
import { CONTROL_KIT_ICON, CONTROL_KIT_URL } from '../../../utils/controlKit';
import { SettingsGroup } from './SettingsPage';

type App = { id: string; name: string; linkedAt: string; lastUsedAt: string | null };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export function ConnectedApps() {
  const [apps, setApps] = useState<App[] | null>(null);
  // A failed load is not "no apps": that would hide a live link and its Disconnect.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    apiFetch('/api/integrations/connected-apps')
      .then(async (res) => {
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (!live) return;
        if (Array.isArray(data)) setApps(data);
        else setFailed(true);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [attempt]);

  const disconnect = async () => {
    if (!(await confirmDialog({ title: 'Disconnect Control Kit?', message: 'Control Kit can no longer see your workspaces or send BOMs to them. Parts it already sent stay in your parts lists.', confirmLabel: 'Disconnect' }))) return;
    setBusy(true);
    try {
      const res = await apiFetch('/api/integrations/control-kit/disconnect', { method: 'POST' });
      if (!res.ok) { notify('Could not disconnect Control Kit.', 'error'); return; }
      setApps((a) => (a || []).filter((x) => x.id !== 'control-kit'));
      notify('Control Kit disconnected.', 'success');
    } catch {
      notify('Could not disconnect Control Kit.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const kit = apps?.find((a) => a.id === 'control-kit');
  return (
    <SettingsGroup title="Connected apps" description="Apps you let use your Control Point account.">
      {failed ? (
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <p className="text-sm text-muted-foreground">Couldn’t load your connected apps.</p>
          <Button variant="outline" className="shrink-0 max-sm:h-11" onClick={() => setAttempt((n) => n + 1)}><RotateCw /> Retry</Button>
        </div>
      ) : !apps ? (
        <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</p>
      ) : kit ? (
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <img src={CONTROL_KIT_ICON} alt="" aria-hidden className="size-10 shrink-0 rounded-lg" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Control Kit</p>
              <p className="text-sm text-muted-foreground">Linked {day(kit.linkedAt)}{kit.lastUsedAt ? ` · last used ${day(kit.lastUsedAt)}` : ''}. Sends BOMs from Onshape to your workspaces’ parts lists.</p>
            </div>
          </div>
          <Button variant="outline" className="shrink-0 max-sm:h-11" disabled={busy} onClick={() => void disconnect()}>{busy ? <Loader2 className="animate-spin" /> : <Unplug />} Disconnect</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">No apps are connected. Control Kit links from its Control Point card, inside Onshape.</p>
          <Button asChild variant="outline" className="shrink-0 max-sm:h-11">
            <a href={CONTROL_KIT_URL} target="_blank" rel="noopener noreferrer"><ExternalLink /> Control Kit<span className="sr-only"> (opens in a new tab)</span></a>
          </Button>
        </div>
      )}
    </SettingsGroup>
  );
}
