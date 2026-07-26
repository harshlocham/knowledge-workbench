# Knowledge Workbench

NotebookLM-style research assistant: create notebooks, add sources (PDF, text, websites, YouTube, VTT), ask grounded questions, and jump from citations back into the original material.

**Architecture (diagrams):** [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)

## Stack

- **TanStack Start** + Router (file routes, server functions)
- **React 19** + Tailwind 4 + shadcn/Radix
- **Clerk** auth
- **PostgreSQL** + Drizzle (metadata, chunk text, chat)
- **Qdrant** (embeddings)
- **OpenAI** (embeddings + chat)

## Quick start (local Bun)

```bash
bun install
cp .env.example .env.local
bun run db:migrate
bun run dev
```

App: [http://localhost:3000](http://localhost:3000).

## Deploy on VPS (app + Caddy + Qdrant)

The VPS runs **app**, **Caddy** (HTTPS), and **Qdrant** on the same Docker network so vector upserts stay local (fast). Postgres stays **external** (Neon/Supabase/etc). The app is not published on the host — only Caddy exposes `80` / `443`. Qdrant is not exposed publicly.

### 1. Prepare managed Postgres + storage

- Create a Postgres database and copy its connection string → `DATABASE_URL`
- Prefer **S3 or Cloudflare R2** for uploads (`S3_*`) so files survive container rebuilds
- Point your domain’s **A/AAAA** records at the VPS

### 2. On the VPS

```bash
git clone <your-repo> && cd knowledge-workbench
cp .env.example .env
# Set DOMAIN, Clerk, OPENAI_API_KEY, DATABASE_URL
# QDRANT_URL is overridden by compose to http://qdrant:6333 — leave Cloud blank

# Open firewall: 80 and 443 (not 3000 / not 6333)
docker compose -f docker-compose.prod.yml up --build -d
```

Migrations run automatically on app container start. Caddy issues a Let’s Encrypt cert for `DOMAIN`.

**Migrating off Qdrant Cloud:** after deploy, re-index each source (or remove and re-add). Vectors do not copy from Cloud automatically.

```bash
docker compose -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.prod.yml down
```

### 3. Clerk

In Clerk, add `https://your.domain.com` to allowed origins / redirect URLs.

### Scripts

| Command | Purpose |
|---------|---------|
| `bun run dev` | Dev server (port 3000) |
| `bun run build` / `start` | Production build & run (without Docker) |
| `bun run db:migrate` | Apply migrations (also runs in container entrypoint) |
| `bun run eval:rag` | Run tiny RAG retrieval regression checks |

## How it works (short)

```mermaid
flowchart LR
  Sources[Add sources] --> Index[Extract → chunk → embed]
  Index --> Store[(Postgres + Qdrant)]
  Ask[Ask question] --> Retrieve[Hybrid retrieve + rerank]
  Retrieve --> Answer[Streamed grounded answer + citations]
  Answer --> Viewer[Open source viewer]
```

Full diagrams: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Environment

| Variable | Notes |
|----------|--------|
| `DOMAIN` | Caddy site address (auto HTTPS via Let’s Encrypt) |
| `VITE_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Required; publishable key is baked at **image build** time |
| `DATABASE_URL` | External Postgres |
| `QDRANT_URL` / `QDRANT_API_KEY` | Local: `http://127.0.0.1:6333`. Prod compose forces `http://qdrant:6333` and clears the API key |
| `OPENAI_API_KEY` | Required |
| `S3_*` | Recommended on VPS instead of local disk |

## License

Private project.
