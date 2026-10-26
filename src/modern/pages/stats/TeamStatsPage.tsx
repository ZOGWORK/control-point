// Modern Team Stats (phases 7b–7c), rebuilt on the shadcn kit: Compete is our
// team's season (TeamProfile); Analyze is the scouting workspace (event
// field, any team, the shortlist). Mode, season and the Compete → Analyze
// hand-off come from the shared useTeamStats.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardPen, Search, Trophy } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '../../../components/ui-kit';
import { useTeamStats, type TeamStatsMode } from '../../../components/scout/useTeamStats';
import { Page, PageHeader } from '../../ui/page';
import { ControlScoutSuggestion } from '../../ui/sisterApp';
import { CONTROL_SCOUT_URL, controlScoutTeamUrl } from '../../../utils/controlScout';
import { TeamProfile } from './TeamProfile';
import { AnalyzeWorkspace } from './AnalyzeWorkspace';
import { ScoutingWorkspace } from './ScoutingWorkspace';

/** Our team on Control Scout on Compete. Analyze picks its team inside the
 *  workspace (search, event field), which this page can't see, so it links
 *  Scout's home rather than a team that may no longer be on screen. */
export function scoutHref(ts: { mode: TeamStatsMode; season: number; myTeam: number | null }): string {
  return ts.mode === 'compete' && ts.myTeam ? controlScoutTeamUrl(ts.myTeam, ts.season) : CONTROL_SCOUT_URL;
}

export function TeamStatsPage({ teamId, memberId, memberName, canManage }: { teamId?: number | null; memberId?: number | null; memberName?: string | null; canManage?: boolean } = {}) {
  const ts = useTeamStats();
  // A link to a scouting entry (?scouted=TEAM&season=YEAR): read once, then
  // drop both so later season or team changes aren't overridden.
  const [params, setParams] = useSearchParams();
  const [linkedTeam] = useState(() => { const n = Number(params.get('scouted')); return Number.isInteger(n) && n > 0 ? n : null; });
  useEffect(() => {
    if (!params.has('scouted') && !params.has('season')) return;
    setParams(p => { const n = new URLSearchParams(p); n.delete('scouted'); n.delete('season'); return n; }, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on arrival
  return (
    <Page>
      <PageHeader
        eyebrow="Compete"
        title="Team Stats"
        description={ts.mode === 'compete' ? 'Your season: OPR, trends, every event and match.' : ts.mode === 'scout' ? 'Scout matches by hand — works offline and without FTC data.' : 'Scout an event field, build a pick list and dig into any team.'}
      >
        <Tabs value={ts.mode} onValueChange={(v) => ts.setMode(v as TeamStatsMode)}>
          <TabsList aria-label="Team stats mode">
            <TabsTrigger value="compete" className="max-sm:h-11"><Trophy /> Compete</TabsTrigger>
            <TabsTrigger value="analyze" className="max-sm:h-11"><Search /> Analyze</TabsTrigger>
            <TabsTrigger value="scout" className="max-sm:h-11"><ClipboardPen /> Scout</TabsTrigger>
          </TabsList>
        </Tabs>
      </PageHeader>
      {/* Our numbers here; the full picture of any team or event on Control Scout. Not on hand scouting. */}
      {ts.mode !== 'scout' && <ControlScoutSuggestion userId={memberId} href={scoutHref(ts)} />}
      {ts.mode === 'scout' ? (
        <ScoutingWorkspace initialFocusTeam={linkedTeam} season={ts.season} onSeasonChange={ts.setSeason} teamId={teamId} currentMemberId={memberId} currentMemberName={memberName} canManage={canManage} />
      ) : ts.mode === 'compete' ? (
        <TeamProfile number={null} season={ts.season} onSeasonChange={ts.setSeason} autoSeason actions={{ onViewTeam: ts.viewTeam }} />
      ) : (
        <AnalyzeWorkspace key={ts.focusTeam?.number ?? 'none'} season={ts.season} onSeasonChange={ts.setSeason} myTeam={ts.myTeam} initialTeam={ts.focusTeam} />
      )}
    </Page>
  );
}
