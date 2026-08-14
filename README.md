# Moral-Compass

Frém dashboard — Next.js 16 (App Router, TypeScript, Tailwind) on Supabase.

## Layout

| Path | What |
|---|---|
| `frem-dashboard/` | The Next.js app |
| `frem-dashboard/src/lib/supabase/` | Supabase clients (browser, server, admin) |
| `frem-dashboard/src/middleware.ts` | Session refresh + auth redirect |

## Setup

```bash
cd frem-dashboard
cp .env.example .env.local   # fill in from Supabase → Project Settings → API Keys
npm install
npm run dev
```

Supabase project ref: `okrthqfwzufwmcrqsmnp`

## Verify the connection

With the dev server running:

```bash
curl http://localhost:3000/api/health
```

Expect `"ok": true`, `"hasPublishableKey": true`, `"hasSecretKey": true`.

## Keys

`SUPABASE_SECRET_KEY` bypasses Row-Level Security and must never reach the
browser. It is read only by `src/lib/supabase/admin.ts`, which is marked
`server-only`. `.env.local` is gitignored — keep it that way.
