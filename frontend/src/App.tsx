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

  .app { min-height: 100vh; display: flex; flex-direction: column; }

  .header {
    border-bottom: 1px solid var(--border);
    padding: 20px 40px;
    display: flex;
    align-items: center;
    gap: 16px;
    background: var(--panel);
  }

  .header-icon {
    width: 36px; height: 36px;
    background: linear-gradient(135deg, var(--accent), #0080ff);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; flex-shrink: 0;
  }

  .header-title {
    font-family: var(--font-display);
    font-size: 20px; font-weight: 700; color: #fff; letter-spacing: -0.02em;
  }

  .header-sub { font-size: 11px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }

  .main { flex: 1; padding: 48px 40px; max-width: 1100px; margin: 0 auto; width: 100%; }

  .hero { text-align: center; margin-bottom: 48px; }

  .hero h1 {
    font-family: var(--font-display);
    font-size: clamp(28px, 5vw, 48px); font-weight: 800; color: #fff;
    line-height: 1.1; letter-spacing: -0.03em; margin-bottom: 16px;
  }

  .hero h1 span {
    background: linear-gradient(90deg, var(--accent), var(--green));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  }

  .hero p { color: var(--muted); font-size: 15px; max-width: 520px; margin: 0 auto; }

  .error-box {
    background: rgba(255,69,96,0.08); border: 1px solid rgba(255,69,96,0.3);
    border-radius: 12px; padding: 32px; text-align: center;
    max-width: 520px; margin: 80px auto;
  }

  .error-box h2 { font-family: var(--font-display); font-size: 20px; color: var(--red); margin-bottom: 12px; }
  .error-box p { color: var(--muted); font-size: 13px; margin-bottom: 24px; }

  .btn-retry {
    background: transparent; border: 1px solid var(--border); color: var(--text);
    padding: 10px 24px; border-radius: 8px; font-family: var(--font-mono);
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
          <div className="header-icon">🔐</div>
          <div>
            <div className="header-title">GitHub Security Analyzer</div>
            <div className="header-sub">Powered by GPT-4o · GitHub Models · OWASP</div>
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
  .how { max-width: 720px; margin: 48px auto 0; display: flex; flex-direction: column; gap: 32px; }

  .how-section {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 28px;
  }

  .how-section-title {
    font-family: 'Syne', sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
    letter-spacing: 0.12em;
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

  .how-step {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  .how-step-num {
    width: 28px; height: 28px;
    border-radius: 50%;
    background: rgba(0,212,255,0.1);
    border: 1px solid rgba(0,212,255,0.3);
    color: var(--accent);
    font-size: 12px;
    font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    font-family: 'Syne', sans-serif;
  }

  .how-step-content { flex: 1; }

  .how-step-title {
    font-size: 14px;
    font-weight: 700;
    color: #fff;
    font-family: 'Syne', sans-serif;
    margin-bottom: 4px;
  }

  .how-step-desc { font-size: 12px; color: var(--muted); line-height: 1.7; }

  .how-badges { display: flex; flex-direction: column; gap: 12px; }

  .how-badge-row {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }

  .how-badge {
    flex-shrink: 0;
    border-radius: 5px;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    font-family: 'Syne', sans-serif;
    white-space: nowrap;
    margin-top: 1px;
  }

  .badge-ai    { background: rgba(0,212,255,0.1); color: var(--accent); border: 1px solid rgba(0,212,255,0.3); }
  .badge-pat   { background: rgba(74,96,128,0.2); color: var(--muted);  border: 1px solid rgba(74,96,128,0.3); }
  .badge-crit  { background: rgba(255,69,96,0.1); color: var(--red);    border: 1px solid rgba(255,69,96,0.3); }
  .badge-high  { background: rgba(255,112,67,0.1);color: var(--orange); border: 1px solid rgba(255,112,67,0.3); }
  .badge-med   { background: rgba(255,214,0,0.1); color: var(--yellow); border: 1px solid rgba(255,214,0,0.3); }
  .badge-low   { background: rgba(0,212,255,0.08);color: var(--accent); border: 1px solid rgba(0,212,255,0.2); }

  .how-badge-desc { font-size: 12px; color: var(--muted); line-height: 1.7; }
  .how-badge-desc strong { color: var(--text); }

  .how-limits { display: flex; flex-direction: column; gap: 8px; }
  .how-limit-row { display: flex; gap: 10px; font-size: 12px; color: var(--muted); line-height: 1.6; }
  .how-limit-icon { flex-shrink: 0; }
`;

function HowItWorks() {
  return (
    <>
      <style>{howStyles}</style>
      <div className="how">

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
