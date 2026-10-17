# Who2Ask

A new hire describes a problem in plain words. Who2Ask finds the right colleague to ask, explains why, checks when they are free, and drafts the message. The new hire sends it themselves. All company data is synthetic.

## Run locally

```
pnpm install
cp .env.example .env.local      # DATABASE_URL points at the docker database on port 5433
pnpm db:up                      # Postgres 17 with pgvector
pnpm db:reset                   # drop, migrate and load the synthetic company (local only)
pnpm dev
```

Open http://localhost:3000. Press Ctrl+` for the debug log.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js |
| `pnpm check` | typecheck plus the UI rules checker |
| `pnpm db:up` / `db:down` | start or stop local Postgres |
| `pnpm db:generate` / `db:migrate` / `db:studio` | Drizzle |
| `pnpm db:reset [seed]` | drop everything, migrate, seed; logs counts per table (refuses non-local hosts without `ALLOW_DB_RESET=1`) |
| `pnpm seed [seed]` | reload the synthetic company only; accounts are kept |
| `pnpm fixture:generate [seed] [--no-model]` | rebuild `fixtures/company.json` (model text if `ANTHROPIC_API_KEY` is set, templates otherwise) |
| `pnpm seed:check` | offline check of the fixture against its planted scenarios |

## Deploying

Set `DATABASE_URL` to a Neon pooled connection string in Vercel, run `pnpm db:migrate` against it once, then `pnpm seed` (or the Reseed button on `/admin/seed`, admins only in production).

See `CLAUDE.md` for the rules and architecture, and `DEBUGGING.md` for logging.
