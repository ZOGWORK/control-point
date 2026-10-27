/**
 * CAD by season and robot, and the BOM a robot carries.
 *
 * A season is named by the FTC season's starting year (2025 = 2025–26 DECODE)
 * and turns over in September. Imported parts carry Control Kit's whole line in
 * `ck_extra` (contract: control-kit docs/control-point-link.md v1.1); people
 * can choose a part's type and product here, and the newer of their choice and
 * Control Kit's own wins (§5). Shared by the server and the app.
 */

/** FTC game names by season start year. */
export const FTC_GAMES: Record<number, string> = {
  2019: 'SKYSTONE', 2020: 'ULTIMATE GOAL', 2021: 'FREIGHT FRENZY', 2022: 'POWERPLAY',
  2023: 'CENTERSTAGE', 2024: 'INTO THE DEEP', 2025: 'DECODE', 2026: 'BIOBUZZ',
};
export const MIN_SEASON = 2000;

/** The FTC season a date falls in: September starts the next one. */
export function currentSeason(now = new Date()): number {
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}
export function isSeason(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_SEASON && v <= currentSeason() + 1;
}
/** "2025–26" */
export function seasonYears(season: number): string {
  return `${season}–${String((season + 1) % 100).padStart(2, '0')}`;
}
/** "2025–26 DECODE", or the years alone for a season without a known game. */
export function seasonName(season: number): string {
  const game = FTC_GAMES[season];
  return game ? `${seasonYears(season)} ${game}` : seasonYears(season);
}

/** Control Kit's part types (its `Disposition`). */
export const CAD_TYPES = ['buy', 'print', 'cnc', 'cut-2d', 'fabricate', 'hardware', 'ignore', 'review'] as const;
export type CadType = (typeof CAD_TYPES)[number];
/** The types a person can choose (review is what Control Kit says when nobody has). */
export const CHOOSABLE_TYPES = ['buy', 'print', 'cnc', 'cut-2d', 'fabricate', 'hardware', 'ignore'] as const satisfies readonly CadType[];
export const CAD_TYPE_LABELS: Record<CadType, string> = {
  buy: 'Buy', print: '3D print', cnc: 'CNC', 'cut-2d': '2D cut', fabricate: 'Fabricate', hardware: 'Fastener', ignore: 'Not needed', review: 'Needs review',
};
export const isCadType = (v: unknown): v is CadType => typeof v === 'string' && (CAD_TYPES as readonly string[]).includes(v);
export const isChoosableType = (v: unknown): v is CadType => typeof v === 'string' && (CHOOSABLE_TYPES as readonly string[]).includes(v);

/** The BOM's groups, in page order. Colours follow Control Kit's jobs: buy sky, make gold, attention orange, done green. */
export const BOM_GROUPS = ['review', 'buy', 'make', 'hardware', 'ignore'] as const;
export type BomGroup = (typeof BOM_GROUPS)[number];
export const BOM_GROUP_LABELS: Record<BomGroup, string> = { review: 'Needs a decision', buy: 'Buy', make: 'Make', hardware: 'Fasteners', ignore: 'Not needed' };
export function groupOf(type: CadType): BomGroup {
  if (type === 'buy') return 'buy';
  if (type === 'hardware') return 'hardware';
  if (type === 'ignore') return 'ignore';
  if (type === 'review') return 'review';
  return 'make';
}

export type Candidate = {
  id: string; vendor: string; sku: string; normalizedSku: string; name: string; priceUsd: number | null; unitsPerPack: number | null;
  stock: string; url: string | null; image: { url: string } | null; kind: 'match' | 'choice' | 'near';
};

const time = (v: unknown) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : 0; };
const text = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const httpUrl = (v: unknown) => { const s = text(v, 1000); return s && /^https?:\/\//i.test(s) ? s : null; };

/** A line's products to pick between: the bundle's `candidates` (v1.1), or its match alone from an older bundle. */
export function candidatesOf(extra: any): Candidate[] {
  const list: Candidate[] = [];
  const seen = new Set<string>();
  const add = (c: any, kind: Candidate['kind']) => {
    const vendor = text(c?.vendor, 40);
    const normalizedSku = text(c?.normalizedSku, 80);
    if (!vendor || !normalizedSku || !/^[a-z0-9-]+$/.test(vendor) || !/^[A-Z0-9]+$/.test(normalizedSku)) return;
    const id = `${vendor}:${normalizedSku}`;
    if (seen.has(id) || list.length >= 8) return;
    seen.add(id);
    const image = httpUrl(c?.image?.url);
    list.push({ id, vendor, sku: text(c?.sku, 80) || normalizedSku, normalizedSku, name: text(c?.name, 200) || normalizedSku,
      priceUsd: num(c?.priceUsd), unitsPerPack: num(c?.unitsPerPack), stock: text(c?.stock, 20) || 'unknown', url: httpUrl(c?.url),
      image: image ? { url: image } : null, kind: c?.kind === 'choice' || c?.kind === 'near' || c?.kind === 'match' ? c.kind : kind });
  };
  if (Array.isArray(extra?.candidates)) for (const c of extra.candidates) add(c, 'near');
  else if (extra?.vendor && extra?.matchNormalizedSku) add({ vendor: extra.vendor, normalizedSku: extra.matchNormalizedSku, sku: extra.sku, name: extra.name, priceUsd: extra.packPriceUsd, unitsPerPack: extra.unitsPerPack, stock: extra.stock, url: extra.vendorUrl }, 'match');
  return list;
}

/** A part row as the API returns it (the columns the BOM needs). */
export type CadPartRow = {
  id: number; name: string; quantity: number; unit_cost: number; source: string; status: string; section?: string; notes?: string;
  ck_part_key?: string | null; ck_extra?: any; ck_removed_at?: string | null;
  choice_type?: string | null; choice_type_set?: number | null; choice_type_by?: string | null; choice_type_at?: string | null;
  choice_product?: string | null; choice_product_by?: string | null; choice_product_at?: string | null;
};

export type EffectivePart = {
  /** The type in force: a Control Point choice newer than Control Kit's, else Control Kit's. */
  type: CadType;
  group: BomGroup;
  /** Who decided the type: a person here, a person in Control Kit, Control Kit's rules, or a hand-made row's source. */
  typeBy: 'control-point' | 'control-kit-person' | 'control-kit' | 'manual-row';
  /** A Control Point choice Control Kit hasn't picked up yet (it reaches it at the next scan). */
  typePending: boolean;
  /** The chosen or matched product, if any. */
  product: Candidate | null;
  productBy: 'control-point' | 'control-kit' | null;
  productPending: boolean;
  candidates: Candidate[];
  /** What this part costs as Control Kit priced it, or null when unpriced. */
  totalUsd: number | null;
};

/** A hand-made row has no Control Kit line: its source stands for the type. */
function manualType(source: string): CadType {
  return source === 'printed' ? 'print' : source === 'other' ? 'fabricate' : 'buy';
}

/** The newer of a Control Point choice and the Control Kit line it was made on (contract §5 "Which choice wins"). */
export function effectivePart(p: CadPartRow): EffectivePart {
  const extra = p.ck_extra && typeof p.ck_extra === 'object' ? p.ck_extra : null;
  const candidates = extra ? candidatesOf(extra) : [];
  const total = Number(p.quantity) * Number(p.unit_cost);
  if (!extra) {
    const type = manualType(p.source);
    return { type, group: groupOf(type), typeBy: 'manual-row', typePending: false, product: null, productBy: null, productPending: false, candidates, totalUsd: total > 0 ? total : null };
  }
  const kitType: CadType = isCadType(extra.disposition) ? extra.disposition : 'review';
  const kitManual = isCadType(extra.manualOverride) ? extra.manualOverride : null;
  let type = kitType;
  let typeBy: EffectivePart['typeBy'] = kitManual ? 'control-kit-person' : 'control-kit';
  let typePending = false;
  if (p.choice_type_set && time(p.choice_type_at) > time(extra.manualOverrideAt)) {
    const chosen = isCadType(p.choice_type) ? p.choice_type : null;
    if (chosen) {
      type = chosen;
      typeBy = 'control-point';
      typePending = kitManual !== chosen;
    } else {
      // "Let Control Kit decide": its own rules apply again from its next scan.
      typeBy = 'control-kit';
      typePending = kitManual !== null;
    }
  }
  const matched = extra.matchNormalizedSku && extra.vendor ? candidates.find((c) => c.id === `${extra.vendor}:${extra.matchNormalizedSku}`) ?? null : null;
  let product: Candidate | null = matched && ['exact', 'confirmed', 'possible'].includes(extra.matchStatus) ? matched : null;
  let productBy: EffectivePart['productBy'] = product ? 'control-kit' : null;
  let productPending = false;
  if (p.choice_product && time(p.choice_product_at) > time(extra.matchDecisionAt)) {
    const chosen = candidates.find((c) => c.id === p.choice_product) ?? null;
    if (chosen) {
      product = chosen;
      productBy = 'control-point';
      productPending = !(matched?.id === chosen.id && extra.matchStatus === 'confirmed') && !(matched?.id === chosen.id && extra.matchStatus === 'exact');
    }
  }
  const priced = num(extra.lineTotalUsd) !== null || total > 0;
  return { type, group: groupOf(type), typeBy, typePending, product, productBy, productPending, candidates, totalUsd: priced && total > 0 ? total : null };
}

/** An estimate for a product picked here, before Control Kit prices it: whole packs when the pack is known, else null. */
export function estimateUsd(c: Candidate, quantity: number): number | null {
  if (c.priceUsd === null || !c.unitsPerPack || c.unitsPerPack <= 0 || quantity <= 0) return null;
  return Math.ceil(quantity / c.unitsPerPack) * c.priceUsd;
}

/** The Onshape document and element of an assembly link, or null. */
export function parseOnshapeAssembly(url: unknown): { documentId: string; elementId: string; url: string } | null {
  if (typeof url !== 'string') return null;
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !/(^|\.)onshape\.com$/i.test(u.hostname)) return null;
  const m = /^\/documents\/([\w-]{1,100})\/[wvm]\/[\w-]{1,100}\/e\/([\w-]{1,100})/.exec(u.pathname);
  return m ? { documentId: m[1], elementId: m[2], url: u.toString().slice(0, 500) } : null;
}
