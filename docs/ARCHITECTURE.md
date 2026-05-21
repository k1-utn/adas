# ADAS — OEM Collision Repair Intelligence Platform

> **Positioning:** Assistive OEM repair intelligence software. Every recommendation is
> advisory, confidence-scored, traceable to an OEM source, and requires human verification.
> The platform never presents an operation as guaranteed.

---

## 1. System Overview

ADAS is a multi-tenant SaaS platform that ingests collision estimates (CCC, Mitchell,
Audatex), decodes the vehicle VIN, and uses a pipeline of AI agents plus a deterministic
rules engine to detect OEM-required calibrations, scans, resets, and aiming procedures.
It produces insurer-ready supplement documentation with full traceability.

The architecture deliberately separates **deterministic logic** (calibration rules,
compliance checks) from **probabilistic logic** (LLM extraction, classification). The
deterministic layer is the source of truth for what gets recommended; the AI layer is an
*input normalizer* and *explanation generator*. This separation is what makes the output
defensible.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Next.js    │────▶│  API (Nest)  │────▶│  PostgreSQL     │
│  Web (Vercel)│◀────│  REST + WS   │◀────│  + pgvector     │
└─────────────┘     └──────┬───────┘     └─────────────────┘
                           │
                  ┌────────┴────────┐
                  │  Job Queue      │  (BullMQ / Redis)
                  │  (AI + OCR jobs)│
                  └────────┬────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
  ┌───────────┐     ┌────────────┐    ┌──────────────┐
  │ OCR / PDF │     │ AI Agents  │    │ Rules Engine │
  │ pipeline  │     │ (LLM/RAG)  │    │ (deterministic)│
  └───────────┘     └────────────┘    └──────────────┘
                           │
                    ┌──────┴──────┐
                    │ Object store │  (S3-compatible)
                    └─────────────┘
```

### Why this shape

- **Queue-backed AI/OCR.** Estimate parsing and OEM RAG calls are slow and rate-limited.
  Running them in a queue keeps the API responsive, lets us retry, and gives us a natural
  place to record audit/trace metadata per job.
- **pgvector over a separate vector DB (for MVP).** One fewer system to operate. OEM
  procedure embeddings live next to relational data, so a procedure citation is a foreign
  key, not a cross-system join. We can graduate to a dedicated vector store later without
  changing the API contract.
- **Rules engine as source of truth.** Insurers contest AI output. They contest a
  documented OEM rule far less. The LLM proposes; the rules engine disposes.

---

## 2. AI Pipeline & Agent System

Six modular agents, orchestrated as a DAG per estimate. Each agent emits a typed result
plus trace metadata (model, prompt version, tokens, latency, confidence). Nothing an agent
produces is shown to a user without a confidence score and an OEM/source reference.

| # | Agent | Input | Output | Deterministic? |
|---|-------|-------|--------|----------------|
| 1 | **Estimate Parsing Agent** | OCR text + raw PDF | Normalized line items: parts, labor ops, impact zones | No (LLM extraction, schema-validated) |
| 2 | **OEM Procedure Agent** | VIN profile + detected systems | Retrieved OEM procedure chunks (RAG) | No (retrieval) |
| 3 | **Calibration Logic Agent** | Parsed items + VIN ADAS profile | Candidate calibration/scan/reset requirements | **Yes** (rules engine; LLM only explains) |
| 4 | **Insurer Supplement Agent** | Confirmed requirements + OEM refs | Draft supplement narrative | No (generation, templated) |
| 5 | **Compliance Validation Agent** | Full result set | Gaps, missed-op flags, contradictions | **Yes** (rules) + LLM cross-check |
| 6 | **Confidence Scoring Agent** | All agent traces | Per-item + overall confidence | **Yes** (formula over signals) |

### Orchestration

```
parse ──▶ vin-match ──▶ calibration-rules ──▶ compliance-check ──▶ confidence ──▶ supplement
   │            │              │ (LLM explains)        │
   └── OCR      └── VIN decode  └── OEM RAG (parallel) ─┘
```

Each step writes a `ProcessingStep` row (immutable) so the entire chain is replayable and
auditable. A failed step is retried up to N times; permanent failure surfaces as a
degraded-but-honest result, never a fabricated one.

### Confidence model (sketch)

```
confidence(item) = w1 * extraction_certainty   // parser logprob / schema match
                 + w2 * rule_match_strength     // exact OEM rule vs heuristic
                 + w3 * oem_source_quality       // direct OEM doc vs inferred
                 + w4 * vin_profile_completeness
```

Bands: `>= 0.85 high`, `0.6–0.85 medium`, `< 0.6 low / needs human review`. Low-confidence
items are flagged, never auto-included in a supplement.

---

## 3. Data Model (high level)

Tenancy is row-level: every domain table carries `organizationId`. Shops belong to orgs,
users belong to orgs with a role. Audit logs are append-only.

```
Organization 1──* Shop 1──* User
Organization 1──* Estimate 1──1 VinRecord
Estimate 1──* LineItem
Estimate 1──* CalibrationRequirement *──1 CalibrationRule
CalibrationRequirement *──* OemReference
Estimate 1──* InsurerReport
Estimate 1──* ProcessingStep        (immutable trace)
Organization 1──* AuditLog           (append-only)
OemProcedure 1──* OemProcedureChunk  (pgvector embedding)
```

See `packages/db/prisma/schema.prisma` for the full schema with confidence scoring,
subscription/billing (CAD + USD), and role-based access fields.

---

## 4. API Structure

REST under `/api/v1`, plus a WebSocket channel for live job progress.

```
POST   /auth/session                      session bootstrap (Clerk/Auth0 webhook-backed)
GET    /orgs/:id                          org + subscription
GET    /shops                             list shops in org
POST   /vin/decode            { vin }      VIN -> make/model/trim/year/ADAS profile
POST   /estimates             multipart    upload CCC/Mitchell/Audatex PDF -> job
GET    /estimates/:id                      estimate + parse status + results
GET    /estimates/:id/requirements         calibration/scan/reset requirements
GET    /estimates/:id/report               generate/fetch insurer defense PDF
POST   /estimates/:id/acknowledge          user verification of advisory output
GET    /procedures/:id                     OEM procedure + citations
GET    /audit                              audit log (admin)
WS     /jobs/:id                           live processing-step events
```

Every mutating endpoint writes an `AuditLog` entry. Every endpoint enforces org scoping +
role at the guard layer.

---

## 5. Folder Structure (monorepo)

```
adas/
  docs/                ARCHITECTURE.md, ROADMAP.md, this design
  apps/
    web/               Next.js + TS + Tailwind + shadcn/ui
    api/               NestJS + TS, REST + WS, guards, queue producers
  packages/
    db/                Prisma schema, migrations, seed (calibration rules + OEM refs)
    ai/                Agent definitions, prompts (versioned), RAG, confidence model
    shared/            Zod schemas, DTOs, domain types shared web<->api
  package.json         workspaces
```

A monorepo so the **types are shared end to end**: a calibration requirement is defined
once in `packages/shared`, validated by Zod, persisted by Prisma, and rendered by the web
app — no drift between layers.

---

## 6. MVP Roadmap

**Phase 1 (this scaffold):** auth + org/shop model, VIN decode, estimate upload + OCR,
parsing agent, calibration rules engine, OEM reference linking, confidence scoring,
insurer PDF report, audit logging.

**Phase 1.1:** subscription billing (Stripe, CAD/USD), role management UI, dark/light mode.

**Phase 2:** photo AI damage analysis, insurer/DRP integrations, calibration marketplace,
mobile, enterprise analytics.

---

## 7. Liability & Compliance Posture (non-negotiable)

- Every recommendation carries: confidence band, OEM source ref, retrieval timestamp,
  and the rule ID that produced it.
- UI copy is advisory throughout ("OEM verification required").
- Reports embed a legal disclaimer and require a user acknowledgement before finalizing.
- `ProcessingStep` + `AuditLog` are immutable and replayable — the defensibility backbone.
