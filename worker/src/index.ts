// ═══════════════════════════════════════════════════════════════════
// GitHub Security Analyzer — Cloudflare Worker
//
// Endpoints:
//   POST /get-files        → returns scored file list for a repo
//   POST /analyze-file     → analyzes ONE file (pattern scan + gpt-4o)
//   POST /filter-findings  → deduplicates + generates final report
// ═══════════════════════════════════════════════════════════════════

export interface Env { GITHUB_TOKEN: string }

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const ANALYSIS_MODEL  = 'gpt-4o';
const REPORT_MODEL    = 'gpt-4o-mini';
const GITHUB_MODELS_URL = 'https://models.inference.ai.azure.com/chat/completions';

const MAX_CANDIDATES  = 80;    // max files returned by /get-files
const MAX_FILE_CHARS  = 20_000; // per-file content limit (~5k tokens)
const RATE_WINDOW_MS       = 60_000;
const RATE_MAX_SESSION     = 5;   // /get-files and /filter-findings (start/end of analysis)
const RATE_MAX_FILE        = 200; // /analyze-file (sequential, legitimate high volume)

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SEC_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'none'",
};

// ─── FILE DISCOVERY ───────────────────────────────────────────────────────────

const RELEVANT_EXTS = new Set([
  '.js', '.ts', '.jsx', '.tsx',
  '.py', '.java', '.go', '.rb', '.php', '.cs', '.rs',
  '.kt', '.swift', '.c', '.cpp', '.h',
  '.env', '.yml', '.yaml', '.json', '.sh', '.tf', '.toml', '.xml',
]);

const IGNORED_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', 'vendor', '__pycache__',
  '.next', '.nuxt', 'coverage', 'tmp', 'cache',
]);

const SKIP_RE = [
  /\.spec\.[jt]sx?$/i,  /\.test\.[jt]sx?$/i,
  /\/(tests?|specs?|__tests__|__mocks__|fixtures|mocks|cypress|e2e)\//i,
  /\/codefixes\//i, /\/hacking-instructor\//i,
  /\.github\/(ISSUE_TEMPLATE|DISCUSSION_TEMPLATE|FUNDING\.yml|labeler\.yml)/i,
  /CHANGELOG/i,  /\.(md|txt)$/i,
  /\.(stories|module|routing)\.[jt]sx?$/i,
];

const PATH_SCORES: [RegExp, number][] = [
  [/\/(auth|login|oauth|session|password|credential)[^/]*\./i, 5],
  [/\/(admin|management|internal)[^/]*\./i,                    4],
  [/\/(route|router|routes|controller|handler|endpoint)[^/]*\./i, 3],
  [/\/(user|account|profile)[^/]*\./i,                         3],
  [/\/(model|schema|entity|db|query)[^/]*\./i,                 2],
  [/\/(upload|file|storage)[^/]*\./i,                          2],
  [/\/(config|settings|env|secret)[^/]*\./i,                   2],
  [/\/(middleware|interceptor|guard)[^/]*\./i,                  2],
  [/\.github\/workflows\//i,                                    2],
  [/dockerfile|docker-compose/i,                                2],
  [/requirements\.txt|go\.mod|package\.json|Gemfile$/i,         1],
  [/\/(test|spec|__tests__|fixture|mock)/i,                    -4],
];

function isRelevantFile(path: string): boolean {
  const parts = path.split('/');
  if (parts.some((p) => IGNORED_DIRS.has(p))) return false;
  if (SKIP_RE.some((r) => r.test(path))) return false;
  const dot = path.lastIndexOf('.');
  if (dot === -1) {
    const name = parts[parts.length - 1].toLowerCase();
    return ['dockerfile', 'makefile', 'jenkinsfile', 'procfile'].includes(name);
  }
  return RELEVANT_EXTS.has(path.slice(dot).toLowerCase());
}

function scoreFilePath(path: string): number {
  let s = 0;
  for (const [re, v] of PATH_SCORES) if (re.test(path)) { s += v; break; }
  return s;
}

async function fetchFile(owner: string, repo: string, path: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`,
      { headers: { 'User-Agent': 'github-security-analyzer/1.0' } },
    );
    if (!r.ok) return null;
    return (await r.text()).slice(0, MAX_FILE_CHARS);
  } catch { return null; }
}

async function fetchTree(owner: string, repo: string): Promise<{ path: string; type: string }[]> {
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
    { headers: { 'User-Agent': 'github-security-analyzer/1.0', Accept: 'application/vnd.github+json' } },
  );
  if (r.status === 404) throw new Error('REPO_NOT_FOUND');
  if (r.status === 403 || r.status === 429) throw new Error('GITHUB_RATE_LIMIT');
  if (!r.ok) throw new Error('GITHUB_ERROR');
  const data = await r.json() as { tree: { path: string; type: string }[] };
  return data.tree;
}

// ─── PATTERN RULES ────────────────────────────────────────────────────────────

interface PatternRule {
  re: RegExp;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  cwe: string;
  description: string;
  recommendation: string;
}

const PATTERN_RULES: PatternRule[] = [
  // SQL Injection — covers Sequelize/raw .query() with template literals (Juice Shop pattern)
  {
    re: /\.(query|raw)\s*\(\s*`[^`]*\$\{/,
    title: 'SQL Injection via Template Literal in Query',
    severity: 'CRITICAL', cwe: 'CWE-89',
    description: '[Pattern Match] Raw SQL query with string interpolation via template literal. User input can be injected directly into the query.',
    recommendation: 'Use parameterized queries: model.query("SELECT ... WHERE email = ?", { replacements: [email] })',
  },
  // General SQL injection
  {
    re: /\.raw\s*\(|\.rawQuery\s*\(|execute\s*\(\s*[`'"].*\$\{|execute\s*\(\s*f['"]/,
    title: 'Raw SQL Query with String Interpolation',
    severity: 'CRITICAL', cwe: 'CWE-89',
    description: '[Pattern Match] Raw SQL query with string interpolation found. User input allows SQL injection.',
    recommendation: 'Use parameterized queries or ORM with bound parameters.',
  },
  // Hardcoded secrets — general (covers Juice Shop defaultSecret)
  {
    re: /\w*[Ss]ecret\w*\s*=\s*['"`][^'"`\s]{8,}/,
    title: 'Hardcoded Secret',
    severity: 'CRITICAL', cwe: 'CWE-798',
    description: '[Pattern Match] Hardcoded secret value found in source code. Attackers can extract and use it to forge tokens or bypass auth.',
    recommendation: 'Move to environment variable: process.env.SECRET_KEY',
  },
  // JWT weak secret
  {
    re: /jwt\.sign\s*\([^,]+,\s*['"`][^'"`]{1,30}['"`]/,
    title: 'Weak or Hardcoded JWT Secret',
    severity: 'CRITICAL', cwe: 'CWE-347',
    description: '[Pattern Match] JWT signed with a short or hardcoded secret. Can be brute-forced to forge tokens.',
    recommendation: 'Use a randomly generated secret of at least 256 bits from an environment variable.',
  },
  // eval
  {
    re: /eval\s*\(/,
    title: 'eval() Usage',
    severity: 'HIGH', cwe: 'CWE-78',
    description: '[Pattern Match] eval() found. If called with user input this allows arbitrary code execution.',
    recommendation: 'Remove eval(). Use JSON.parse() for data or explicit function maps.',
  },
  // XSS via innerHTML
  {
    re: /innerHTML\s*=(?!=)|dangerouslySetInnerHTML/,
    title: 'Potential XSS via innerHTML',
    severity: 'HIGH', cwe: 'CWE-79',
    description: '[Pattern Match] innerHTML assignment found. User input here causes XSS.',
    recommendation: 'Use textContent or sanitize with DOMPurify before assigning.',
  },
  // Command injection
  {
    re: /child_process|\.exec\s*\(|\.spawn\s*\(/,
    title: 'Shell Command Execution',
    severity: 'HIGH', cwe: 'CWE-78',
    description: '[Pattern Match] Command execution via child_process found. User input here allows command injection.',
    recommendation: 'Avoid shell:true. Use execFile() with a fixed binary and array arguments.',
  },
  // Python deserialization
  {
    re: /pickle\.loads?\s*\(|yaml\.load\s*\((?!.*Loader)/,
    title: 'Insecure Deserialization',
    severity: 'CRITICAL', cwe: 'CWE-502',
    description: '[Pattern Match] pickle.load() or yaml.load() without safe Loader. Allows RCE via crafted payloads.',
    recommendation: 'Use yaml.safe_load(). Never deserialize untrusted data with pickle.',
  },
  // Hardcoded API keys/passwords
  {
    re: /password\s*=\s*['"`][^'"`\s]{4,}/i,
    title: 'Hardcoded Password',
    severity: 'HIGH', cwe: 'CWE-798',
    description: '[Pattern Match] Literal password assignment found in source code.',
    recommendation: 'Move credentials to environment variables or a secrets manager.',
  },
  {
    re: /(?:api[_-]?key|access[_-]?token)\s*=\s*['"`][A-Za-z0-9_\-]{8,}/i,
    title: 'Hardcoded API Key',
    severity: 'HIGH', cwe: 'CWE-798',
    description: '[Pattern Match] Hardcoded API key or access token found in source code.',
    recommendation: 'Move to environment variables and rotate any exposed keys immediately.',
  },
  // Weak crypto — MD5 for passwords (Juice Shop uses this)
  {
    re: /createHash\s*\(\s*['"`]md5['"`]\)|\.md5\s*\(/i,
    title: 'Weak MD5 Hash',
    severity: 'HIGH', cwe: 'CWE-327',
    description: '[Pattern Match] MD5 used for hashing. MD5 is cryptographically broken and unsuitable for passwords or integrity checks.',
    recommendation: 'Use bcrypt, argon2, or scrypt for passwords. Use SHA-256+ for integrity.',
  },
  // TLS disabled
  {
    re: /verify\s*=\s*False|verify=False/,
    title: 'TLS Certificate Verification Disabled',
    severity: 'MEDIUM', cwe: 'CWE-295',
    description: '[Pattern Match] verify=False disables TLS certificate validation, enabling MITM attacks.',
    recommendation: 'Remove verify=False.',
  },
  // subprocess shell=True
  {
    re: /subprocess.*shell\s*=\s*True|shell\s*=\s*True.*subprocess/,
    title: 'subprocess with shell=True',
    severity: 'HIGH', cwe: 'CWE-78',
    description: '[Pattern Match] subprocess with shell=True. User input allows command injection.',
    recommendation: 'Use shell=False and pass arguments as a list.',
  },
  // Django debug / wildcard hosts
  {
    re: /DEBUG\s*=\s*True/,
    title: 'Django DEBUG Mode Enabled',
    severity: 'MEDIUM', cwe: 'CWE-215',
    description: '[Pattern Match] DEBUG=True exposes stack traces in production.',
    recommendation: 'Set DEBUG=False via environment variable in production.',
  },
  // CORS wildcard
  {
    re: /cors\s*\(\s*\{[^}]*origin\s*:\s*['"`]\*['"`]/,
    title: 'CORS Wildcard Origin',
    severity: 'MEDIUM', cwe: 'CWE-942',
    description: '[Pattern Match] CORS configured to allow all origins.',
    recommendation: 'Restrict origin to a specific allowlist.',
  },
  // Path traversal
  {
    re: /readFile.*req\.|req\..*readFile|path\.join.*req\./,
    title: 'Potential Path Traversal',
    severity: 'HIGH', cwe: 'CWE-22',
    description: '[Pattern Match] File read with request-derived path. May allow reading arbitrary files.',
    recommendation: 'Validate and sanitize file paths. Use path.basename() and restrict to allowed directories.',
  },
  // SSTI
  {
    re: /render_template_string\s*\(/,
    title: 'Server-Side Template Injection Risk',
    severity: 'CRITICAL', cwe: 'CWE-94',
    description: '[Pattern Match] render_template_string() found. User input in the template allows RCE.',
    recommendation: 'Use render_template() with static templates only.',
  },
];

function isDefinitionContext(line: string): boolean {
  const t = line.trim();
  // Our own pattern description strings
  if (t.includes('[Pattern Match]')) return true;
  // Object key-value definition lines (re:, title:, description:, etc.)
  if (/^(re:|title:|description:|recommendation:|cwe:)/.test(t)) return true;
  // Comment lines
  if (/^(\/\/|#|\s*\*|\*)/.test(t)) return true;
  // Line is entirely a string literal — documentation, checklist items, array strings
  if (/^['"`]/.test(t)) return true;
  // JSX/HTML text content — match is inside rendered text, not executable code
  if (/^<[a-zA-Z]/.test(t)) return true;
  // Contains "(e.g." — example/documentation text
  if (t.includes('(e.g.') || t.includes('e.g.,') || t.includes('e.g. ')) return true;
  return false;
}

function scanForPatternFindings(file: { path: string; content: string }): RawFinding[] {
  const results: RawFinding[] = [];
  const seen = new Set<string>();
  for (const rule of PATTERN_RULES) {
    if (seen.has(rule.title)) continue;
    const match = rule.re.exec(file.content);
    if (!match) continue;
    seen.add(rule.title);
    const line = file.content.slice(0, match.index).split('\n').length;
    const snippet = file.content.split('\n')[line - 1]?.trim().slice(0, 120) ?? null;

    // Skip if match is inside a definition, comment, or string describing the pattern
    if (snippet && isDefinitionContext(snippet)) continue;

    results.push({
      title: rule.title, severity: rule.severity,
      file: file.path, line,
      description: rule.description,
      evidence: snippet,
      recommendation: rule.recommendation,
      cwe: rule.cwe,
    });
  }
  return results;
}

// ─── LANGUAGE CONTEXT ─────────────────────────────────────────────────────────

const LANG_CHECKLISTS: Record<string, string[]> = {
  javascript: [
    'eval() / Function() with user input → RCE (CWE-78)',
    'SQL built with template literals or concatenation → injection (CWE-89)',
    'innerHTML / dangerouslySetInnerHTML with user data → XSS (CWE-79)',
    'JWT secret hardcoded or short (CWE-347)',
    'path.join() with req.params/query without validation → path traversal (CWE-22)',
    'child_process.exec() with user input → command injection (CWE-78)',
  ],
  typescript: [
    'eval() / Function() with user input → RCE (CWE-78)',
    'SQL built with template literals or string concatenation → injection (CWE-89)',
    'JWT secret hardcoded or short (CWE-347)',
    'req.params/query used in file paths without validation → path traversal (CWE-22)',
    'innerHTML with user data → XSS (CWE-79)',
  ],
  python: [
    'pickle.loads() / yaml.load() without safe Loader → RCE (CWE-502)',
    'subprocess with shell=True and user input → command injection (CWE-78)',
    'eval() / exec() with user input → RCE (CWE-78)',
    'Django: DEBUG=True, ALLOWED_HOSTS=[*], SECRET_KEY hardcoded (CWE-215/798)',
    'SQLAlchemy raw queries with f-strings → SQL injection (CWE-89)',
    'render_template_string() with user input → SSTI (CWE-94)',
    'hashlib.md5/sha1 for passwords → weak crypto (CWE-327)',
  ],
  go: [
    'os/exec Command with user input → command injection (CWE-78)',
    'fmt.Sprintf() in SQL queries → injection (CWE-89)',
    'Hardcoded JWT secrets (CWE-347)',
  ],
  java: [
    'Runtime.exec() with user input → command injection (CWE-78)',
    'ObjectInputStream.readObject() → insecure deserialization (CWE-502)',
    'JDBC string concatenation → SQL injection (CWE-89)',
    'XXE via DocumentBuilderFactory without disabling external entities (CWE-611)',
  ],
  ruby: ['system() / exec() with user input → RCE (CWE-78)', 'YAML.load() → RCE (CWE-502)'],
  php: ['eval() / include() with user input → RCE (CWE-78/98)', 'PDO without prepared statements → SQLi (CWE-89)'],
  yaml: [
    'CI/CD: secrets in run: steps → credential exposure (CWE-312)',
    'pull_request_target with untrusted checkout → code injection (CWE-94)',
    'Third-party actions at mutable ref → supply chain risk (CWE-1104)',
  ],
};

function buildLanguageContext(files: { path: string }[]): string {
  const extMap: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', go: 'go', java: 'java', rb: 'ruby', php: 'php',
    rs: 'rust', kt: 'java', yml: 'yaml', yaml: 'yaml',
  };
  const langs = new Set<string>();
  for (const f of files) {
    const ext = f.path.split('.').pop()?.toLowerCase() ?? '';
    if (extMap[ext]) langs.add(extMap[ext]);
    if (/dockerfile/i.test(f.path)) langs.add('docker');
  }
  const sections = [...langs].map((lang) => {
    const list = LANG_CHECKLISTS[lang];
    return list ? `**${lang[0].toUpperCase() + lang.slice(1)}:**\n${list.map((c) => `- ${c}`).join('\n')}` : null;
  }).filter(Boolean);
  return sections.length ? `Security checklist for this file's language:\n${sections.join('\n\n')}` : '';
}

// ─── GITHUB SECURITY APIs ─────────────────────────────────────────────────────

function mapGHSeverity(sev?: string): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO' {
  switch ((sev ?? '').toLowerCase()) {
    case 'critical': return 'CRITICAL';
    case 'high':     return 'HIGH';
    case 'medium':   return 'MEDIUM';
    case 'low':      return 'LOW';
    default:         return 'INFO';
  }
}

async function queryGitHubSecurity(owner: string, repo: string, token: string): Promise<RawFinding[]> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'github-security-analyzer/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const get = async (path: string) => {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/${path}`, { headers });
    if (!r.ok) return [];
    return r.json();
  };
  const [codeScan, secretScan, dependabot] = await Promise.allSettled([
    get('code-scanning/alerts?state=open&per_page=100'),
    get('secret-scanning/alerts?state=open&per_page=20'),
    get('dependabot/alerts?state=open&per_page=100'),
  ]);
  const findings: RawFinding[] = [];

  if (codeScan.status === 'fulfilled' && Array.isArray(codeScan.value)) {
    for (const a of codeScan.value as {
      rule: { id: string; name: string; severity?: string };
      most_recent_instance: { location: { path: string; start_line: number }; message: { text: string } };
    }[]) {
      findings.push({
        title: `[CodeQL] ${a.rule.name}`,
        severity: mapGHSeverity(a.rule.severity),
        file: a.most_recent_instance.location.path,
        line: a.most_recent_instance.location.start_line,
        description: `[GitHub Code Scanning] ${a.most_recent_instance.message.text}`,
        evidence: null,
        recommendation: 'Fix as indicated by CodeQL. See GitHub Security tab for full details.',
        cwe: `CodeQL: ${a.rule.id}`,
      });
    }
  }
  if (secretScan.status === 'fulfilled' && Array.isArray(secretScan.value)) {
    for (const a of secretScan.value as { secret_type_display_name: string; locations_url: string }[]) {
      let file = 'See GitHub Secret Scanning alerts';
      try {
        const locs = await fetch(a.locations_url, { headers }).then((r) => r.ok ? r.json() : []) as { details?: { path?: string } }[];
        if (locs[0]?.details?.path) file = locs[0].details.path;
      } catch { /* skip */ }
      findings.push({
        title: `[Secret Scanning] Exposed ${a.secret_type_display_name}`,
        severity: 'CRITICAL', file, line: null,
        description: `[GitHub Secret Scanning] A ${a.secret_type_display_name} was found exposed in this repository.`,
        evidence: null,
        recommendation: 'Immediately revoke and rotate the credential. Remove from git history using git-filter-repo.',
        cwe: 'CWE-798: Use of Hard-coded Credentials',
      });
    }
  }
  if (dependabot.status === 'fulfilled' && Array.isArray(dependabot.value)) {
    for (const a of dependabot.value as {
      security_advisory: { cve_id: string | null; summary: string; severity: string };
      security_vulnerability: { package: { name: string }; vulnerable_version_range: string };
      dependency: { manifest_path: string };
    }[]) {
      const cve = a.security_advisory.cve_id ? `${a.security_advisory.cve_id}: ` : '';
      findings.push({
        title: `[Dependabot] ${a.security_vulnerability.package.name} vulnerable`,
        severity: mapGHSeverity(a.security_advisory.severity),
        file: a.dependency.manifest_path, line: null,
        description: `[GitHub Dependabot] ${cve}${a.security_advisory.summary} (${a.security_vulnerability.vulnerable_version_range})`,
        evidence: null,
        recommendation: `Update ${a.security_vulnerability.package.name} to a patched version.`,
        cwe: a.security_advisory.cve_id ?? 'Dependency Vulnerability',
      });
    }
  }
  return findings;
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface RawFinding {
  id?: string; title?: string; severity?: string; file?: string;
  line?: number | null; description?: string; evidence?: string | null;
  recommendation?: string; cwe?: string;
}

interface AnalysisReport {
  summary: string; score: number; language: string;
  stats: Record<string, number>; findings: RawFinding[];
  positives: string[]; recommendations: string[]; filesAnalyzed: string[];
}

// ─── AI LAYER ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior web application security engineer. Find REAL, EXPLOITABLE vulnerabilities only.

Only report when: (1) the vulnerability exists in the actual code shown, (2) user-controlled input can reach the vulnerable sink, (3) the impact is direct (RCE, data breach, auth bypass, privilege escalation).

Do NOT report: unpinned versions, missing comments, code style, theoretical risks without code evidence.

Focus on OWASP Top 10: injection (SQL/command/SSTI), XSS, broken auth, IDOR, path traversal, insecure deserialization, hardcoded secrets, SSRF, CSRF, security misconfiguration.`;

async function callModel(system: string, user: string, token: string, model: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(GITHUB_MODELS_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });
    if (res.status === 401 || res.status === 403) throw new Error('AUTH_FAILED');
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP_${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json() as { choices: { message: { content: string } }[] };
    return data.choices[0].message.content;
  } finally { clearTimeout(tid); }
}

async function analyzeFileWithAI(
  owner: string, repo: string,
  file: { path: string; content: string },
  langCtx: string,
  token: string,
): Promise<RawFinding[]> {
  const prompt = `Analyze this file from "${owner}/${repo}" for security vulnerabilities.
${langCtx ? `\n${langCtx}\n` : ''}
File: ${file.path}
\`\`\`
${file.content}
\`\`\`

Return ONLY valid JSON:
{"findings": [{"title": "...", "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO", "file": "${file.path}", "line": null, "description": "...", "evidence": "exact code snippet or null", "recommendation": "...", "cwe": "CWE-XXX: Name"}]}

If no real vulnerabilities found: {"findings": []}`;

  const raw = await callModel(SYSTEM_PROMPT, prompt, token, ANALYSIS_MODEL, 25_000);
  const parsed = JSON.parse(raw) as { findings?: RawFinding[] };
  return Array.isArray(parsed.findings) ? parsed.findings : [];
}

// ─── UTILITY ──────────────────────────────────────────────────────────────────

function titleSimilarity(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  const wa = words(a); const wb = words(b);
  const inter = [...wa].filter((w) => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : inter / union;
}

function mergeAndDedupe(findings: RawFinding[]): RawFinding[] {
  const kept: RawFinding[] = [];
  for (const f of findings) {
    const dup = kept.some((k) => k.file === f.file && titleSimilarity(k.title ?? '', f.title ?? '') > 0.4);
    if (!dup) kept.push(f);
  }
  return kept;
}

function buildFinalReport(findings: RawFinding[], filesAnalyzed: string[]): AnalysisReport {
  const ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  findings.sort((a, b) => ORDER.indexOf(a.severity ?? 'INFO') - ORDER.indexOf(b.severity ?? 'INFO'));
  findings.forEach((f, i) => { f.id = `SEC-${String(i + 1).padStart(3, '0')}`; });
  const stats = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    const k = (f.severity ?? 'INFO').toLowerCase() as keyof typeof stats;
    if (k in stats) stats[k]++;
  }
  const deductions = stats.critical * 25 + stats.high * 15 + stats.medium * 8 + stats.low * 3 + stats.info;
  const score = Math.max(0, 100 - deductions);
  return { summary: '', score, language: '', stats, findings, positives: [], recommendations: [], filesAnalyzed };
}

// ─── HTTP HELPERS ─────────────────────────────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string, key: string, max: number): boolean {
  const mapKey = `${ip}::${key}`;
  const now = Date.now();
  const e = rateLimitMap.get(mapKey);
  if (!e || now - e.windowStart > RATE_WINDOW_MS) { rateLimitMap.set(mapKey, { count: 1, windowStart: now }); return false; }
  if (e.count >= max) return true;
  e.count++; return false;
}

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, ...SEC_HEADERS, 'Content-Type': 'application/json' },
  });
}

function err(message: string, status: number): Response { return jsonRes({ error: message }, status); }

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.replace(/^\//, '').replace(/\/$/, '').split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
  } catch { return null; }
}

// ─── ENDPOINT HANDLERS ────────────────────────────────────────────────────────

// POST /get-files — returns scored file list for sequential analysis
async function handleGetFiles(request: Request, _env: Env): Promise<Response> {
  const body = await request.json() as { repoUrl?: string };
  if (typeof body.repoUrl !== 'string') return err('repoUrl is required', 400);
  const parsed = parseGitHubUrl(body.repoUrl.trim());
  if (!parsed) return err('Invalid GitHub repository URL', 400);
  const { owner, repo } = parsed;

  let tree: { path: string; type: string }[];
  try {
    tree = await fetchTree(owner, repo);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'REPO_NOT_FOUND') return err('Repository not found or is private', 404);
    if (msg === 'GITHUB_RATE_LIMIT') return err('GitHub rate limit reached', 429);
    return err('Failed to fetch repository', 502);
  }

  const files = tree
    .filter((f) => f.type === 'blob' && isRelevantFile(f.path))
    .map((f) => ({ path: f.path, score: scoreFilePath(f.path) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);

  return jsonRes({ owner, repo, files });
}

// POST /analyze-file — analyzes a single file with pattern scan + gpt-4o
async function handleAnalyzeFile(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { owner?: string; repo?: string; path?: string };
  if (!body.owner || !body.repo || !body.path) return err('owner, repo, and path are required', 400);

  const content = await fetchFile(body.owner, body.repo, body.path);
  if (!content) return jsonRes({ findings: [], skipped: true });

  const file = { path: body.path, content };

  // Pattern scan always runs
  const patternFindings = scanForPatternFindings(file);

  // AI analysis with gpt-4o
  const langCtx = buildLanguageContext([file]);
  let aiFindings: RawFinding[] = [];
  try {
    aiFindings = await analyzeFileWithAI(body.owner, body.repo, file, langCtx, env.GITHUB_TOKEN);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'AUTH_FAILED') return err('AI authentication failed. Check GITHUB_TOKEN.', 500);
    // On rate limit or other error, still return pattern findings
  }

  // Merge: AI findings take priority, supplement with pattern findings
  const merged = [...aiFindings];
  for (const pf of patternFindings) {
    const dup = merged.some((f) => f.file === pf.file && titleSimilarity(f.title ?? '', pf.title ?? '') > 0.4);
    if (!dup) merged.push(pf);
  }

  return jsonRes({ findings: merged, file: body.path });
}

// POST /filter-findings — deduplicates findings + generates final report with summary
async function handleFilterFindings(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    owner?: string; repo?: string;
    findings?: RawFinding[];
    filesAnalyzed?: string[];
  };

  const allFindings = mergeAndDedupe(body.findings ?? []);
  const filesAnalyzed = body.filesAnalyzed ?? [];

  // Also fetch GitHub Security findings if owner/repo provided
  let ghFindings: RawFinding[] = [];
  if (body.owner && body.repo) {
    ghFindings = await queryGitHubSecurity(body.owner, body.repo, env.GITHUB_TOKEN).catch(() => []);
    for (const gf of ghFindings) {
      const dup = allFindings.some((f) => f.file === gf.file && titleSimilarity(f.title ?? '', gf.title ?? '') > 0.4);
      if (!dup) allFindings.push(gf);
    }
  }

  const report = buildFinalReport(allFindings, filesAnalyzed);

  // Use gpt-4o-mini to write summary + recommendations (small task, no code needed)
  if (allFindings.length > 0 && body.owner && body.repo) {
    const findingsList = allFindings.slice(0, 30).map((f) =>
      `- [${f.severity}] ${f.title} in ${f.file}`,
    ).join('\n');

    const summaryPrompt = `A security analysis of "${body.owner}/${body.repo}" found these vulnerabilities:\n${findingsList}\n\nReturn ONLY valid JSON:\n{"summary": "2-3 sentence executive summary", "language": "primary language", "positives": ["what the code does well security-wise"], "recommendations": ["top priority fix 1", "top priority fix 2", "top priority fix 3"]}`;

    try {
      const raw = await callModel(
        'You are a security report writer. Be concise and actionable.',
        summaryPrompt,
        env.GITHUB_TOKEN,
        REPORT_MODEL,
        15_000,
      );
      const meta = JSON.parse(raw) as { summary?: string; language?: string; positives?: string[]; recommendations?: string[] };
      if (meta.summary) report.summary = meta.summary;
      if (meta.language) report.language = meta.language;
      if (meta.positives) report.positives = meta.positives;
      if (meta.recommendations) report.recommendations = meta.recommendations;
    } catch { /* use defaults */ }
  }

  if (!report.summary) {
    report.summary = allFindings.length === 0
      ? `No security vulnerabilities were found in ${body.owner}/${body.repo}. The analyzed files appear to follow security best practices.`
      : `Found ${allFindings.length} security issue(s) in ${body.owner}/${body.repo} across ${filesAnalyzed.length} analyzed files.`;
  }

  return jsonRes(report);
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return err('Method not allowed', 405);

    const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';
    const { pathname } = new URL(request.url);

    // /analyze-file is called once per file in a sequential session — allow high volume
    const rateLimit = pathname === '/analyze-file' ? RATE_MAX_FILE : RATE_MAX_SESSION;
    if (isRateLimited(ip, pathname, rateLimit)) return err('Too many requests. Please wait a minute.', 429);

    try {
      if (pathname === '/get-files')       return handleGetFiles(request, env);
      if (pathname === '/analyze-file')    return handleAnalyzeFile(request, env);
      if (pathname === '/filter-findings') return handleFilterFindings(request, env);
      return err('Not found', 404);
    } catch {
      return err('Internal server error', 500);
    }
  },
};
