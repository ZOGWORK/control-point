// The dashboard's Videos section (src/modern/ui/TeamVideos.tsx): the Behind the Bot badge and the latest clips,
// each opening YouTube at the right second, a link to the team's Control Scout page, and nothing at all when there
// is nothing to show or Scout didn't answer.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TeamVideos, seriesName, type TeamVideosAnswer } from '../ui/TeamVideos';

afterEach(cleanup);

const clip = (n: number, end: number | null = n * 100 + 158) => ({ videoId: 'ccccccccccc', start: n * 100, end, event: 'NJ Championship', match: `Q${n}`, title: `Q${n} · NJ Championship` });
const answer = (over: Partial<NonNullable<TeamVideosAnswer['videos']>> = {}): TeamVideosAnswer => ({
  team: 4215,
  videos: { featured: [{ series: 'behind-the-bot', videoId: 'ddddddddddd', season: 2025, title: 'Behind the Bot: 4215' }], clips: [clip(3), clip(1, null)], ...over },
});

describe('TeamVideos', () => {
  it('shows the badge and the clips, each opening the video at its start', () => {
    render(<TeamVideos answer={answer()} />);
    expect(screen.getByRole('heading', { name: 'Videos' })).toBeInTheDocument();
    const badge = screen.getByRole('link', { name: /Featured on Behind the Bot/ });
    expect(badge).toHaveAttribute('href', 'https://www.youtube.com/watch?v=ddddddddddd');
    expect(badge).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Play Q3 · NJ Championship' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=ccccccccccc&t=300s');
    expect(screen.getByRole('link', { name: 'Play Q1 · NJ Championship' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=ccccccccccc&t=100s');
    expect(screen.getByText('2:38')).toBeInTheDocument(); // Q3's length; Q1 has no end, so no length
    expect(screen.getAllByText(/^\d+:\d\d$/)).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Control Scout/ })).toHaveAttribute('href', 'https://controlscout.org/teams/4215');
  });

  it('a featured team with no clips still gets its badge; clips with no episode get no badge', () => {
    render(<TeamVideos answer={answer({ clips: [] })} />);
    expect(screen.getByRole('link', { name: /Featured on Behind the Bot/ })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Latest match clips' })).not.toBeInTheDocument();
    cleanup();
    render(<TeamVideos answer={answer({ featured: [] })} />);
    expect(screen.queryByText(/Featured on/)).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Latest match clips' })).toBeInTheDocument();
  });

  it('two episodes of one series say their seasons', () => {
    render(<TeamVideos answer={answer({ featured: [
      { series: 'behind-the-bot', videoId: 'ddddddddddd', season: 2025, title: 'a' },
      { series: 'behind-the-bot', videoId: 'eeeeeeeeeee', season: 2024, title: 'b' },
    ] })} />);
    expect(screen.getByRole('link', { name: 'Featured on Behind the Bot · 2025' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Featured on Behind the Bot · 2024' })).toBeInTheDocument();
  });

  it('draws nothing when Scout had nothing or didn\'t answer', () => {
    for (const a of [null, { team: null, videos: null }, { team: 4215, videos: null }, answer({ featured: [], clips: [] })]) {
      const { container } = render(<TeamVideos answer={a} />);
      expect(container).toBeEmptyDOMElement();
      cleanup();
    }
  });

  it('names series as people say them', () => {
    expect(seriesName('behind-the-bot')).toBe('Behind the Bot');
    expect(seriesName('pits-and-parts')).toBe('Pits And Parts');
  });
});
