import { useState, FormEvent } from 'react';

interface Props {
  onAnalyze: (url: string) => void;
  loading: boolean;
}

const styles = `
  .input-form {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 32px;
    max-width: 720px;
    margin: 0 auto 32px;
  }

  .input-label {
    display: block;
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 10px;
  }

  .input-row {
    display: flex;
    gap: 12px;
  }

  .url-input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 18px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text);
    outline: none;
    transition: border-color 0.2s;
  }

  .url-input::placeholder {
    color: var(--muted);
  }

  .url-input:focus {
    border-color: var(--accent);
  }

  .url-input.invalid {
    border-color: var(--red);
  }

  .analyze-btn {
    background: linear-gradient(135deg, var(--accent), #0080ff);
    border: none;
    border-radius: 10px;
    padding: 14px 28px;
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 700;
    color: #000;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.2s, transform 0.1s;
    letter-spacing: 0.02em;
  }

  .analyze-btn:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  .analyze-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .input-hint {
    margin-top: 12px;
    font-size: 11px;
    color: var(--muted);
  }

  .input-error {
    margin-top: 8px;
    font-size: 12px;
    color: var(--red);
  }

  .example-links {
    margin-top: 16px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .example-chip {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--muted);
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
  }

  .example-chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
`;

const EXAMPLES = [
  'https://github.com/anthropics/anthropic-sdk-python',
  'https://github.com/vercel/next.js',
  'https://github.com/tiangolo/fastapi',
];

function isValidGitHubUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com') return false;
    const parts = u.pathname.replace(/^\//, '').split('/');
    return parts.length >= 2 && parts[0].length > 0 && parts[1].length > 0;
  } catch {
    return false;
  }
}

export default function InputForm({ onAnalyze, loading }: Props) {
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);

  const valid = !url || isValidGitHubUrl(url);
  const showError = touched && url.length > 0 && !valid;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!isValidGitHubUrl(url)) return;
    onAnalyze(url);
  }

  return (
    <>
      <style>{styles}</style>
      <form className="input-form" onSubmit={handleSubmit}>
        <label className="input-label" htmlFor="repo-url">Repository URL</label>
        <div className="input-row">
          <input
            id="repo-url"
            className={`url-input${showError ? ' invalid' : ''}`}
            type="url"
            placeholder="https://github.com/owner/repository"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setTouched(true)}
            disabled={loading}
            autoFocus
          />
          <button
            className="analyze-btn"
            type="submit"
            disabled={loading || !url}
          >
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>

        {showError && (
          <div className="input-error">Please enter a valid GitHub repository URL</div>
        )}

        {!showError && (
          <div className="input-hint">Supports any public GitHub repository</div>
        )}

        <div className="example-links">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="example-chip"
              disabled={loading}
              onClick={() => { setUrl(ex); setTouched(false); }}
            >
              {ex.replace('https://github.com/', '')}
            </button>
          ))}
        </div>
      </form>
    </>
  );
}
