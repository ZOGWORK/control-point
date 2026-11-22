// The task editor's description box, with images. Paste a screenshot, drop
// photos on it, or pick them: each is uploaded (POST /api/tasks/images) and
// lands in the text as ![name](/api/files/N) where the caret was. The
// pictures show right under the box (and in the task view), so nobody has to
// download anything to see them.
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { cn } from '../../../components/cn';
import { Textarea } from '../../../components/ui-kit';
import { notify } from '../../../components/dialog';
import { apiFetch } from '../../../services/api';
import { imageFilesFrom, toWebImage } from '../../../utils/mediaFiles';
import { descriptionImages, imageToken, insertAtCaret, removeDescriptionImage } from '../../../utils/taskImages';

const MAX_PER_DROP = 10;

async function uploadTaskImage(file: File): Promise<{ url: string; name: string }> {
  const form = new FormData();
  form.append('image', file);
  const res = await apiFetch('/api/tasks/images', { method: 'POST', body: form });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || typeof d?.url !== 'string') throw new Error(d?.error || "Couldn't add that image.");
  return { url: d.url, name: String(d.name || file.name || 'image') };
}

export function TaskDescriptionField({ id, value, onChange, onPendingChange }: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  /** How many images are still uploading (the form waits for them). */
  onPendingChange?: (n: number) => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  // The description right now: what the form last rendered, or what this box
  // just wrote if the form hasn't re-rendered yet (two uploads can finish
  // back to back, and the second must not overwrite the first).
  const current = useRef(value);
  current.current = value;
  const write = (next: string) => { current.current = next; onChange(next); };
  const [pending, setPending] = useState(0);
  const pendingRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  // Unmounting (the editor closed) drops uploads that finish later, so one
  // never lands in the next task opened.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onPendingChange?.(0); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const changePending = (by: number) => {
    pendingRef.current += by;
    setPending(pendingRef.current);
    onPendingChange?.(pendingRef.current);
  };

  const addImages = async (incoming: File[]) => {
    const files = incoming.filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    if (files.length > MAX_PER_DROP) notify(`Up to ${MAX_PER_DROP} images at a time.`, 'error');
    const take = files.slice(0, MAX_PER_DROP);
    changePending(take.length);
    for (const file of take) {
      try {
        const ready = await toWebImage(file);
        if (!ready) throw new Error("That image is in a format browsers can't show (like HEIC). Save it as JPEG or PNG, or paste a screenshot.");
        const up = await uploadTaskImage(ready);
        if (!alive.current) return;
        const text = current.current;
        const el = box.current;
        // At the caret while typing in the box; otherwise at the end.
        const focused = el && document.activeElement === el;
        const start = focused ? el.selectionStart : text.length;
        const end = focused ? el.selectionEnd : text.length;
        const next = insertAtCaret(text, start, end, imageToken(up.name, up.url));
        write(next.text);
        if (focused) requestAnimationFrame(() => { if (box.current === el) el.setSelectionRange(next.caret, next.caret); });
      } catch (e: any) {
        if (alive.current) notify(e?.message || "Couldn't add that image.", 'error');
      } finally {
        if (alive.current) changePending(-1);
      }
    }
  };

  const images = descriptionImages(value);
  return (
    <div
      className="grid gap-2"
      onDragOver={(e) => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => {
        const imgs = imageFilesFrom(e.dataTransfer);
        setDragging(false);
        if (imgs.length) { e.preventDefault(); void addImages(imgs); }
      }}
    >
      <Textarea
        id={id}
        ref={box}
        value={value}
        onChange={(e) => write(e.target.value)}
        onPaste={(e) => {
          const imgs = imageFilesFrom(e.clipboardData);
          if (imgs.length) { e.preventDefault(); void addImages(imgs); }
        }}
        placeholder="Details, links, acceptance criteria…"
        className={cn('min-h-28', dragging && 'ring-2 ring-accent')}
      />
      {(images.length > 0 || pending > 0) && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Images in the description">
          {images.map((img, i) => (
            <li key={`${img.url}-${i}`} className="relative overflow-hidden rounded-lg border border-border">
              <a href={img.url} target="_blank" rel="noreferrer" aria-label={`Open ${img.alt || `image ${i + 1}`} full size`}>
                <img src={img.url} alt={img.alt || `Image ${i + 1}`} className="aspect-[4/3] w-full bg-muted object-contain" />
              </a>
              <button
                type="button"
                aria-label={`Remove ${img.alt || `image ${i + 1}`}`}
                onClick={() => write(removeDescriptionImage(current.current, img.url))}
                className="absolute right-1 top-1 rounded-full bg-background/90 p-0.5 shadow-sm hover:bg-background"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
          {Array.from({ length: pending }, (_, i) => (
            <li key={`pending-${i}`} role="status" aria-label="Uploading image" className="flex aspect-[4/3] items-center justify-center rounded-lg border border-border bg-muted">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Paste, drop or add images; they show right in the task.</p>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
          <ImagePlus className="size-3.5" aria-hidden /> Add image
          <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void addImages(Array.from(e.target.files || [])); e.target.value = ''; }} />
        </label>
      </div>
    </div>
  );
}
