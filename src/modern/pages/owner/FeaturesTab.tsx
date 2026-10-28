// Owner console → Features: turn a feature off for every team (global
// switch, confirmed) or for one team (Inherit / On / Off, applied at once).
// The server (server/features.ts) is the registry and enforces the result;
// a team override wins over the global switch. Recent flips are listed
// underneath. Not the Flags tab: that one is AI misuse reports.
import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ChevronRight, History, Search, ToggleRight } from 'lucide-react';
import { cn } from '../../../components/cn';
import { Badge, Input, Label, Skeleton, Switch, ToggleGroup, ToggleGroupItem } from '../../../components/ui-kit';
import { apiFetch } from '../../../services/api';
import { confirmDialog, notify } from '../../../components/dialog';
import { EmptyState, Section } from '../../ui/page';

interface Override { team_id: number; enabled: boolean }
interface FeatureRow { key: string; label: string; description: string; enabled: boolean; overrides: Override[] }
interface Team { id: number; name: string; number: string | null }
interface AuditRow { id: number; key: string; scope: string; team_id: number | null; team_name: string | null; enabled: boolean; changed_by_name: string | null; changed_by_email: string | null; created_at: string | null }
type Choice = 'inherit' | 'on' | 'off';

const utc = (v: string | null) => (v ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v.replace(' ', 'T') + 'Z') : null);
const when = (v: string | null) => { const d = utc(v); return d && !Number.isNaN(d.getTime()) ? format(d, 'MMM d, h:mm a') : ''; };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "On for all teams" / "Off for 2 teams" / "Off for all teams" / "Off for all but 1 team". */
export function featureSummary(f: Pick<FeatureRow, 'enabled' | 'overrides'>, teamCount: number): string {
  const off = f.enabled
    ? f.overrides.filter((o) => !o.enabled).length
    : teamCount - f.overrides.filter((o) => o.enabled).length;
  if (off <= 0) return 'On for all teams';
  if (off >= teamCount) return 'Off for all teams';
  return f.enabled ? `Off for ${plural(off, 'team')}` : `Off for all but ${plural(teamCount - off, 'team')}`;
}

export function FeaturesTab({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<{ features: FeatureRow[]; teams: Team[] } | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const [f, a] = await Promise.all([apiFetch('/api/owner/features'), apiFetch('/api/owner/feature-audit?limit=50')]);
      if (!f.ok) throw new Error(String(f.status));
      setData(await f.json());
      setFailed(false);
      if (a.ok) setAudit(await a.json());
    } catch {
      setFailed(true);
    }
  };
  useEffect(() => { void load(); }, [refreshKey]);

  const patch = async (url: string, enabled: boolean | null, done: string, id: string) => {
    if (busy) return;
    setBusy(id);
    try {
      const r = await apiFetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { notify(j.error || 'Could not change the feature', 'error'); return; }
      notify(done, 'success');
      await load();
    } catch { notify('Could not change the feature', 'error'); } finally { setBusy(null); }
  };

  const setGlobal = async (f: FeatureRow, next: boolean) => {
    const name = f.label.toLowerCase();
    const ok = await confirmDialog({
      title: next ? `Turn ${name} on` : `Turn ${name} off`,
      message: `Turn ${name} ${next ? 'on' : 'off'} for all teams? Teams with an explicit override are unaffected.`,
      confirmLabel: next ? 'Turn on' : 'Turn off', danger: !next,
    });
    if (!ok) return;
    await patch(`/api/owner/features/${f.key}`, next, `${f.label} is ${next ? 'on' : 'off'} for all teams`, `global:${f.key}`);
  };

  const setTeam = (f: FeatureRow, t: Team, choice: Choice) => {
    const enabled = choice === 'inherit' ? null : choice === 'on';
    const msg = choice === 'inherit' ? `${t.name} follows the global ${f.label} switch` : `${f.label} ${choice} for ${t.name}`;
    void patch(`/api/owner/features/${f.key}/teams/${t.id}`, enabled, msg, `team:${f.key}:${t.id}`);
  };

  if (failed && !data) return <EmptyState icon={ToggleRight} title="Couldn't load features" description="Try again in a moment." />;
  if (!data) return <Skeleton className="h-40" />;
  const label = (key: string) => data.features.find((f) => f.key === key)?.label || key;

  return (
    <>
      <Section title="Features" description="Turn a feature off for every team, or for one team. A team's own setting wins over the global switch. Turning a feature off hides it and refuses it; nothing is deleted.">
        <div className="grid gap-3">
          {data.features.map((f) => (
            <FeatureCard
              key={f.key} feature={f} teams={data.teams} open={open === f.key} busy={busy}
              onToggleOpen={() => setOpen((o) => (o === f.key ? null : f.key))}
              onGlobal={(next) => void setGlobal(f, next)}
              onTeam={(t, c) => setTeam(f, t, c)}
            />
          ))}
        </div>
      </Section>
      <Section title="Recent changes" description="The latest 50 flips, newest first.">
        {audit.length === 0 ? <EmptyState icon={History} title="No changes yet" description="Every flip of a switch shows up here." /> : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <span className="min-w-0 break-words">
                  <span className="font-medium">{label(a.key)}</span>{' '}
                  {a.scope === 'global' ? <>{a.enabled ? 'on' : 'off'} for all teams</>
                    : a.scope === 'inherit' ? <>back to the global switch for {a.team_name || 'a deleted workspace'} (now {a.enabled ? 'on' : 'off'})</>
                      : <>{a.enabled ? 'on' : 'off'} for {a.team_name || 'a deleted workspace'}</>}
                </span>
                <span className="text-xs text-muted-foreground">{a.changed_by_name || a.changed_by_email || 'Unknown'} · {when(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function FeatureCard({ feature: f, teams, open, busy, onToggleOpen, onGlobal, onTeam }: {
  feature: FeatureRow; teams: Team[]; open: boolean; busy: string | null;
  onToggleOpen: () => void; onGlobal: (next: boolean) => void; onTeam: (t: Team, c: Choice) => void;
}) {
  const [q, setQ] = useState('');
  const byTeam = useMemo(() => new Map(f.overrides.map((o) => [o.team_id, o.enabled])), [f.overrides]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? teams.filter((t) => t.name.toLowerCase().includes(s) || (t.number || '').toLowerCase().includes(s)) : teams;
  }, [teams, q]);
  const switchId = `feature-${f.key}`;
  const panelId = `feature-${f.key}-teams`;
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <div className="min-w-0 flex-1 basis-60">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={switchId} className="text-sm font-semibold">{f.label}</Label>
            <Badge variant={f.enabled ? 'success' : 'destructive'}>{f.enabled ? 'On' : 'Off'} globally</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
          <p className="mt-1 text-xs text-muted-foreground">{featureSummary(f, teams.length)}{f.overrides.length > 0 && ` · ${plural(f.overrides.length, 'team override')}`}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-7 text-right text-sm font-medium" aria-hidden="true">{f.enabled ? 'On' : 'Off'}</span>
          <Switch id={switchId} checked={f.enabled} disabled={busy !== null} aria-label={`${f.label} for all teams`} onCheckedChange={onGlobal} />
        </div>
      </div>
      <button
        type="button" onClick={onToggleOpen} aria-expanded={open} aria-controls={panelId}
        className="flex min-h-11 w-full items-center gap-2 border-t border-border px-4 text-left text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
        Per-team settings
      </button>
      {open && (
        <div id={panelId} className="border-t border-border p-4">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search workspaces" aria-label="Search workspaces" className="h-11 pl-9" />
          </div>
          {shown.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No workspaces match.</p> : (
            <ul className="divide-y divide-border">
              {shown.map((t) => {
                const o = byTeam.get(t.id);
                const choice: Choice = o === undefined ? 'inherit' : o ? 'on' : 'off';
                const effective = o ?? f.enabled;
                return (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5">
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="truncate text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.number ? `#${t.number} · ` : ''}id {t.id}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ToggleGroup
                        type="single" value={choice} aria-label={`${f.label} for ${t.name}`} disabled={busy !== null}
                        onValueChange={(v) => { if (v && v !== choice) onTeam(t, v as Choice); }}
                      >
                        <ToggleGroupItem value="inherit" className="min-h-11 sm:min-h-9">Inherit global</ToggleGroupItem>
                        <ToggleGroupItem value="on" className="min-h-11 sm:min-h-9">On</ToggleGroupItem>
                        <ToggleGroupItem value="off" className="min-h-11 sm:min-h-9">Off</ToggleGroupItem>
                      </ToggleGroup>
                      <Badge variant={effective ? 'success' : 'destructive'} className="w-24 justify-center">Effective: {effective ? 'On' : 'Off'}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
