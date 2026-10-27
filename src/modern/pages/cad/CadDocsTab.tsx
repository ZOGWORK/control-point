// A robot's linked Onshape documents: link one, open it, unlink one or many.
import { ExternalLink, FileBox, Link2, MoreHorizontal, Trash2 } from 'lucide-react';
import { useRecordFocus } from '../../hooks/useRecordFocus';
import { cn } from '../../../components/cn';
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Input, Label, Skeleton,
} from '../../../components/ui-kit';
import { fmtDate, useCadDocs } from '../../../components/cad/useCad';
import { Section, EmptyState } from '../../ui/page';
import { Reveal, Stagger, StaggerItem } from '../../ui/motion';
import { BulkBar, RowCheckbox, SelectAllCheckbox, useSelection } from '../../ui/selection';

const docId = (r: any) => r.id as number;

export function CadDocsTab() {
  const d = useCadDocs();
  const sel = useSelection(d.docs, docId);
  useRecordFocus('id', d.loaded, 'That CAD document');
  return (
    <>
      <Reveal className="mb-8 rounded-2xl border border-border bg-card p-5">
        <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); void d.add(); }}>
          <fieldset disabled={d.busy} className="contents">
            <div className="grid gap-2">
              <Label htmlFor="doc-name">Document name</Label>
              <Input id="doc-name" value={d.name} onChange={(e) => d.setName(e.target.value)} placeholder="2026 Robot Assembly" className="max-sm:h-11" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="doc-url">Onshape link</Label>
              <Input id="doc-url" value={d.url} onChange={(e) => d.setUrl(e.target.value)} placeholder="https://cad.onshape.com/documents/…" className="max-sm:h-11" />
            </div>
            <Button type="submit"><Link2 /> {d.busy ? 'Linking…' : 'Link'}</Button>
          </fieldset>
        </form>
      </Reveal>
      <Section
        title={`Linked documents (${d.docs.length})`}
        description="Onshape documents for this robot, shared with the whole team."
        action={d.docs.length > 0 ? (
          <label className="flex min-h-9 items-center gap-2 rounded-md px-1 text-sm text-muted-foreground max-sm:min-h-11">
            <SelectAllCheckbox sel={sel} label="Select all linked documents" />
            <span>{sel.count ? `${sel.count} selected` : 'Select all'}</span>
          </label>
        ) : undefined}
      >
        {!d.loaded ? <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-20" />)}</div> : d.docs.length ? (
          <Stagger as="ul" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {d.docs.map((doc) => (
              <StaggerItem as="li" key={doc.id} data-record-id={doc.id} className={cn('flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent/40', sel.has(doc.id) && 'border-accent/60 ring-1 ring-accent/40')}>
                <RowCheckbox sel={sel} id={doc.id} label={`Select ${doc.name}`} />
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/15"><FileBox className="size-5 text-accent" /></span>
                <div className="min-w-0 flex-1">
                  <a href={doc.url} target="_blank" rel="noreferrer" className="block truncate font-medium underline-offset-2 hover:underline">{doc.name}</a>
                  <p className="text-xs text-muted-foreground">Linked {fmtDate(doc.created_at)}</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button data-cm-menu variant="ghost" size="icon-sm" aria-label={`Actions for ${doc.name}`} className="max-sm:size-11"><MoreHorizontal /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild><a href={doc.url} target="_blank" rel="noreferrer"><ExternalLink /> Open in Onshape</a></DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void d.remove(doc.id)} className={cn('text-destructive focus:text-destructive')}><Trash2 /> Unlink</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </StaggerItem>
            ))}
          </Stagger>
        ) : <EmptyState icon={FileBox} title="No Onshape docs linked yet" description="Paste a document link above — the whole team will see it here." />}
        <BulkBar sel={sel} noun="document" actions={[{ label: 'Unlink', icon: <Trash2 />, danger: true, run: (ids) => d.bulkRemove(ids.map(Number)) }]} />
      </Section>
    </>
  );
}
