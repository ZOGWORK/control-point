// The hand-made part sheet (add / edit) and the Bruno invoice import, used on
// a robot's BOM. Both save to the robot on screen (CadRobotContext); rows
// Control Kit sent are edited there only for the people's fields.
import { Check, FileUp, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { cn } from '../../../components/cn';
import {
  Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue, Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow, Textarea,
} from '../../../components/ui-kit';
import { useIsNarrow } from '../../../components/scout/ScoutUi';
import { CAD_SECTIONS, PART_SOURCE_LABELS, PART_STATUS_LABELS, useCadInvoiceImport, usePartForm } from '../../../components/cad/useCad';

export function PartSheet({ initial, onClose, onDone }: { initial: any | null; onClose: () => void; onDone: () => void }) {
  const narrow = useIsNarrow();
  const f = usePartForm(initial, onDone);
  const close = () => { if (f.busy) return; f.discard(); onClose(); };
  const sel = (id: string, label: string, value: string, onChange: (v: string) => void, options: [string, string][]) => (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="max-sm:h-11"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
  return (
    <Sheet open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent side={narrow ? 'bottom' : 'right'} className={cn('gap-0 p-0', !narrow && 'sm:max-w-lg')}>
        <SheetHeader className="border-b border-border px-6 py-5 pr-12">
          <SheetTitle>{initial ? 'Edit part' : 'Add part'}</SheetTitle>
          <SheetDescription>{initial ? initial.name : 'Printed, purchased or goBILDA — everything the robot needs.'}</SheetDescription>
        </SheetHeader>
        <form id="bom-form" className="flex-1 overflow-y-auto px-6 py-5" onSubmit={(e) => { e.preventDefault(); void f.submit(); }}>
          <fieldset disabled={f.busy} className="m-0 min-w-0 space-y-5 border-0 p-0">
            <div className="grid gap-2">
              <Label htmlFor="bom-name">Part name</Label>
              <Input id="bom-name" value={f.form.name} onChange={(e) => f.set({ name: e.target.value })} placeholder="goBILDA 96mm omni wheel" className="max-sm:h-11" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {sel('bom-section', 'Subsystem', f.form.section, (v) => f.set({ section: v }), CAD_SECTIONS.map((s) => [s, s]))}
              {sel('bom-source', 'Source', f.form.source, (v) => f.set({ source: v }), Object.entries(PART_SOURCE_LABELS))}
              <div className="grid gap-2">
                <Label htmlFor="bom-qty">Quantity</Label>
                <Input id="bom-qty" type="number" min="1" step="1" inputMode="numeric" value={f.form.quantity} onChange={(e) => f.set({ quantity: e.target.value })} className="tabular-nums max-sm:h-11" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bom-cost">Unit cost ($)</Label>
                <Input id="bom-cost" type="number" min="0" step="any" inputMode="decimal" value={f.form.unitCost} onChange={(e) => f.set({ unitCost: e.target.value })} className="tabular-nums max-sm:h-11" />
              </div>
              {sel('bom-status', 'Status', f.form.status, (v) => f.set({ status: v }), Object.entries(PART_STATUS_LABELS))}
              <div className="grid gap-2">
                <Label htmlFor="bom-assignee">Assignee</Label>
                <Input id="bom-assignee" value={f.form.assignee} onChange={(e) => f.set({ assignee: e.target.value })} placeholder="Who's responsible" className="max-sm:h-11" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bom-notes">Notes</Label>
              <Textarea id="bom-notes" rows={3} value={f.form.notes} onChange={(e) => f.set({ notes: e.target.value })} placeholder="Link, specs, print settings…" />
            </div>
          </fieldset>
        </form>
        <SheetFooter className="flex-row justify-end gap-2 border-t border-border px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button variant="outline" onClick={close} disabled={f.busy}>Cancel</Button>
          <Button type="submit" form="bom-form" disabled={f.busy}><Check /> {f.busy ? 'Saving…' : initial ? 'Save' : 'Add part'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function InvoiceDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const inv = useCadInvoiceImport(onDone);
  const close = () => { if (inv.importing) return; inv.discard(); onClose(); };
  const cell = (props: React.ComponentProps<typeof Input>) => <Input {...props} className={cn('h-9 min-w-0', props.className)} />;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-5xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-5 text-accent" /> Import an invoice with Bruno</DialogTitle>
          <DialogDescription>{inv.items.length ? `${inv.items.length} line item${inv.items.length === 1 ? '' : 's'} found — review, edit, then import.` : "Upload a vendor invoice (PDF or image). Bruno reads the line items so you don't have to type them."}</DialogDescription>
        </DialogHeader>
        {!inv.items.length ? (
          <div className="space-y-4">
            <label htmlFor="cad-invoice" className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground transition-colors hover:border-accent/50 hover:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/60">
              <FileUp className="size-6" />
              {inv.files.length ? inv.files.map((f) => f.name).join(', ') : 'Choose invoice files (PDF / PNG / JPG)'}
              <input id="cad-invoice" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple className="sr-only" onChange={(e) => inv.setFiles(Array.from(e.target.files || []))} />
            </label>
            {inv.parsing && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" />{inv.parsing}</p>}
          </div>
        ) : (
          <div className="-mx-1 min-h-0 flex-1 overflow-auto px-1">
            <fieldset disabled={inv.importing} className="m-0 min-w-0 border-0 p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"><Checkbox checked={inv.selectedCount === inv.items.length} onCheckedChange={(v) => inv.toggleAll(v === true)} aria-label="Select all" /></TableHead>
                    <TableHead>Part</TableHead><TableHead className="w-20">Qty</TableHead><TableHead className="w-24">Unit $</TableHead><TableHead className="w-36">Subsystem</TableHead><TableHead className="w-32">Source</TableHead><TableHead className="w-32">Status</TableHead><TableHead>Notes</TableHead><TableHead className="w-10"><span className="sr-only">Remove</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inv.items.map((it: any, i: number) => (
                    <TableRow key={i} className={cn(!it.selected && 'opacity-50')}>
                      <TableCell><Checkbox checked={!!it.selected} onCheckedChange={(v) => inv.updateItem(i, { selected: v === true })} aria-label={`Import ${it.name || 'row'}`} /></TableCell>
                      <TableCell className="min-w-[12rem]">{cell({ value: it.name, onChange: (e) => inv.updateItem(i, { name: e.target.value }), 'aria-label': `Name for row ${i + 1}` })}</TableCell>
                      <TableCell>{cell({ type: 'number', min: 1, step: 1, value: it.quantity, onChange: (e) => inv.updateItem(i, { quantity: e.target.value }), 'aria-label': `Quantity for row ${i + 1}` })}</TableCell>
                      <TableCell>{cell({ type: 'number', min: 0, step: 'any', value: it.unitCost, onChange: (e) => inv.updateItem(i, { unitCost: e.target.value }), 'aria-label': `Unit cost for row ${i + 1}` })}</TableCell>
                      {(['section', 'source', 'status'] as const).map((k) => (
                        <TableCell key={k}>
                          <Select value={it[k]} onValueChange={(v) => inv.updateItem(i, { [k]: v })}>
                            <SelectTrigger className="h-9" aria-label={`${k} for row ${i + 1}`}><SelectValue /></SelectTrigger>
                            <SelectContent>{(k === 'section' ? CAD_SECTIONS.map((s) => [s, s]) : Object.entries(k === 'source' ? PART_SOURCE_LABELS : PART_STATUS_LABELS)).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                      ))}
                      <TableCell className="min-w-[10rem]">{cell({ value: it.notes, onChange: (e) => inv.updateItem(i, { notes: e.target.value }), placeholder: 'SKU / link', 'aria-label': `Notes for row ${i + 1}` })}</TableCell>
                      <TableCell><Button variant="ghost" size="icon-sm" onClick={() => inv.removeItem(i)} aria-label={`Remove row ${i + 1}`}><X /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </fieldset>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={inv.importing}>Cancel</Button>
          {!inv.items.length
            ? <Button onClick={() => void inv.parse()} disabled={!inv.files.length || !!inv.parsing}><Sparkles /> Bruno</Button>
            : <Button onClick={() => void inv.importSelected()} disabled={inv.importing || !inv.selectedCount}>{inv.importing ? <><Loader2 className="animate-spin" /> Importing…</> : <><Check /> Import selected ({inv.selectedCount})</>}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
