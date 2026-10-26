// Control Kit's consent page (/connect/control-kit?state=…&redirect_uri=…)
// opened while signed out: the link is kept for the tab and reopened after
// sign-in (OAuth callbacks land on "/"). Only that one page is ever kept, so
// this can't send anyone to an arbitrary path. The server still checks the
// redirect URI against its allowlist before anything is shown.
const KEY = 'pendingControlKitConnect';
const PATH = /^\/connect\/control-kit\/?$/i;

export const isControlKitConnectPath = (pathname: string) => PATH.test(pathname);

export function rememberControlKitConnect(pathname: string, search: string) {
  if (!isControlKitConnectPath(pathname)) return;
  try { sessionStorage.setItem(KEY, `/connect/control-kit${search.startsWith('?') ? search : ''}`); } catch { /* storage optional */ }
}

export function controlKitConnectPending(): boolean {
  try { return !!sessionStorage.getItem(KEY); } catch { return false; }
}

/** The consent link to reopen after sign-in, once. */
export function takeControlKitConnect(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return v && isControlKitConnectPath(v.split('?')[0]) ? v : null;
  } catch { return null; }
}

/** Where Control Kit's popup goes next: the (already allowlisted) redirect URI with these query values. */
export function controlKitRedirect(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}
