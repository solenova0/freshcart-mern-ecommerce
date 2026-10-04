# Architecture, Maintenance, and Scaling

## Ownership Boundaries

| Area | Responsibility | Change verification |
| --- | --- | --- |
| `server/src/routes` | HTTP contracts, authorization, orchestration | Corresponding route tests in `server/test` |
| `server/src/auth` | Session policy, tokens, input schemas | Auth and auth-primitives tests |
| `server/src/catalog` | Catalog schemas and image ownership | Catalog and catalog-validation tests |
| `server/src/commerce` | Money, inventory, transactions, checkout schemas | Commerce, commerce-rules, and payments tests |
| `server/src/models` | Persistence invariants and indexes | Models tests and staging Atlas checks |
| `server/src/services` | External email, image, and payment integrations | Adapter tests plus provider staging checks |
| `storefront/src` / `admin/src` | Customer / operator experiences | Built-asset Playwright workflows |
| `packages/design-system` | Shared tokens, components, Tailwind preset | Both frontend builds and accessibility checks |

Keep business rules in the owning domain, not duplicated in React or generic middleware. Routes validate inputs and enforce ownership; browser validation is only a usability aid. Tests use injected adapters to isolate failures. They do not establish real database transaction or provider guarantees.

## Consistency and Security Decisions

- Prices and totals are computed on the server in minor units; orders snapshot products and delivery addresses.
- Atlas transactions coordinate cart consumption, inventory, and orders. Card orders reserve inventory before payment; signed completion commits stock once. Never mark an order paid from the browser redirect.
- JWTs live in HttpOnly cookies. Authorization checks current database roles and session versions. Keep credentialed origins explicit and use sibling HTTPS domains for reliable cookies.
- Cloudinary and Stripe cannot commit atomically with MongoDB. Idempotency reduces duplicate effects, but durable recovery is still a production prerequisite.
- React Query owns remote data. Preserve the active `me` observer when clearing private caches after authentication changes.

## Contributor Workflow

1. Use Node 24 LTS and run `npm ci` at the repository root. Configure local workspace environments using the README; never commit `.env` files.
2. Make a focused branch and put tests beside the affected server domain or in the existing browser workflow suite. Add schema/model changes only with a documented data migration plan.
3. Run `npm run validate`. Install Chromium once with `npx playwright install chromium`; Linux CI installs its system dependencies too.
4. Document changed environment variables, API behavior, and operational risks. Open a pull request with the behavior change, test evidence, and rollback plan.
5. Enable GitHub branch protection for both quality-check jobs. Restrict production provider access and require manual review of production releases; Vercel previews must use a separate test API.

CI runs backend tests and builds on the minimum supported Node version and the full release gate on Node 24. Runtime dependency auditing is a release gate, not a substitute for reviewing development tooling or provider security.

## Scaling Roadmap

The current deployment is one API process and MongoDB Atlas. It is not load-tested and has no claimed throughput, availability SLA, or multi-instance rate-limit guarantee. Preserve the modular monolith until measured bottlenecks justify more services.

| Order | Trigger | Required change | Acceptance evidence |
| --- | --- | --- | --- |
| 1 | Public transactional launch | Durable reconciliation worker/outbox for uncertain Stripe reservations and Cloudinary cleanup | Crash/retry tests; stuck-reservation alerts; recovery drill |
| 2 | Multiple API instances | Shared Redis-backed rate-limit counters and edge abuse controls | Requests through two instances obey one limit; datastore failure policy tested |
| 3 | Network-retry-sensitive checkout | COD request idempotency keys with unique persistence constraints | Replayed request returns the original order, including concurrent retries |
| 4 | Catalog/query latency grows | Record query latency; inspect Atlas query plans; tune bounded indexes | Representative seeded-data p95 latency and index evidence |
| 5 | Database connection pressure | Bound per-instance pools and instance counts; add backpressure | Load test respects Atlas connection limits; no overselling under contention |
| 6 | Financial operations become live | Refund/dispute events, admin audit trail, recovery and MFA | Provider replay tests and reviewed financial reconciliation workflow |

Use a separate staging database and Stripe test mode for all drills. Do not add caching to stock or payment decisions without a consistency design. Catalog read caching may be introduced with explicit TTL/invalidation and no customer-specific content in shared cache keys.

## Operations and Rollback

- Monitor `/api/ready` for database availability, not only `/api/health` for process liveness. Track request latency, 5xx rate, webhook failures, uncertain reservations, pool saturation, and provider quota failures.
- Never log cookies, JWTs, verification tokens, secrets, full provider payloads, or customer addresses. Add structured request correlation and redaction before exporting logs.
- Deploy to staging first and complete the [deployment checklist](DEPLOYMENT.md). Record the Git commit, provider deployment IDs, environment changes, and schema changes for each release.
- Roll back Vercel apps and the Render API to compatible prior deployments. Rolling back code does not undo database writes or Stripe payments. Prefer additive, backward-compatible schema migrations; back up and test restores before destructive changes.
- If payment state is uncertain, stop retrying new sessions, identify the order/session in Stripe and Atlas, and reconcile through reviewed tooling. Do not manually decrement stock or blindly replay payments. The automated repair worker is not implemented yet.
- Test backup restores on an isolated database, document recovery objectives, and re-run authorization/checkout smoke checks after restoration. Provider costs, backup retention, and uptime targets depend on the chosen plans.