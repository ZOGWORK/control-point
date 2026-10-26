// Parts that came from Control Kit: where a row came from, a row the latest
// scan of its assembly no longer has, and the import a ?import= link opens
// (Control Kit's "View in Control Point" after a send).
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, FileCheck2, FileX2, X } from 'lucide-react';
import { Badge, Button } from '../../../components/ui-kit';
import { apiFetch } from '../../../services/api';
import { CONTROL_KIT_ICON } from '../../../utils/controlKit';

export type CadImport = {
  importId: number; sentAt: string; sentBy: string | null; created: number; updated: number; markedRemoved: number; filesStored: number;
  assemblyName: string | null; assemblyUrl: string | null; revision: string | null; partCount: number;
  files: { name: string; stored: boolean; url?: string; note?: string }[];
};

const when = (iso: string | null | undefined) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
};

/** The import named by ?import=, loaded once; `close` drops the parameter. */
export function useControlKitImport() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('import');
  const id = raw && /^\d{1,12}$/.test(raw) ? Number(raw) : null;
  const [data, setData] = useState<CadImport | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setData(null); setMissing(false);
    if (!id) return;
    let live = true;
    apiFetch(`/api/cad/imports/${id}`)
      .then(async (res) => { if (!live) return; if (res.ok) setData(await res.json()); else setMissing(true); })
      .catch(() => { if (live) setMissing(true); });
    return () => { live = false; };
  }, [id]);
  const close = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('import'); return n; }, { replace: true });
  return { id, data, missing, close };
}

/** "From Control Kit" on an imported row, and "Not in latest scan" when its assembly's latest scan dropped it. */
export function ControlKitOrigin({ part }: { part: any }) {
  if (!part?.ck_part_key) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className="gap-1 font-normal text-muted-foreground" title="Sent from Control Kit. A new scan of the same assembly updates this row; your status and assignee stay.">
        <img src={CONTROL_KIT_ICON} alt="" aria-hidden className="size-3.5 rounded-[3px]" /> From Control Kit
      </Badge>
      {part.ck_removed_at && (
        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/15 font-normal text-amber-700 dark:text-amber-300" title={`The scan sent ${when(part.ck_removed_at)} doesn't have this part. It stays until you delete it.`}>
          Not in latest scan
        </Badge>
      )}
    </span>
  );
}

/** What the linked import brought in, above the parts list. Its rows are highlighted below. */
export function ControlKitImportBanner({ imp }: { imp: ReturnType<typeof useControlKitImport> }) {
  if (!imp.id) return null;
  if (imp.missing) {
    return (
      <div role="status" className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        That Control Kit import isn’t in this workspace. It may have been sent to another one.
        <Button variant="ghost" size="icon-sm" onClick={imp.close} aria-label="Dismiss"><X /></Button>
      </div>
    );
  }
  const d = imp.data;
  if (!d) return null;
  const counts = [`${d.created} new`, `${d.updated} updated`, ...(d.markedRemoved ? [`${d.markedRemoved} not in this scan`] : [])].join(' · ');
  return (
    <section aria-label="Control Kit import" className="mb-6 rounded-xl border border-accent/40 bg-accent/5 p-4">
      <div className="flex items-start gap-3">
        <img src={CONTROL_KIT_ICON} alt="" aria-hidden className="size-9 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {d.assemblyName || 'Assembly'} from Control Kit
            {d.assemblyUrl && <a href={d.assemblyUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-sm font-normal text-accent hover:underline">Onshape <ExternalLink className="size-3.5" /><span className="sr-only"> (opens in a new tab)</span></a>}
          </p>
          <p className="text-sm text-muted-foreground">Sent {when(d.sentAt)}{d.sentBy ? ` by ${d.sentBy}` : ''} · {d.partCount} part{d.partCount === 1 ? '' : 's'} · {counts}. Its rows are highlighted below.</p>
          {d.files.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {d.files.map((f, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  {f.stored && f.url
                    ? <><FileCheck2 className="size-4 text-success" /><a href={f.url} className="hover:underline">{f.name}</a></>
                    : <><FileX2 className="size-4 text-muted-foreground" /><span className="text-muted-foreground">{f.name}{f.note ? ` · ${f.note}` : ''}</span></>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={imp.close} aria-label="Close the import summary"><X /></Button>
      </div>
    </section>
  );
}
