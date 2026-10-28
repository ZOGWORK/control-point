// The owner's feature toggles for the signed-in member's team, from
// /api/features (server/features.ts resolves them). One shared copy; a
// feature counts as on until the server says it's off, and the server
// refuses what's off anyway, so a slow or failed load never hides anything.
import { useEffect, useSyncExternalStore } from 'react';
import { apiFetch } from '../services/api';

export type FeatureKey = 'messaging' | 'whats_new';

let features: Record<string, boolean> = {};
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const get = () => features;
export const getFeatures = get;

/** Re-read the team's features (sign-in, team switch, a `features_changed` push). */
export async function loadFeatures(): Promise<void> {
  const id = ++seq;
  try {
    const res = await apiFetch('/api/features');
    const body = res.ok ? await res.json() : null;
    // Latest wins: a team switch mid-load must not get the old team's answer.
    if (id !== seq || !body || typeof body !== 'object') return;
    features = body;
    emit();
  } catch { /* keep what we have */ }
}

/** Signed out: back to everything on, so the next member never sees the last one's switches. */
export function resetFeatures() {
  seq++;
  if (!Object.keys(features).length) return;
  features = {};
  emit();
}

export const featureOn = (all: Record<string, boolean>, key: FeatureKey) => all[key] !== false;

/** Live map of the team's features. */
export function useFeatures(): Record<string, boolean> {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, get, get);
}

/** One feature, live. */
export function useFeature(key: FeatureKey): boolean {
  return featureOn(useFeatures(), key);
}

/** Loads (and reloads) the features for whoever is signed in to which team. */
export function useFeatureLoader(memberId: number | null | undefined, teamId: number | null | undefined) {
  useEffect(() => {
    // A different member or team starts from "all on" until its own answer lands.
    resetFeatures();
    if (memberId != null) void loadFeatures();
  }, [memberId, teamId]);
}
