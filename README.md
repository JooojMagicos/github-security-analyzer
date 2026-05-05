# GitHub Security Analyzer

A web application that analyzes public GitHub repositories for security vulnerabilities using AI (Llama 3.3 70B via Groq).

## Architecture

```
[Frontend - React/Vite]  →  [Cloudflare Worker]  →  [Groq API - Llama 3.3 70B]
        ↓                            ↓
  Displays report          Fetches files from GitHub
                           + calls AI model
```

## Requirements

- Node.js 18+
- Free [Cloudflare account](https://cloudflare.com)
- Free [Groq account](https://console.groq.com) — get your API key there

## Getting Started

### 1. Install dependencies

```bash
npm install
cd frontend && npm install && cd ..
cd worker && npm install && cd ..
```

### 2. Set up the Groq API key

```bash
cd worker
npx wrangler secret put GROQ_API_KEY
# Paste your key when prompted
cd ..
```

For local development, create `worker/.dev.vars`:
```
GROQ_API_KEY=your_key_here
```

### 3. Run locally

```bash
# Terminal 1 — Worker (localhost:8787)
cd worker && npx wrangler dev

# Terminal 2 — Frontend (localhost:5173)
cd frontend && npm run dev
```

Or run both at once from the root:
```bash
npm run dev
```

## Deploy

### Deploy the Worker

```bash
cd worker && npx wrangler deploy
```

Note the deployed URL (e.g. `https://github-security-analyzer.your-subdomain.workers.dev`).

### Deploy the Frontend

Update `VITE_WORKER_URL` in `frontend/.env.production` with your worker URL, then:

```bash
cd frontend && npm run build
npx wrangler pages deploy dist --project-name github-security-analyzer
```

## Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `GROQ_API_KEY` | Worker secret | Your Groq API key from console.groq.com |
| `VITE_WORKER_URL` | Frontend `.env.production` | Deployed worker URL for production |

## Features

- Analyzes up to 15 files per repository
- Supports JS, TS, Python, Go, Ruby, PHP, Java, C#, YAML, Terraform, and more
- Security findings with severity levels (Critical / High / Medium / Low / Info)
- CWE classification for each finding
- Security score (0–100)
- Expandable finding cards with code evidence
- Filter findings by severity
