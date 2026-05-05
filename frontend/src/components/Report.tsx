import { useState } from 'react';
import { AnalysisReport, Severity } from '../types';
import ScoreRing from './ScoreRing';
import FindingCard from './FindingCard';

interface Props {
  report: AnalysisReport;
  repoUrl: string;
  onReset: () => void;
}

function generateReportMd(report: AnalysisReport, repoUrl: string): string {
  const date = new Date().toISOString().split('T')[0];
  const repoName = repoUrl.replace('https://github.com/', '');

  const statsTable = SEVERITY_ORDER
    .map((s) => `| ${s} | ${report.stats[s.toLowerCase() as keyof typeof report.stats]} |`)
    .join('\n');

  const findingsSections = report.findings.map((f) => {
    const loc = f.file + (f.line ? `:${f.line}` : '');
    const evidence = f.evidence ? `\n**Evidence:**\n\`\`\`\n${f.evidence}\n\`\`\`\n` : '';
    return `### ${f.id}: ${f.title}

| Field | Value |
|-------|-------|
| **Severity** | ${f.severity} |
| **CWE** | ${f.cwe} |
| **File** | \`${loc}\` |

**Description:** ${f.description}
${evidence}
**Recommendation:** ${f.recommendation}`;
  }).join('\n\n---\n\n');

  const positives = report.positives.map((p) => `- ${p}`).join('\n');
  const recommendations = report.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n');
  const files = report.filesAnalyzed.map((f) => `- \`${f}\``).join('\n');

  return `# Security Report: ${repoName}

| | |
|-|-|
| **Score** | ${report.score}/100 |
| **Language** | ${report.language} |
| **Date** | ${date} |
| **Repository** | ${repoUrl} |

## Summary

${report.summary}

## Statistics

| Severity | Count |
|----------|-------|
${statsTable}

## Findings

${report.findings.length === 0 ? '_No findings._' : findingsSections}

## Security Positives

${report.positives.length === 0 ? '_None identified._' : positives}

## Priority Recommendations

${report.recommendations.length === 0 ? '_None._' : recommendations}

## Files Analyzed

${files}
`;
}

function downloadReportMd(report: AnalysisReport, repoUrl: string) {
  const content = generateReportMd(report, repoUrl);
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const repoName = repoUrl.replace('https://github.com/', '').replace('/', '-');
  a.download = `security-report-${repoName}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

const SEVERITY_COLORS: Record<Severity, string> = {
  CRITICAL: '#ff4560',
  HIGH: '#ff7043',
  MEDIUM: '#ffd600',
  LOW: '#00d4ff',
  INFO: '#4a6080',
};

const styles = `
  .report { display: flex; flex-direction: column; gap: 24px; }

  .report-top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .btn-new {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 8px 20px;
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
  }

  .btn-new:hover { border-color: var(--accent); color: var(--accent); }

  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 28px;
  }

  .panel-title {
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-bottom: 20px;
  }

  .overview-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 32px;
    align-items: start;
  }

  @media (max-width: 600px) {
    .overview-grid { grid-template-columns: 1fr; }
  }

  .overview-right { display: flex; flex-direction: column; gap: 16px; }

  .summary-text {
    font-size: 14px;
    color: var(--text);
    line-height: 1.8;
  }

  .stats-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .stat-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
    font-family: 'Space Mono', monospace;
    border: 1px solid transparent;
  }

  .language-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(0,212,255,0.08);
    border: 1px solid rgba(0,212,255,0.25);
    color: var(--accent);
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 11px;
    letter-spacing: 0.08em;
  }

  .filter-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }

  .filter-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 5px 14px;
    border-radius: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.2s;
    letter-spacing: 0.06em;
  }

  .filter-btn.active {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(0,212,255,0.08);
  }

  .findings-list { display: flex; flex-direction: column; gap: 10px; }

  .empty-findings {
    text-align: center;
    color: var(--muted);
    font-size: 13px;
    padding: 40px;
  }

  .positives-list { display: flex; flex-direction: column; gap: 10px; }

  .positive-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 13px;
    color: var(--text);
    line-height: 1.6;
  }

  .positive-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--green);
    margin-top: 6px;
    flex-shrink: 0;
    box-shadow: 0 0 6px rgba(0,255,136,0.5);
  }

  .rec-list { display: flex; flex-direction: column; gap: 10px; counter-reset: rec; }

  .rec-item {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    font-size: 13px;
    color: var(--text);
    line-height: 1.6;
    counter-increment: rec;
  }

  .rec-num {
    min-width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(0,212,255,0.1);
    border: 1px solid rgba(0,212,255,0.3);
    color: var(--accent);
    font-size: 11px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-family: 'Syne', sans-serif;
  }

  .files-toggle {
    cursor: pointer;
    font-size: 12px;
    color: var(--muted);
    text-decoration: underline;
    background: none;
    border: none;
    font-family: var(--font-mono);
    padding: 0;
  }

  .files-toggle:hover { color: var(--accent); }

  .files-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }

  .file-chip {
    background: rgba(0,0,0,0.3);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--muted);
    font-family: 'Space Mono', monospace;
  }
`;

export default function Report({ report, repoUrl, onReset }: Props) {
  const [severityFilter, setSeverityFilter] = useState<Severity | 'ALL'>('ALL');
  const [filesOpen, setFilesOpen] = useState(false);

  const filteredFindings = severityFilter === 'ALL'
    ? report.findings
    : report.findings.filter((f) => f.severity === severityFilter);

  return (
    <>
      <style>{styles}</style>
      <div className="report">
        <div className="report-top-bar">
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 18, color: '#fff' }}>
            Security Report
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-new" onClick={() => downloadReportMd(report, repoUrl)}>↓ Export Report</button>
            <button className="btn-new" onClick={onReset}>← New Analysis</button>
          </div>
        </div>

        {/* Overview */}
        <div className="panel">
          <div className="panel-title">Overview</div>
          <div className="overview-grid">
            <ScoreRing score={report.score} />
            <div className="overview-right">
              <div className="language-tag">
                <span>⚙</span> {report.language}
              </div>
              <p className="summary-text">{report.summary}</p>
              <div className="stats-row">
                {SEVERITY_ORDER.map((sev) => {
                  const count = report.stats[sev.toLowerCase() as keyof typeof report.stats];
                  if (count === 0) return null;
                  const color = SEVERITY_COLORS[sev];
                  return (
                    <div
                      key={sev}
                      className="stat-badge"
                      style={{ background: `${color}14`, borderColor: `${color}40`, color }}
                    >
                      <span style={{ fontSize: 16 }}>{count}</span>
                      <span style={{ fontSize: 10, letterSpacing: '0.08em' }}>{sev}</span>
                    </div>
                  );
                })}
                {Object.values(report.stats).every((v) => v === 0) && (
                  <div className="stat-badge" style={{ background: 'rgba(0,255,136,0.1)', borderColor: 'rgba(0,255,136,0.3)', color: '#00ff88' }}>
                    <span>✓</span> No issues found
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Findings */}
        <div className="panel">
          <div className="panel-title">Findings ({report.findings.length})</div>

          <div className="filter-row">
            <button
              className={`filter-btn${severityFilter === 'ALL' ? ' active' : ''}`}
              onClick={() => setSeverityFilter('ALL')}
            >
              All
            </button>
            {SEVERITY_ORDER.map((sev) => {
              const count = report.findings.filter((f) => f.severity === sev).length;
              if (count === 0) return null;
              return (
                <button
                  key={sev}
                  className={`filter-btn${severityFilter === sev ? ' active' : ''}`}
                  onClick={() => setSeverityFilter(sev)}
                  style={severityFilter === sev ? { borderColor: SEVERITY_COLORS[sev], color: SEVERITY_COLORS[sev], background: `${SEVERITY_COLORS[sev]}14` } : {}}
                >
                  {sev} ({count})
                </button>
              );
            })}
          </div>

          {filteredFindings.length > 0 ? (
            <div className="findings-list">
              {filteredFindings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </div>
          ) : (
            <div className="empty-findings">No findings for this filter.</div>
          )}
        </div>

        {/* Positives */}
        {report.positives.length > 0 && (
          <div className="panel">
            <div className="panel-title">Security Positives</div>
            <div className="positives-list">
              {report.positives.map((p, i) => (
                <div key={i} className="positive-item">
                  <div className="positive-dot" />
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top Recommendations */}
        {report.recommendations.length > 0 && (
          <div className="panel">
            <div className="panel-title">Priority Recommendations</div>
            <div className="rec-list">
              {report.recommendations.map((r, i) => (
                <div key={i} className="rec-item">
                  <div className="rec-num">{i + 1}</div>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Files Analyzed */}
        <div className="panel">
          <div className="panel-title" style={{ marginBottom: 0 }}>
            Files Analyzed ({report.filesAnalyzed.length})
            &nbsp;&nbsp;
            <button className="files-toggle" onClick={() => setFilesOpen((v) => !v)}>
              {filesOpen ? 'hide' : 'show'}
            </button>
          </div>
          {filesOpen && (
            <div className="files-grid">
              {report.filesAnalyzed.map((f) => (
                <span key={f} className="file-chip">{f}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
