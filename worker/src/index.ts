export interface Env {
  GROQ_API_KEY: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const RELEVANT_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rb', '.php',
  '.cs', '.env', '.yml', '.yaml', '.json', '.sh', '.tf', '.toml',
]);

const IGNORED_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', 'vendor', '__pycache__',
  '.next', '.nuxt', 'coverage', 'tmp', 'cache',
]);

const PRIORITY_PATTERNS = [
  /\.env$/i, /dockerfile/i, /docker-compose/i, /\.github\//i,
  /\.gitlab-ci/i, /requirements\.txt$/i, /package\.json$/i,
  /Gemfile$/i, /go\.mod$/i, /pom\.xml$/i, /build\.gradle$/i,
  /settings\.py$/i, /config\./i,
];

const MAX_FILES = 15;
const MAX_CHARS_PER_FILE = 4000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

// In-memory rate limiter (per isolate restart, sufficient for basic protection)
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count++;
  return false;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.replace(/^\//, '').replace(/\/$/, '').split('/');
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
  } catch {
    return null;
  }
}

interface GitHubTreeItem {
  path: string;
  type: string;
  size?: number;
}

interface GitHubTreeResponse {
  tree: GitHubTreeItem[];
  truncated: boolean;
}

function scoreFilePriority(path: string): number {
  const isPriority = PRIORITY_PATTERNS.some((p) => p.test(path));
  return isPriority ? 1 : 0;
}

function isRelevantFile(path: string): boolean {
  const segments = path.split('/');
  if (segments.some((s) => IGNORED_DIRS.has(s))) return false;

  const dotIndex = path.lastIndexOf('.');
  if (dotIndex === -1) {
    // No extension — keep Dockerfile, Makefile, etc.
    const name = segments[segments.length - 1].toLowerCase();
    return ['dockerfile', 'makefile', 'jenkinsfile', 'procfile'].includes(name);
  }

  const ext = path.slice(dotIndex).toLowerCase();
  return RELEVANT_EXTENSIONS.has(ext);
}

async function fetchFileContent(owner: string, repo: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`,
      { headers: { 'User-Agent': 'github-security-analyzer/1.0' } },
    );
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, MAX_CHARS_PER_FILE);
  } catch {
    return null;
  }
}

async function fetchRepoTree(owner: string, repo: string): Promise<GitHubTreeResponse> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
    {
      headers: {
        'User-Agent': 'github-security-analyzer/1.0',
        Accept: 'application/vnd.github+json',
      },
    },
  );

  if (res.status === 404) throw new Error('REPO_NOT_FOUND');
  if (res.status === 403 || res.status === 429) throw new Error('GITHUB_RATE_LIMIT');
  if (!res.ok) throw new Error('GITHUB_ERROR');

  return res.json() as Promise<GitHubTreeResponse>;
}

function buildSecurityPrompt(
  owner: string,
  repo: string,
  files: { path: string; content: string }[],
): string {
  const fileBlock = files
    .map((f) => `### File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');

  return `You are an expert security engineer performing a thorough security audit of the GitHub repository "${owner}/${repo}".

Analyze the following source files for security vulnerabilities, misconfigurations, and bad practices.

${fileBlock}

Return ONLY a single valid JSON object — no markdown, no explanation, no code fences — with exactly this structure:

{
  "summary": "Executive summary in 2-3 sentences describing the overall security posture.",
  "score": 70,
  "language": "primary language or framework",
  "stats": {
    "critical": 0,
    "high": 0,
    "medium": 0,
    "low": 0,
    "info": 0
  },
  "findings": [
    {
      "id": "SEC-001",
      "title": "Short descriptive title",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO",
      "file": "path/to/file.ext",
      "line": null,
      "description": "Clear description of the vulnerability.",
      "evidence": "relevant code snippet or null",
      "recommendation": "Specific actionable fix.",
      "cwe": "CWE-XXX: CWE Name"
    }
  ],
  "positives": ["Security positive 1", "Security positive 2"],
  "recommendations": ["Top priority recommendation 1", "Top priority recommendation 2"],
  "filesAnalyzed": ["list", "of", "file", "paths", "analyzed"]
}

Score: 0–100 (100 = perfect security). Deduct points per finding severity: Critical −25, High −15, Medium −8, Low −3, Info −1. Cap at 0.
stats must match the actual count of findings per severity.
findings must be ordered Critical → High → Medium → Low → Info.
Be thorough — look for: hardcoded secrets, injection vulnerabilities, insecure dependencies, weak crypto, IDOR, SSRF, path traversal, improper auth, exposed configs, CI/CD misconfigurations, supply chain risks.`;
}

async function callGroq(prompt: string, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      }),
    });

    if (res.status === 401) throw new Error('GROQ_AUTH');
    if (res.status === 429) throw new Error('GROQ_RATE_LIMIT');
    if (!res.ok) throw new Error('GROQ_ERROR');

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };

    return data.choices[0].message.content;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/analyze') {
      return errorResponse('Not found', 404);
    }

    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    // Rate limiting
    const clientIp =
      request.headers.get('CF-Connecting-IP') ??
      request.headers.get('X-Forwarded-For') ??
      'unknown';

    if (isRateLimited(clientIp)) {
      return errorResponse('Too many requests. Please wait a minute and try again.', 429);
    }

    let repoUrl: string;
    try {
      const body = (await request.json()) as { repoUrl?: unknown };
      if (typeof body.repoUrl !== 'string' || !body.repoUrl.trim()) {
        return errorResponse('repoUrl is required', 400);
      }
      repoUrl = body.repoUrl.trim();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return errorResponse('Invalid GitHub repository URL', 400);
    }

    const { owner, repo } = parsed;

    // Fetch file tree
    let tree: GitHubTreeResponse;
    try {
      tree = await fetchRepoTree(owner, repo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'REPO_NOT_FOUND') return errorResponse('Repository not found or is private', 404);
      if (msg === 'GITHUB_RATE_LIMIT') return errorResponse('GitHub rate limit reached. Try again in a few minutes.', 429);
      return errorResponse('Failed to fetch repository data', 502);
    }

    // Filter and prioritize files
    const relevantFiles = tree.tree
      .filter((item) => item.type === 'blob' && isRelevantFile(item.path))
      .sort((a, b) => scoreFilePriority(b.path) - scoreFilePriority(a.path))
      .slice(0, MAX_FILES);

    if (relevantFiles.length === 0) {
      return errorResponse('No analyzable source files found in this repository', 422);
    }

    // Fetch file contents in parallel
    const fileContents = await Promise.all(
      relevantFiles.map(async (f) => {
        const content = await fetchFileContent(owner, repo, f.path);
        return content ? { path: f.path, content } : null;
      }),
    );

    const validFiles = fileContents.filter((f): f is { path: string; content: string } => f !== null);

    if (validFiles.length === 0) {
      return errorResponse('Could not read any files from this repository', 422);
    }

    // Call Groq
    const prompt = buildSecurityPrompt(owner, repo, validFiles);
    let analysisJson: string;
    try {
      analysisJson = await callGroq(prompt, env.GROQ_API_KEY);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'GROQ_AUTH') return errorResponse('AI service authentication failed', 500);
      if (msg === 'GROQ_RATE_LIMIT') return errorResponse('AI service rate limit reached. Try again shortly.', 429);
      if (err instanceof DOMException && err.name === 'AbortError') {
        return errorResponse('Analysis timed out. Try a smaller repository.', 504);
      }
      return errorResponse('AI analysis service temporarily unavailable', 502);
    }

    // Parse and validate the JSON from the model
    let analysis: unknown;
    try {
      analysis = JSON.parse(analysisJson);
    } catch {
      return errorResponse('AI returned invalid response. Please try again.', 502);
    }

    return jsonResponse(analysis);
  },
};
