// The team's videos on the dashboard, from Control Scout (GET /api/ftc/team-videos → server/scoutTeamVideos.ts):
// a "Featured on Behind the Bot" badge for each episode the team is tagged in, and a row of its latest match clips.
// Read-only: each opens the video on YouTube; the section links to the team's Control Scout page. With no FTC team,
// nothing to show, or Scout not answering, the section isn't drawn at all (never an error).
import { useEffect, useState } from 'react';
import { ArrowUpRight, Clapperboard, Play } from 'lucide-react';
import { apiFetch } from '../../services/api';
import { CONTROL_SCOUT_URL } from '../../utils/controlScout';
import { watchUrl, type TeamVideos as Videos } from '../../../server/scoutTeamVideos';
import { Section } from './page';

export interface TeamVideosAnswer { team: number | null; videos: Videos | null }

const SERIES: Record<string, string> = { 'behind-the-bot': 'Behind the Bot' };
/** The series the dashboard badges. */
export const BADGE_SERIES = 'behind-the-bot';
/** A series' name as people say it ("behind-the-bot" → "Behind the Bot"). */
export const seriesName = (s: string) => SERIES[s] ?? s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const thumb = (videoId: string) => `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export async function fetchTeamVideos(): Promise<TeamVideosAnswer | null> {
  try {
    const res = await apiFetch('/api/ftc/team-videos');
    return res.ok ? ((await res.json()) as TeamVideosAnswer) : null;
  } catch { return null; }
}

export function useTeamVideos(teamId: unknown) {
  const [answer, setAnswer] = useState<TeamVideosAnswer | null>(null);
  useEffect(() => {
    let live = true;
    setAnswer(null);
    void fetchTeamVideos().then((a) => { if (live) setAnswer(a); });
    return () => { live = false; };
  }, [teamId]);
  return answer;
}

export function TeamVideos({ answer, delay = 0.1 }: { answer: TeamVideosAnswer | null; delay?: number }) {
  const v = answer?.videos;
  const team = answer?.team;
  // The badge is Behind the Bot's, as on the team's Control Scout page; other series (Top 25, …) may come later.
  const badges = v?.featured.filter((f) => f.series === BADGE_SERIES) ?? [];
  if (!v || !team || (!badges.length && !v.clips.length)) return null;
  const scoutHref = `${CONTROL_SCOUT_URL}/teams/${team}`;
  return (
    <Section
      title="Videos"
      description={v.clips.length ? 'Latest match clips' : undefined}
      delay={delay}
      action={
        <a href={scoutHref} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
          Control Scout <ArrowUpRight className="size-3.5" />
        </a>
      }
    >
      {badges.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-2" aria-label="Featured in">
          {badges.map((f) => (
            <li key={f.videoId}>
              <a href={watchUrl(f.videoId)} target="_blank" rel="noopener noreferrer" title={f.title}
                className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                <Clapperboard className="size-3.5" aria-hidden="true" />
                Featured on {seriesName(f.series)}{f.season && badges.length > 1 ? ` · ${f.season}` : ''}
              </a>
            </li>
          ))}
        </ul>
      )}
      {v.clips.length > 0 && (
        <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1" aria-label="Latest match clips">
          {v.clips.map((c) => (
            <li key={`${c.videoId}:${c.start}`} className="w-44 shrink-0 snap-start">
              <a href={watchUrl(c.videoId, c.start)} target="_blank" rel="noopener noreferrer" aria-label={`Play ${c.title}`}
                className="group block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                <span className="relative block aspect-video overflow-hidden rounded-lg border border-border bg-muted">
                  {c.still ? (
                    // The clip's own frame: one tile of the storyboard sheet, the sheet scaled so the tile fills the box.
                    <img src={c.still.src} alt="" loading="lazy" className="absolute max-w-none transition-opacity group-hover:opacity-90"
                      style={{ width: `${c.still.cols * 100}%`, height: `${c.still.rows * 100}%`, left: `${-c.still.col * 100}%`, top: `${-c.still.row * 100}%` }} />
                  ) : (
                    <img src={thumb(c.videoId)} alt="" loading="lazy" className="size-full object-cover transition-opacity group-hover:opacity-90" />
                  )}
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex size-9 items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm transition-transform group-hover:scale-105">
                      <Play className="ml-0.5 size-4" aria-hidden="true" />
                    </span>
                  </span>
                  {c.end != null && (
                    <span className="absolute bottom-1 right-1 rounded bg-background/85 px-1 text-[11px] font-medium tabular-nums text-foreground">{clock(c.end - c.start)}</span>
                  )}
                </span>
                <span className="mt-1.5 block truncate text-sm font-medium text-foreground">{c.match}</span>
                <span className="block truncate text-xs text-muted-foreground">{c.event}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
