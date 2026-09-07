// Status of the local Lichess position pool plus a manual fetch button.
// Shared by the drills that draw from the pool.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { CloudDownload, WifiOff } from 'lucide-react';
import { getSnapshot, getTargetGames, refreshPool, subscribe } from './lichessPool';

const ago = (ts: number) => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
};

interface LichessPoolPanelProps {
  /** Optional second line, e.g. how many exercises of the current kind remain. */
  detail?: string;
}

export function LichessPoolPanel({ detail }: LichessPoolPanelProps) {
  const lichess = useSyncExternalStore(subscribe, getSnapshot);
  const [, setTick] = useState(0);
  const waitingUntil = lichess.status.state === 'fetching' ? lichess.status.progress.waitingUntil : null;
  useEffect(() => {
    if (!waitingUntil) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [waitingUntil]);

  return (
    <div className="bm__pool">
      <div className="bm__pool-line">
        <CloudDownload size={16} />
        <span>
          {lichess.summary.total === 0
            ? 'No games saved yet'
            : `${lichess.summary.unseen.toLocaleString()} of ${lichess.summary.total.toLocaleString()} positions unseen · ${lichess.summary.games} games`}
        </span>
        {lichess.summary.fetchedAt && <small>fetched {ago(lichess.summary.fetchedAt)}</small>}
      </div>
      {detail && <div className="bm__pool-status">{detail}</div>}
      {lichess.status.state === 'fetching' && (
        <div className="bm__pool-progress">
          <div className="bm__pool-bar">
            <div style={{ width: `${Math.min(100, (lichess.status.progress.games / getTargetGames()) * 100)}%` }} />
          </div>
          <div className="bm__pool-status">
            {lichess.status.progress.waitingUntil
              ? `Lichess rate limit reached, resuming in ${Math.max(0, Math.ceil((lichess.status.progress.waitingUntil - Date.now()) / 1000))} s`
              : `Fetching ${lichess.status.progress.games} of ${getTargetGames()} games · ${lichess.status.progress.tournaments} tournaments · ${lichess.status.progress.current}`}
          </div>
        </div>
      )}
      {lichess.status.state === 'error' && (
        <div className="bm__pool-status is-error">
          {lichess.status.offline && <WifiOff size={14} />} {lichess.status.message}
        </div>
      )}
      <button
        className="btn"
        disabled={lichess.status.state === 'fetching'}
        onClick={() => void refreshPool(true)}
        title="Fetch the next batch of games now"
      >
        <CloudDownload size={14} /> {lichess.summary.total === 0 ? 'Fetch games' : 'Fetch new games'}
      </button>
    </div>
  );
}
