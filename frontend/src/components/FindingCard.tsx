import { useState } from 'react';
import { Finding, Severity } from '../types';

interface Props {
  finding: Finding;
}

const SEVERITY_CONFIG: Record<Severity, { color: string; bg: string; label: string }> = {
  CRITICAL: { color: '#ff4560', bg: 'rgba(255,69,96,0.1)',  label: 'CRITICAL' },
  HIGH:     { color: '#ff7043', bg: 'rgba(255,112,67,0.1)', label: 'HIGH'     },
  MEDIUM:   { color: '#ffd600', bg: 'rgba(255,214,0,0.1)',  label: 'MEDIUM'   },
  LOW:      { color: '#00d4ff', bg: 'rgba(0,212,255,0.1)',  label: 'LOW'      },
  INFO:     { color: '#4a6080', bg: 'rgba(74,96,128,0.1)',  label: 'INFO'     },
};

function generateMd(finding: Finding): string {
  const loc = finding.file + (finding.line ? `:${finding.line}` : '');
  const evidence = finding.evidence
    ? `\n## Evidence\n\`\`\`\n${finding.evidence}\n\`\`\`\n`
    : '';

  return `# ${finding.id}: ${finding.title}

| Field | Value |
|-------|-------|
| **Severity** | ${finding.severity} |
| **CWE** | ${finding.cwe} |
| **File** | \`${loc}\` |

## Description

${finding.description}
${evidence}
## Recommendation

${finding.recommendation}
`;
}

function downloadMd(finding: Finding) {
  const content = generateMd(finding);
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${finding.id}-${finding.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FindingCard({ finding }: Props) {
  const [expanded, setExpanded] = useState(false);
  const cfg = SEVERITY_CONFIG[finding.severity] ?? SEVERITY_CONFIG.INFO;

  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      style={{
        background: 'var(--panel)',
        border: `1px solid ${expanded ? cfg.color + '60' : 'var(--border)'}`,
        borderLeft: `3px solid ${cfg.color}`,
        borderRadius: 10,
        cursor: 'pointer',
        transition: 'border-color 0.2s',
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 20px',
        }}
      >
        <span
          style={{
            background: cfg.bg,
            color: cfg.color,
            border: `1px solid ${cfg.color}40`,
            borderRadius: 6,
            padding: '2px 8px',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            fontFamily: "'Syne', sans-serif",
            whiteSpace: 'nowrap',
          }}
        >
          {cfg.label}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#fff',
              fontFamily: "'Syne', sans-serif",
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {finding.title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {finding.file}{finding.line ? `:${finding.line}` : ''}
          </div>
        </div>

        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 10, letterSpacing: '0.05em' }}>{finding.id}</span>
          <span style={{ fontSize: 14, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div
          style={{ padding: '0 20px 20px', borderTop: `1px solid var(--border)` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16, marginBottom: 16 }}>
            <InfoBlock label="CWE" value={finding.cwe} />
            <InfoBlock label="File" value={finding.file + (finding.line ? `:${finding.line}` : '')} />
          </div>

          <Section label="Description">
            <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>{finding.description}</p>
          </Section>

          {finding.evidence && (
            <Section label="Evidence">
              <pre
                style={{
                  background: '#060a14',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '12px 16px',
                  fontSize: 12,
                  color: '#a8c4e0',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: "'Space Mono', monospace",
                  lineHeight: 1.6,
                }}
              >
                {finding.evidence}
              </pre>
            </Section>
          )}

          <Section label="Recommendation">
            <p style={{ fontSize: 13, color: 'var(--green)', lineHeight: 1.7 }}>{finding.recommendation}</p>
          </Section>

          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => downloadMd(finding)}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--muted)',
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: 11,
                fontFamily: "'Space Mono', monospace",
                cursor: 'pointer',
                letterSpacing: '0.05em',
                transition: 'border-color 0.2s, color 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)'; }}
            >
              ↓ Export .md
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: "'Space Mono', monospace" }}>{value}</div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}
