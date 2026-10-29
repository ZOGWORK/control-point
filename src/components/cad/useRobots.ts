// CAD by season and robot: the seasons list, one robot's BOM, and the part
// choices people make in Control Point that Control Kit picks up at its next
// scan (contract: control-kit docs/control-point-link.md v1.1 §5).
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../services/api';
import { notify } from '../dialog';
import { cadChanged, useCadChanged } from './useCad';
import type { BomGroup, CadType, Candidate, EffectivePart } from '../../types/cadBom';

export type BomSummary = { counts: Record<BomGroup, number>; parts: number; totalUsd: number; priced: number; buyLines: number; pending: number };
export type RobotCard = {
  id: number; name: string; season: number; isMain: boolean; assemblyUrl: string | null; documentId: string | null; elementId: string | null; notes: string;
  files: number; pendingReviews: number; snapshots: number; lastImport: { id: number; sentAt: string; sentBy: string | null; assemblyName: string | null } | null; picture: string | null; bom: BomSummary;
};
export type SeasonList = { currentSeason: number; canManage: boolean; seasons: { season: number; name: string; robots: RobotCard[] }[] };
export type BomPart = {
  id: number; name: string; quantity: number; unit_cost: number; source: string; status: string; assignee: string; notes: string; section: string;
  ck_part_key: string | null; ck_import_id: number | null; ck_removed_at: string | null; ck_extra: any;
  choice_type: CadType | null; choice_type_set: number; choice_type_by: string | null; choice_type_at: string | null;
  choice_product: string | null; choice_product_by: string | null; choice_product_at: string | null;
  /** The part's Onshape picture from Control Kit (contract v1.2 §6), or null. */
  ck_picture_url?: string | null; ck_picture_at?: string | null;
  effective: EffectivePart;
};
export type RobotImport = {
  id: number; sentAt: string; sentBy: string | null; assemblyName: string | null; assemblyUrl: string | null; revision: string | null; partCount: number;
  files: { name: string; stored: boolean; url?: string; note?: string; sizeBytes?: number | null; uploadedAt?: string }[]; created: number; updated: number; markedRemoved: number;
};
/** The newest stored file of a kind across every send of a robot. */
export type RobotDownload = { importId: number; sentAt: string; file: { name: string; url: string; sizeBytes: number | null } } | null;
export type RobotDetail = {
  downloads?: { step: RobotDownload; workbook: RobotDownload };
  robot: { id: number; name: string; season: number; seasonName: string; isMain: boolean; assemblyUrl: string | null; documentId: string | null; elementId: string | null; notes: string };
  canManage: boolean; parts: BomPart[]; summary: BomSummary; imports: RobotImport[];
};

const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Latest-wins loader that also reloads when another page changes CAD rows. */
function useLoad<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const id = ++seq.current;
    try {
      const r = await apiFetch(url);
      if (id !== seq.current) return;
      if (r.ok) { setData(await r.json()); setState('ready'); }
      else setState(r.status === 404 ? 'missing' : 'error');
    } catch { if (id === seq.current) setState((s) => (s === 'ready' ? s : 'error')); }
  }, [url]);
  useEffect(() => { setState('loading'); setData(null); void load(); }, [load]);
  // Parts, files, reviews or snapshots saved elsewhere (a sheet, Bruno, another tab's hook) refresh this view.
  useCadChanged(['/api/cad/parts', '/api/cad/docs', '/api/cad/reviews', '/api/cad/snapshots', '/api/cad/robots'], () => { void load(); });
  return { data, setData, state, load };
}

export function useCadSeasons() {
  const { data, state, load } = useLoad<SeasonList>('/api/cad/robots');
  const create = async (body: { season: number; name: string; assemblyUrl?: string }) => {
    const r = await apiFetch('/api/cad/robots', json(body)).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    if (!r?.ok) { notify(d?.error || 'Could not add the robot.', 'error'); return null; }
    notify('Robot added.', 'success');
    await load();
    return Number(d.id);
  };
  return { data, state, load, create };
}

export function useRobot(id: number) {
  const { data, setData, state, load } = useLoad<RobotDetail>(Number.isInteger(id) && id > 0 ? `/api/cad/robots/${id}` : null);
  const [saving, setSaving] = useState<Set<number>>(new Set());
  const update = async (patch: Record<string, unknown>) => {
    const r = await apiFetch(`/api/cad/robots/${id}`, { ...json(patch), method: 'PATCH' }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    if (!r?.ok) { notify(d?.error || 'Could not save the robot.', 'error'); return false; }
    await load();
    return true;
  };
  /** Save a choice for one part; the row updates in place from the server's answer. */
  const choose = async (part: BomPart, choice: { type?: CadType | null; product?: string | null }) => {
    setSaving((s) => new Set(s).add(part.id));
    try {
      const r = await apiFetch(`/api/cad/parts/${part.id}/choice`, json(choice)).catch(() => null);
      const d = await r?.json().catch(() => ({}));
      if (!r?.ok) { notify(d?.error || 'Could not save that choice.', 'error'); return null; }
      setData((cur) => (cur ? { ...cur, parts: cur.parts.map((p) => (p.id === part.id ? { ...p, ...d } : p)) } : cur));
      cadChanged('/api/cad/robots');
      return d as BomPart;
    } finally {
      setSaving((s) => { const n = new Set(s); n.delete(part.id); return n; });
    }
  };
  return { data, state, load, update, choose, saving };
}

export type ChoiceHistory = { kind: 'type' | 'product'; value: string | null; by_name: string | null; at: string }[];
export async function loadChoiceHistory(partId: number): Promise<ChoiceHistory> {
  const r = await apiFetch(`/api/cad/parts/${partId}/choices`).catch(() => null);
  return r?.ok ? r.json() : [];
}

/** The candidate a product id names on this part, if any. */
export const candidateOf = (part: BomPart, id: string | null): Candidate | null => (id ? part.effective.candidates.find((c) => c.id === id) ?? null : null);
