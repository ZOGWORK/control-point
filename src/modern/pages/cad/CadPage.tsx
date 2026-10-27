// CAD, organised by FTC season and robot (migration 151). /cad lists the
// seasons and their robots; /cad/robots/:id is one robot's BOM, files,
// reviews, snapshots and Control Kit sends. The old tab routes keep working:
// /cad-parts?import=N (Control Kit's "View in Control Point" before robots)
// opens that import's robot, and the other /cad-* pages open the latest main
// robot on the matching tab.
import { useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Skeleton } from '../../../components/ui-kit';
import { apiFetch } from '../../../services/api';
import { Page } from '../../ui/page';
import { CadSeasons } from './CadSeasons';
import { RobotPage } from './RobotPage';

const LEGACY_TAB: Record<string, string> = { 'cad-docs': 'files', 'cad-reviews': 'reviews', 'cad-snapshots': 'snapshots', 'cad-parts': 'bom' };
/** The record kind an old tab's ?id= names. */
const TAB_RECORD: Record<string, string> = { files: 'doc', reviews: 'review', snapshots: 'snapshot', bom: 'part' };

export function CadPage({ currentUser, isAdmin }: { activeTab?: string; currentUser?: any; isAdmin: boolean }) {
  const location = useLocation();
  const robot = /^\/cad\/robots\/(\d{1,12})\/?$/.exec(location.pathname);
  if (robot) return <RobotPage key={robot[1]} robotId={Number(robot[1])} currentUser={currentUser} isAdmin={isAdmin} />;
  const path = location.pathname.replace(/^\//, '').replace(/\/$/, '');
  if (LEGACY_TAB[path]) return <LegacyRedirect tab={LEGACY_TAB[path]} />;
  if (path !== 'cad') return <Navigate to="/cad" replace />;
  return <CadSeasons />;
}

/** An old CAD link: the robot holding the linked record or import, else the team's latest main robot, on the matching tab. */
function LegacyRedirect({ tab }: { tab: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    let live = true;
    const params = new URLSearchParams(location.search);
    const imp = params.get('import');
    (async () => {
      let robotId: number | null = null;
      const record = params.get('id');
      const named = imp && /^\d{1,12}$/.test(imp) ? `import/${imp}` : record && /^\d{1,12}$/.test(record) ? `${TAB_RECORD[tab]}/${record}` : null;
      if (named) {
        const r = await apiFetch(`/api/cad/records/${named}/robot`).catch(() => null);
        if (r?.ok) robotId = (await r.json()).robotId ?? null;
      }
      if (!robotId) {
        const r = await apiFetch('/api/cad/robots').catch(() => null);
        const d = r?.ok ? await r.json() : null;
        robotId = d?.seasons?.flatMap((s: any) => s.robots)?.[0]?.id ?? null;
      }
      if (!live) return;
      if (!robotId) { navigate('/cad', { replace: true }); return; }
      if (tab !== 'bom') params.set('tab', tab);
      navigate(`/cad/robots/${robotId}${params.toString() ? `?${params}` : ''}`, { replace: true });
    })();
    return () => { live = false; };
  }, [tab, location.search, navigate]);
  return <Page><Skeleton className="h-40" /></Page>;
}
