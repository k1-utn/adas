# ADAS — OEM Collision Repair Intelligence Platform

Assistive OEM repair intelligence software for North American collision repair. Decodes
VINs, ingests CCC/Mitchell/Audatex estimates, detects OEM-required calibrations, scans,
resets, and aiming procedures, and generates insurer-ready supplement documentation — with
confidence scoring, OEM source traceability, and a full audit trail.

> **Positioning:** Every recommendation is advisory, confidence-scored, traceable to an OEM
> source, and requires human verification. The platform never presents an operation as
> guaranteed.

## Architecture at a glance

The defining decision: **the deterministic rules engine is the source of truth; the LLM
agents only normalize input and explain output.** Insurers contest AI output; they contest a
documented, versioned OEM rule far less. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
apps/
  api/        NestJS — REST API, RBAC guards, BullMQ queue, estimate worker, PDF reports
  web/        Next.js frontend (scaffold — not yet built)
packages/
  shared/     Zod contracts + domain vocabulary shared across all layers
  ai/         Rules engine + 6-agent pipeline + confidence scoring (TESTED)
  db/         Prisma schema + seed
```

## What's built and verified

- `packages/shared` — domain types + Zod schemas. **Typechecks clean.**
- `packages/ai` — calibration rules engine, six-agent orchestrated pipeline, deterministic
  confidence scoring. **Typechecks clean; 4/4 tests pass.**
- `packages/db` — complete Prisma schema (orgs, shops, users+RBAC, VIN records, estimates,
  line items, calibration rules, requirements, OEM procedures + pgvector RAG, reports,
  immutable ProcessingStep trace, append-only AuditLog) + seed.
- `apps/api` — Prisma service, Clerk-ready auth + RBAC guards, audit service, NHTSA VIN
  decoder, BullMQ queue + worker, estimates service/controller, insurer PDF report
  generator. **Typechecks clean against real NestJS/Prisma/BullMQ/pdfkit.**
- `apps/web` — Next.js estimator workspace: VIN decode, estimate upload, requirements view
  with confidence lamps, insurer report download. "Workshop instrument" dark theme.
  **Typechecks clean and `next build` succeeds.**

## Not yet built

- Real OCR integration (the worker has the integration point stubbed)
- Real OpenAI/Anthropic providers (a deterministic stub keeps everything runnable now)
- Stripe billing, WebSocket job-progress gateway, role-management UI

## Getting started

Prerequisites: Node 20+, PostgreSQL (with the `vector` extension), Redis.

```bash
npm install

# Database
cp .env.example .env          # then edit DATABASE_URL
npm run db:generate
npm run db:migrate
npm run db:seed               # loads the calibration ruleset + a demo org

# Run
npm run dev --workspace @adas/api               # API on :3001
ADAS_ROLE=worker node apps/api/dist/worker.js   # worker (after build)

# Tests
npm test
```

## License

Proprietary — all rights reserved.

## Running the frontend

```bash
npm run dev --workspace @adas/web    # Next.js dev server on :3000
```

The dev API client (`apps/web/src/lib/api.ts`) uses a base64 "dev principal" token that
matches the seeded demo owner, so the full VIN → upload → requirements → report flow works
locally without standing up Clerk. Swap `getToken()` for the Clerk session token in
production.
