# Forge — Hypertrophy Training

A full-stack hypertrophy training tracker: log workouts, track sets/reps/RIR, follow templates and a training split, monitor muscle recovery and fatigue trends, and get AI coaching suggestions. Includes multi-user accounts with an admin panel for user management.

## Tech Stack

- **Frontend:** React + Vite + Tailwind CSS + shadcn/ui + TanStack Query + wouter (routing)
- **Backend:** Express (Node.js)
- **Database:** SQLite via `better-sqlite3` + Drizzle ORM
- **Auth:** Custom username/password auth with `scrypt` password hashing (Node's built-in `crypto`)

## Project Structure

```
client/       React frontend (pages, components, hooks)
server/       Express backend (routes, storage/DB layer, auth)
shared/       Shared TypeScript types and Drizzle schema (used by both client & server)
script/       Build scripts
scripts/      Misc utility scripts
```

## Local Development

Requires Node.js 18+.

```bash
npm install
npm run dev
```

This starts the Express backend and Vite dev server together on **port 5000**. Open http://localhost:5000.

On first run, the SQLite database (`data.db`) is created automatically in the project root with the correct schema — no manual migration step needed.

### First login / admin access

Sign up for a new account from the login screen ("Create one"). If you sign up with the exact name **"Derek"** (case-insensitive) and no other account in the database is currently an admin, that account is automatically granted admin rights on the next server restart — this makes the admin panel (user management, password resets) available in Settings. This is a one-time bootstrap; once any admin exists, it no longer applies.

If you don't want this behavior, remove `bootstrapAdminIfNoneExists()` in `server/storage.ts` and grant admin manually via a database edit (`UPDATE users SET is_admin = 1 WHERE name = 'YourName';`).

## Building for Production

```bash
npm run build
```

This builds the frontend (Vite → `dist/public`) and bundles the backend (`dist/index.cjs`).

## Running in Production

```bash
NODE_ENV=production node dist/index.cjs
```

Serves both the API and the built frontend on port 5000 (configurable via the `PORT` env var if you modify `server/index.ts`).

## Deploying Elsewhere (Vercel, Railway, Fly.io, a VPS, etc.)

This is a standard Node.js + Express app with a file-based SQLite database, so it deploys like any Node app:

1. Run `npm install && npm run build` on the host (or in CI).
2. Start it with `NODE_ENV=production node dist/index.cjs`.
3. Make sure the process has a **persistent writable directory** for `data.db` — on platforms with ephemeral filesystems (e.g. some serverless/edge runtimes), attach a persistent volume or switch to a hosted database (e.g. Postgres via a small Drizzle adapter change) for durable multi-user data.
4. Set `NODE_ENV=production` and expose the port the app listens on (5000 by default).

## Notes

- The SQLite database file (`data.db`) is intentionally excluded from git (see `.gitignore`) — it holds real user data and is created fresh on first run.
- No API keys or secrets are required for the core app. If you wire up the AI coaching feature to a real LLM provider, add your key via environment variables (never commit it) and update `.env.example` accordingly.
