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

// Google/Discord/GitHub sign-in while linking: the consent page sits in
// Control Kit's popup, and the provider's pages (and "/", COOP same-origin)
// would cut the popup's tie to Control Kit. So that sign-in runs in a window
// of its own (?popup=1, which the server carries to "/?oauth=ok&popup=1");
// once signed in, that window says so here and closes, and the consent page
// reloads, signed in, without ever having left Control Point.
const CHANNEL = 'control-kit-connect';
export const OAUTH_WINDOW = 'cp-control-kit-signin';

/** Start provider sign-in in its own window; false when the browser blocked it (then sign in here). */
export function openOAuthWindow(href: string): boolean {
  const url = `${href}${href.includes('?') ? '&' : '?'}popup=1`;
  const w = window.open(url, OAUTH_WINDOW, 'popup,width=520,height=700');
  return !!w;
}

/** In that window, signed in: tell the consent page, drop the copied link, close. */
export function finishOAuthWindow() {
  try { const c = new BroadcastChannel(CHANNEL); c.postMessage('signed-in'); c.close(); } catch { /* the consent page also checks on focus */ }
  takeControlKitConnect();
  window.close();
}

/** On the consent page, signed out: call `onSignedIn` once a sign-in in another window lands. */
export function watchOAuthWindow(onSignedIn: () => void): () => void {
  let channel: BroadcastChannel | null = null;
  try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = (e) => { if (e.data === 'signed-in') onSignedIn(); }; } catch { /* focus check below */ }
  const onFocus = () => {
    fetch('/api/auth/me', { credentials: 'include' }).then((r) => { if (r.ok) onSignedIn(); }).catch(() => {});
  };
  window.addEventListener('focus', onFocus);
  return () => { channel?.close(); window.removeEventListener('focus', onFocus); };
}

/** Where Control Kit's popup goes next: the (already allowlisted) redirect URI with these query values. */
export function controlKitRedirect(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}
