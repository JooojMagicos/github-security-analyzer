import { useState, useRef } from 'react';
import { AppState, AnalysisReport, AnalysisProgress } from './types';
import InputForm from './components/InputForm';
import Report from './components/Report';
import AnalysisProgressDisplay from './components/AnalysisProgressDisplay';

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? '';

async function safeJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) throw new Error(`Empty response (HTTP ${res.status})`);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`Invalid JSON response (HTTP ${res.status}): ${text.slice(0, 100)}`); }
}

const styles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #000;
    --panel: #0d0d0d;
    --panel-2: #141414;
    --border: rgba(255,255,255,0.08);
    --border-strong: rgba(255,255,255,0.18);
    --accent: #00ff88;
    --green: #00ff88;
    --yellow: #ffd600;
    --red: #ff4444;
    --orange: #ff7043;
    --text: #ffffff;
    --muted: #666666;
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

  .app { min-height: 100vh; display: flex; flex-direction: column; }

  .header {
    border-bottom: 1px solid var(--border);
    padding: 0 40px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #000;
  }

  .header-left { display: flex; flex-direction: column; gap: 2px; }

  .header-title {
    font-family: var(--font-display);
    font-size: 15px; font-weight: 700; color: #fff; letter-spacing: -0.01em;
  }

  .header-sub { font-size: 10px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }

  .header-links { display: flex; align-items: center; gap: 20px; }

  .header-link {
    display: flex; align-items: center; gap: 7px;
    font-size: 12px; color: var(--muted); text-decoration: none;
    font-family: var(--font-mono);
    transition: color 0.2s;
    letter-spacing: 0.02em;
  }

  .header-link:hover { color: var(--accent); }
  .header-link svg { flex-shrink: 0; }
  .header-divider { width: 1px; height: 16px; background: var(--border-strong); }

  .main { flex: 1; padding: 48px 40px; max-width: 1100px; margin: 0 auto; width: 100%; }

  .hero { text-align: center; margin-bottom: 48px; }

  .hero h1 {
    font-family: var(--font-display);
    font-size: clamp(28px, 5vw, 48px); font-weight: 800; color: #fff;
    line-height: 1.1; letter-spacing: -0.03em; margin-bottom: 16px;
  }

  .hero h1 span { color: var(--accent); }

  .hero p { color: var(--muted); font-size: 15px; max-width: 520px; margin: 0 auto; }

  .error-box {
    background: rgba(255,68,68,0.06); border: 1px solid rgba(255,68,68,0.2);
    border-radius: 12px; padding: 32px; text-align: center;
    max-width: 520px; margin: 80px auto;
  }

  .error-box h2 { font-family: var(--font-display); font-size: 20px; color: var(--red); margin-bottom: 12px; }
  .error-box p { color: var(--muted); font-size: 13px; margin-bottom: 24px; }

  .btn-retry {
    background: transparent; border: 1px solid var(--border-strong); color: var(--text);
    padding: 10px 24px; border-radius: 6px; font-family: var(--font-mono);
    font-size: 13px; cursor: pointer; transition: border-color 0.2s, color 0.2s;
  }
  .btn-retry:hover { border-color: var(--accent); color: var(--accent); }

  .footer {
    border-top: 1px solid var(--border); padding: 20px 40px;
    text-align: center; font-size: 11px; color: var(--muted); letter-spacing: 0.05em;
  }
`;

export default function App() {
  const [state, setState] = useState<AppState>('idle');
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState<AnalysisProgress>({
    totalFiles: 0, analyzedFiles: 0, currentFile: '', findingsCount: 0,
  });

  const cancelledRef = useRef(false);

  function endpoint(path: string) {
    return WORKER_URL ? `${WORKER_URL}${path}` : path;
  }

  async function handleAnalyze(url: string) {
    cancelledRef.current = false;
    setRepoUrl(url);
    setReport(null);
    setErrorMsg('');
    setState('fetching-files');
    setProgress({ totalFiles: 0, analyzedFiles: 0, currentFile: '', findingsCount: 0 });

    try {
      // Step 1: get ranked file list
      const filesRes = await fetch(endpoint('/get-files'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: url }),
      });

      if (!filesRes.ok) {
        const data = await safeJson<{ error?: string }>(filesRes);
        throw new Error(data.error ?? `Failed to fetch files (${filesRes.status})`);
      }

      type FilesResponse = { owner: string; repo: string; files: { path: string; score: number }[] };
      const { owner, repo, files } = await safeJson<FilesResponse>(filesRes);

      setState('analyzing');
      setProgress({ totalFiles: files.length, analyzedFiles: 0, currentFile: '', findingsCount: 0 });

      // Step 2: analyze each file sequentially
      const allFindings: unknown[] = [];
      const analyzedPaths: string[] = [];

      for (let i = 0; i < files.length; i++) {
        if (cancelledRef.current) break;

        const file = files[i];
        setProgress({
          totalFiles: files.length,
          analyzedFiles: i,
          currentFile: file.path,
          findingsCount: allFindings.length,
        });

        try {
          const res = await fetch(endpoint('/analyze-file'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner, repo, path: file.path }),
          });

          if (res.ok) {
            const data = await safeJson<{ findings?: unknown[]; skipped?: boolean }>(res);
            if (data.findings?.length) allFindings.push(...data.findings);
            if (!data.skipped) analyzedPaths.push(file.path);
          }
        } catch {
          // skip failed files, continue with the rest
        }
      }

      if (cancelledRef.current) {
        handleReset();
        return;
      }

      // Step 3: finalize report
      setState('filtering');
      setProgress((p) => ({ ...p, analyzedFiles: files.length, currentFile: 'Generating report…' }));

      const filterRes = await fetch(endpoint('/filter-findings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo, findings: allFindings, filesAnalyzed: analyzedPaths }),
      });

      if (!filterRes.ok) {
        const data = await safeJson<{ error?: string }>(filterRes);
        throw new Error(data.error ?? 'Failed to generate report');
      }

      const finalReport = await safeJson<AnalysisReport>(filterRes);
      setReport(finalReport);
      setState('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'An unexpected error occurred');
      setState('error');
    }
  }

  function handleReset() {
    cancelledRef.current = true;
    setState('idle');
    setReport(null);
    setRepoUrl('');
    setErrorMsg('');
    setProgress({ totalFiles: 0, analyzedFiles: 0, currentFile: '', findingsCount: 0 });
  }

  const isAnalyzing = state === 'fetching-files' || state === 'analyzing' || state === 'filtering';

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <header className="header">
          <div className="header-left">
            <div className="header-title">GitHub Security Analyzer</div>
            <div className="header-sub">GPT-4o · GitHub Models · OWASP</div>
          </div>

          <div className="header-links">
            <a className="header-link" href="https://github.com/JooojMagicos/github-security-analyzer" target="_blank" rel="noopener noreferrer">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              GitHub
            </a>

            <div className="header-divider" />

            <a className="header-link" href="https://paypal.me/joanomagicos" target="_blank" rel="noopener noreferrer">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c1.379 2.967.963 6.405-1.258 8.57 1.521-.79 2.594-2.158 3.049-4.065.332-1.396.124-2.785-1.184-3.964z"/>
              </svg>
              Support
            </a>
          </div>
        </header>

        <main className="main">
          {(state === 'idle' || isAnalyzing) && (
            <div className="hero">
              <h1>Analyze GitHub repos for<br /><span>security vulnerabilities</span></h1>
              <p>Each file is analyzed individually by GPT-4o for thorough, deep coverage.</p>
            </div>
          )}

          {(state === 'idle' || isAnalyzing) && (
            <InputForm onAnalyze={handleAnalyze} loading={isAnalyzing} />
          )}

          {state === 'idle' && <HowItWorks />}

          {isAnalyzing && (
            <AnalysisProgressDisplay state={state} progress={progress} onCancel={handleReset} />
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

const howStyles = `
  .how { max-width: 720px; margin: 48px auto 0; display: flex; flex-direction: column; gap: 24px; }

  .how-section {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 24px;
  }

  .how-section-title {
    font-family: 'Syne', sans-serif;
    font-size: 11px;
    font-weight: 700;
    color: var(--muted);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .how-section-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .how-steps { display: flex; flex-direction: column; gap: 16px; }

  .how-step { display: flex; gap: 16px; align-items: flex-start; }

  .how-step-num {
    width: 26px; height: 26px;
    border-radius: 4px;
    background: rgba(0,255,136,0.08);
    border: 1px solid rgba(0,255,136,0.2);
    color: var(--accent);
    font-size: 11px;
    font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    font-family: 'Space Mono', monospace;
  }

  .how-step-content { flex: 1; }

  .how-step-title {
    font-size: 13px;
    font-weight: 700;
    color: #fff;
    font-family: 'Syne', sans-serif;
    margin-bottom: 4px;
  }

  .how-step-desc { font-size: 12px; color: var(--muted); line-height: 1.7; }

  .how-badges { display: flex; flex-direction: column; gap: 12px; }

  .how-badge-row { display: flex; gap: 14px; align-items: flex-start; }

  .how-badge {
    flex-shrink: 0;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    font-family: 'Space Mono', monospace;
    white-space: nowrap;
    margin-top: 1px;
  }

  .badge-ai    { background: rgba(0,255,136,0.08); color: var(--accent); border: 1px solid rgba(0,255,136,0.2); }
  .badge-pat   { background: rgba(255,255,255,0.04); color: #888; border: 1px solid rgba(255,255,255,0.1); }
  .badge-crit  { background: rgba(255,68,68,0.08); color: var(--red);    border: 1px solid rgba(255,68,68,0.2); }
  .badge-high  { background: rgba(255,112,67,0.08);color: var(--orange); border: 1px solid rgba(255,112,67,0.2); }
  .badge-med   { background: rgba(255,214,0,0.08); color: var(--yellow); border: 1px solid rgba(255,214,0,0.2); }
  .badge-low   { background: rgba(255,255,255,0.04);color: #aaa; border: 1px solid rgba(255,255,255,0.1); }

  .how-badge-desc { font-size: 12px; color: var(--muted); line-height: 1.7; }
  .how-badge-desc strong { color: #fff; }

  .how-limits { display: flex; flex-direction: column; gap: 8px; }
  .how-limit-row { display: flex; gap: 10px; font-size: 12px; color: var(--muted); line-height: 1.6; }
  .how-limit-icon { flex-shrink: 0; }
`;

function HowItWorks() {
  return (
    <>
      <style>{howStyles}</style>
      <div className="how">

        {/* Tips for better results */}
        <div className="how-section" style={{ borderColor: 'rgba(0,212,255,0.2)', background: 'rgba(0,212,255,0.03)' }}>
          <div className="how-section-title" style={{ color: 'var(--accent)' }}>Tips for better results</div>
          <div className="how-steps">
            {[
              {
                icon: '⚡',
                title: 'Enable GitHub Code Scanning on your repo',
                desc: 'Go to Settings → Code security and analysis → Enable Code scanning. This activates CodeQL, a professional SAST tool. The analyzer will pull its findings automatically — dramatically improving coverage.',
              },
              {
                icon: '📦',
                title: 'Enable Dependabot',
                desc: 'Settings → Code security and analysis → Enable Dependabot alerts. The analyzer will include known CVEs from your dependencies, ranked by severity.',
              },
              {
                icon: '🎯',
                title: 'Focus on backend-heavy repositories',
                desc: 'The analyzer excels at Node.js, Python, Go, Java, and PHP backends. Repositories with route handlers, database queries, and authentication logic yield the most relevant findings.',
              },
              {
                icon: '🔑',
                title: 'Use a GitHub token with security permissions',
                desc: 'If the tool is self-hosted and configured with a token that has security_events scope, you will also see Secret Scanning results for repositories you own.',
              },
              {
                icon: '📁',
                title: 'Prefer focused repositories over monorepos',
                desc: 'Large monorepos may hit the 80-file analysis limit before covering critical code. For best results, analyze individual services or modules separately.',
              },
            ].map((s, i) => (
              <div className="how-step" key={i}>
                <div className="how-step-num" style={{ background: 'rgba(0,212,255,0.08)', fontSize: 14 }}>{s.icon}</div>
                <div className="how-step-content">
                  <div className="how-step-title">{s.title}</div>
                  <div className="how-step-desc">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How to use */}
        <div className="how-section">
          <div className="how-section-title">How to use</div>
          <div className="how-steps">
            {[
              { title: 'Paste a GitHub repository URL', desc: 'Any public repository works. Example: https://github.com/facebook/react' },
              { title: 'Click Analyze', desc: 'The app fetches up to 80 security-relevant files, ranked by risk — authentication routes, database models, API handlers come first.' },
              { title: 'Wait for sequential analysis', desc: 'Each file is sent individually to GPT-4o for deep inspection. A progress bar shows the current file and findings discovered so far. This can take 3–10 minutes depending on the repository size.' },
              { title: 'Review the security report', desc: 'Get a prioritized list of vulnerabilities with severity levels, code evidence, CWE classification, and actionable fix recommendations. Export individual findings or the full report as Markdown.' },
            ].map((s, i) => (
              <div className="how-step" key={i}>
                <div className="how-step-num">{i + 1}</div>
                <div className="how-step-content">
                  <div className="how-step-title">{s.title}</div>
                  <div className="how-step-desc">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Understanding findings */}
        <div className="how-section">
          <div className="how-section-title">Understanding findings</div>
          <div className="how-badges">
            <div className="how-badge-row">
              <span className="how-badge badge-ai">AI</span>
              <div className="how-badge-desc"><strong>GPT-4o analysis</strong> — The model read the full file and identified a real, exploitable vulnerability with code evidence. Highest quality finding.</div>
            </div>
            <div className="how-badge-row">
              <span className="how-badge badge-pat">PATTERN</span>
              <div className="how-badge-desc"><strong>Pattern scan</strong> — A regex rule matched a dangerous code pattern (e.g. eval(), innerHTML, hardcoded secret). Requires manual verification — may be a false positive depending on context.</div>
            </div>
            <div className="how-badge-row">
              <span className="how-badge badge-ai">[CodeQL]</span>
              <div className="how-badge-desc"><strong>GitHub Code Scanning</strong> — GitHub's own SAST tool (CodeQL) found this. Only appears if the repo owner has enabled code scanning. Very high confidence.</div>
            </div>
            <div className="how-badge-row">
              <span className="how-badge badge-crit">[Dependabot]</span>
              <div className="how-badge-desc"><strong>GitHub Dependabot</strong> — A dependency has a known CVE. Only visible on repositories you own or administer.</div>
            </div>
          </div>
        </div>

        {/* Severity guide */}
        <div className="how-section">
          <div className="how-section-title">Severity levels</div>
          <div className="how-badges">
            {[
              { cls: 'badge-crit',  label: 'CRITICAL', desc: 'Direct exploitation with severe impact: SQL injection, hardcoded credentials, RCE via deserialization, authentication bypass.' },
              { cls: 'badge-high',  label: 'HIGH',     desc: 'Significant risk: path traversal, stored XSS, IDOR without auth check, XXE, weak crypto for passwords, CI/CD injection.' },
              { cls: 'badge-med',   label: 'MEDIUM',   desc: 'Exploitable under specific conditions: reflected XSS, CSRF on sensitive actions, permissive CORS, containers running as root.' },
              { cls: 'badge-low',   label: 'LOW',      desc: 'Defense-in-depth issues: debug mode in production, stack traces exposed in error responses, missing HTTPS enforcement.' },
              { cls: 'badge-pat',   label: 'INFO',     desc: 'Observations worth noting: missing security headers, low-exploitability CVEs in dependencies.' },
            ].map((s) => (
              <div className="how-badge-row" key={s.label}>
                <span className={`how-badge ${s.cls}`}>{s.label}</span>
                <div className="how-badge-desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Limitations */}
        <div className="how-section">
          <div className="how-section-title">Limitations</div>
          <div className="how-limits">
            {[
              { icon: '🔒', text: 'Only public repositories can be analyzed. Private repos require admin access.' },
              { icon: '⏱', text: 'Analysis takes 3–10 minutes. Each file is analyzed sequentially to stay within API rate limits.' },
              { icon: '📄', text: 'Files are analyzed individually, not as a whole system. Cross-file data flow vulnerabilities may be missed.' },
              { icon: '🔍', text: 'CodeQL, Secret Scanning, and Dependabot results only appear if the repository owner has enabled these features on GitHub.' },
              { icon: '⚠️', text: 'Pattern scan findings (PATTERN badge) may include false positives. Always verify with the actual code before reporting.' },
              { icon: '🎓', text: 'For educational and authorized security research only. Do not use to attack systems you do not own.' },
            ].map((l, i) => (
              <div className="how-limit-row" key={i}>
                <span className="how-limit-icon">{l.icon}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}
