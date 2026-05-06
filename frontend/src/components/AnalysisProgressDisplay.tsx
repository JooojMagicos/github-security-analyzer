import { AppState, AnalysisProgress } from '../types';

interface Props {
  state: AppState;
  progress: AnalysisProgress;
  onCancel: () => void;
}

const styles = `
  .progress-container {
    max-width: 720px;
    margin: 32px auto 0;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 32px;
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  }

  .progress-title {
    font-family: 'Syne', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: #fff;
  }

  .progress-status {
    font-size: 11px;
    color: var(--accent);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .progress-bar-track {
    width: 100%;
    height: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 20px;
  }

  .progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--green));
    border-radius: 6px;
    transition: width 0.4s ease;
  }

  .progress-stats {
    display: flex;
    gap: 24px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }

  .progress-stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .progress-stat-value {
    font-size: 22px;
    font-weight: 700;
    font-family: 'Syne', sans-serif;
    color: #fff;
  }

  .progress-stat-label {
    font-size: 10px;
    color: var(--muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .progress-file {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 20px;
    min-height: 40px;
  }

  .progress-file-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .progress-file-name {
    font-size: 12px;
    color: var(--text);
    font-family: 'Space Mono', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .progress-findings-badge {
    margin-left: auto;
    flex-shrink: 0;
    background: rgba(255,69,96,0.12);
    border: 1px solid rgba(255,69,96,0.3);
    color: var(--red);
    border-radius: 6px;
    padding: 2px 10px;
    font-size: 11px;
    font-weight: 700;
    font-family: 'Syne', sans-serif;
  }

  .progress-findings-badge.green {
    background: rgba(0,255,136,0.08);
    border-color: rgba(0,255,136,0.2);
    color: var(--green);
  }

  .btn-cancel {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 8px 20px;
    border-radius: 8px;
    font-family: 'Space Mono', monospace;
    font-size: 12px;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
    width: 100%;
  }
  .btn-cancel:hover { border-color: var(--red); color: var(--red); }

  .filtering-spinner {
    display: flex;
    align-items: center;
    gap: 14px;
    color: var(--accent);
    font-size: 13px;
    margin-bottom: 20px;
  }

  .spinner-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 0.8s ease-in-out infinite;
  }
  .spinner-dot:nth-child(2) { animation-delay: 0.2s; }
  .spinner-dot:nth-child(3) { animation-delay: 0.4s; }
`;

function statusLabel(state: AppState): string {
  if (state === 'fetching-files') return 'Fetching file list…';
  if (state === 'filtering') return 'Generating report…';
  return 'Analyzing…';
}

export default function AnalysisProgressDisplay({ state, progress, onCancel }: Props) {
  const pct = progress.totalFiles > 0
    ? Math.round((progress.analyzedFiles / progress.totalFiles) * 100)
    : 0;

  const isFiltering = state === 'filtering';

  return (
    <>
      <style>{styles}</style>
      <div className="progress-container">
        <div className="progress-header">
          <div className="progress-title">Security Analysis in Progress</div>
          <div className="progress-status">{statusLabel(state)}</div>
        </div>

        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: isFiltering ? '100%' : `${pct}%` }} />
        </div>

        {!isFiltering && (
          <>
            <div className="progress-stats">
              <div className="progress-stat">
                <div className="progress-stat-value">{progress.analyzedFiles}</div>
                <div className="progress-stat-label">Files analyzed</div>
              </div>
              <div className="progress-stat">
                <div className="progress-stat-value">{progress.totalFiles}</div>
                <div className="progress-stat-label">Total files</div>
              </div>
              <div className="progress-stat">
                <div className="progress-stat-value" style={{ color: progress.findingsCount > 0 ? 'var(--red)' : 'var(--green)' }}>
                  {progress.findingsCount}
                </div>
                <div className="progress-stat-label">Findings so far</div>
              </div>
              <div className="progress-stat">
                <div className="progress-stat-value">{pct}%</div>
                <div className="progress-stat-label">Complete</div>
              </div>
            </div>

            {progress.currentFile && (
              <div className="progress-file">
                <div className="progress-file-dot" />
                <div className="progress-file-name">{progress.currentFile}</div>
                {progress.findingsCount > 0 && (
                  <div className="progress-findings-badge">
                    {progress.findingsCount} found
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {isFiltering && (
          <div className="filtering-spinner">
            <div className="spinner-dot" />
            <div className="spinner-dot" />
            <div className="spinner-dot" />
            <span>GPT-4o-mini generating final report…</span>
          </div>
        )}

        <button className="btn-cancel" onClick={onCancel}>Cancel Analysis</button>
      </div>
    </>
  );
}
