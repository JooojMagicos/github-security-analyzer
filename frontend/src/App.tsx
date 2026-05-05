import { useState, useEffect, useRef } from 'react';
import { AppState, AnalysisReport } from './types';
import InputForm from './components/InputForm';
import Report from './components/Report';

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? '';

const LOADING_MESSAGES = [
  'Fetching repository file tree...',
  'Filtering security-relevant files...',
  'Reading source code...',
  'Running AI security analysis...',
  'Identifying vulnerabilities...',
  'Generating security report...',
];

const styles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0a0e1a;
    --panel: #0f1629;
    --border: #1e2d4a;
    --accent: #00d4ff;
    --green: #00ff88;
    --yellow: #ffd600;
    --red: #ff4560;
    --orange: #ff7043;
    --text: #c8d8f0;
    --muted: #4a6080;
    --font-mono: 'Space Mono', monospace;
    --font-display: 'Syne', sans-serif;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-mono);
    min-height: 100vh;
    line-height: 1.6;
  }

  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .header {
    border-bottom: 1px solid var(--border);
    padding: 20px 40px;
    display: flex;
    align-items: center;
    gap: 16px;
    background: var(--panel);
  }

  .header-icon {
    width: 36px;
    height: 36px;
    background: linear-gradient(135deg, var(--accent), #0080ff);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    flex-shrink: 0;
  }

  .header-title {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 700;
    color: #fff;
    letter-spacing: -0.02em;
  }

  .header-sub {
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .main {
    flex: 1;
    padding: 48px 40px;
    max-width: 1100px;
    margin: 0 auto;
    width: 100%;
  }

  .hero {
    text-align: center;
    margin-bottom: 48px;
  }

  .hero h1 {
    font-family: var(--font-display);
    font-size: clamp(28px, 5vw, 48px);
    font-weight: 800;
    color: #fff;
    line-height: 1.1;
    letter-spacing: -0.03em;
    margin-bottom: 16px;
  }

  .hero h1 span {
    background: linear-gradient(90deg, var(--accent), var(--green));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .hero p {
    color: var(--muted);
    font-size: 15px;
    max-width: 520px;
    margin: 0 auto;
  }

  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 32px;
    padding: 80px 20px;
  }

  .loading-spinner {
    width: 64px;
    height: 64px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .loading-bar-container {
    width: 100%;
    max-width: 480px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    height: 6px;
  }

  .loading-bar {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--green));
    animation: progress 12s ease-in-out forwards;
    border-radius: 8px;
  }

  @keyframes progress {
    0%   { width: 0%; }
    20%  { width: 25%; }
    50%  { width: 55%; }
    75%  { width: 75%; }
    95%  { width: 90%; }
    100% { width: 90%; }
  }

  .loading-message {
    font-size: 13px;
    color: var(--accent);
    letter-spacing: 0.05em;
    height: 20px;
    transition: opacity 0.3s;
  }

  .error-box {
    background: rgba(255, 69, 96, 0.08);
    border: 1px solid rgba(255, 69, 96, 0.3);
    border-radius: 12px;
    padding: 32px;
    text-align: center;
    max-width: 520px;
    margin: 80px auto;
  }

  .error-box h2 {
    font-family: var(--font-display);
    font-size: 20px;
    color: var(--red);
    margin-bottom: 12px;
  }

  .error-box p {
    color: var(--muted);
    font-size: 13px;
    margin-bottom: 24px;
  }

  .btn-retry {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 10px 24px;
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 13px;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
  }

  .btn-retry:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .footer {
    border-top: 1px solid var(--border);
    padding: 20px 40px;
    text-align: center;
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.05em;
  }
`;

export default function App() {
  const [state, setState] = useState<AppState>('idle');
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (state === 'loading') {
      setLoadingMsgIdx(0);
      intervalRef.current = setInterval(() => {
        setLoadingMsgIdx((i) => Math.min(i + 1, LOADING_MESSAGES.length - 1));
      }, 5000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state]);

  async function handleAnalyze(repoUrl: string) {
    setState('loading');
    setReport(null);
    setErrorMsg('');

    try {
      const endpoint = WORKER_URL ? `${WORKER_URL}/analyze` : '/analyze';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl }),
      });

      const data = await res.json() as AnalysisReport & { error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      setReport(data);
      setRepoUrl(repoUrl);
      setState('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred');
      setState('error');
    }
  }

  function handleReset() {
    setState('idle');
    setReport(null);
    setRepoUrl('');
    setErrorMsg('');
  }

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <header className="header">
          <div className="header-icon">🔐</div>
          <div>
            <div className="header-title">GitHub Security Analyzer</div>
            <div className="header-sub">Powered by Llama 3.3 70B · Groq</div>
          </div>
        </header>

        <main className="main">
          {(state === 'idle' || state === 'loading') && (
            <div className="hero">
              <h1>Analyze GitHub repos for<br /><span>security vulnerabilities</span></h1>
              <p>Paste any public repository URL and get an AI-powered security audit in seconds.</p>
            </div>
          )}

          {(state === 'idle' || state === 'loading') && (
            <InputForm onAnalyze={handleAnalyze} loading={state === 'loading'} />
          )}

          {state === 'loading' && (
            <div className="loading-container">
              <div className="loading-spinner" />
              <div className="loading-bar-container">
                <div className="loading-bar" />
              </div>
              <div className="loading-message">{LOADING_MESSAGES[loadingMsgIdx]}</div>
            </div>
          )}

          {state === 'error' && (
            <div className="error-box">
              <h2>Analysis Failed</h2>
              <p>{errorMsg}</p>
              <button className="btn-retry" onClick={handleReset}>Try Again</button>
            </div>
          )}

          {state === 'done' && report && (
            <Report report={report} repoUrl={repoUrl} onReset={handleReset} />
          )}
        </main>

        <footer className="footer">
          GitHub Security Analyzer · AI-powered · For educational and authorized use only
        </footer>
      </div>
    </>
  );
}
