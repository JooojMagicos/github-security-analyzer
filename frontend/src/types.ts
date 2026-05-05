export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  file: string;
  line: number | null;
  description: string;
  evidence: string | null;
  recommendation: string;
  cwe: string;
}

export interface SecurityStats {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface AnalysisReport {
  summary: string;
  score: number;
  language: string;
  stats: SecurityStats;
  findings: Finding[];
  positives: string[];
  recommendations: string[];
  filesAnalyzed: string[];
}

export type AppState = 'idle' | 'loading' | 'done' | 'error';
