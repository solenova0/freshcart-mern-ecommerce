# Security Review

Review scope: server models/routes/auth/payment/uploads/seeds, frontend session/cache handling, dependencies, and deployment settings. This is a source review and automated test pass, not a penetration test or a claim of production certification. No live Atlas, Brevo, Cloudinary, Stripe, Render, or Vercel environment was exercised.

## Findings Requiring Launch Decisions

| Priority | Finding | Mitigation / status |
| --- | --- | --- |
| High | Paid Stripe refunds/disputes are not automated; a chargeback/refund will not update orders by itself. | Paid Stripe cancellation is rejected rather than faking a refund. Add authenticated refund handling and refund/dispute webhooks before relying on automated financial reconciliation. |
| High | A provider timeout after stock reservation can leave a reserved order whose session ID is not yet stored. Process crashes/extended outages also need reconciliation. | Retry uses the same Stripe idempotency key; normal expiry webhooks release stock. Add a durable reconciliation worker/outbox, alerting and an operator runbook for failed or orphaned reservations. Provider idempotency retention is finite; do not create a new session blindly for an old uncertain order. |
| High | `ageConfirmed` is a self-declaration, not age verification or merchant/legal eligibility. | Verify goods, jurisdiction, merchant restrictions, and age controls before selling restricted products. |
| Medium | Auth/upload/cart/payment limits use process-local memory. Multiple API instances do not share counters. | Add a shared store and edge abuse limits. Configure exact trusted proxy hops; do not set `trust proxy=true` indiscriminately. |
| Medium | Category deletion and product assignment check references in separate operations. | Add transactional/category-lock coordination for concurrent administrators if hard foreign-reference integrity is required. |
| Medium | Cloudinary deletion and MongoDB commits cannot be one transaction; provider deletion failure can leave old assets. | New URLs remain committed, cleanup failures are reported/logged, and replacement failures attempt cleanup. Add a durable deletion queue and retries. |
| Medium | COD order creation lacks an HTTP idempotency key across network retries. | Transactional cart clearing normally prevents duplicates, but a newly filled cart may produce another order. Add client request keys/unique indexes for stronger request-level guarantees. |
| Medium | Account recovery, MFA, breached-password checks, and administrator audit logs are absent. | Use private admin credentials and add these controls for public operational use. |
| Medium | Third-party cookie blocking can break unrelated Render/Vercel domains. | Use sibling HTTPS custom domains where possible; None/Secure alone cannot override browser privacy policy. |
| Low | Frontend CSP is not installed; current headers cover framing, sniffing and referrers. | Design and browser-test a CSP against the actual deployed assets and validation libraries; do not blindly enable a policy that breaks scripts. |

## Reviewed and Hardened Controls

- Passwords are hashed with bcrypt cost 12; UTF-8 byte-length validation prevents truncation. No plaintext passwords are stored.
- Verification links use random 32-byte tokens; only SHA-256 hashes/expiry are stored. Atomic consumption, cooldowns, rotation, and strict validation prevent ordinary replay.
- JWTs are kept in HttpOnly cookies rather than localStorage. Verification checks HS256, issuer, audience, expiry, subject and current account session version. Logout revokes all current sessions; authorization reads the current database role.
- Public user JSON excludes hashes, tokens, session versions and privileged internal fields. The seed is explicit, non-escalating, and refuses published demo credentials in production.
- None-cookie mutations require an explicit exact allowlisted Origin. Webhooks use provider signatures, not browser cookies. CORS never reflects arbitrary origins.
- Stripe's webhook uses raw bytes before JSON parsing, verifies signatures, validates order ownership/session/amount/currency, and changes payment/stock in one transaction. Duplicate/late events cannot deduct stock twice.
- Reservation stock is unavailable to other purchases. Admin stock changes/deletions are guarded against active reservations. Product version increments protect catalog writes from silently losing concurrent inventory changes.
- Client totals, roles, verification flags, image public IDs and foreign ownership filters are rejected by strict schemas. Checkout uses current server prices and safe decimal minor-unit arithmetic.
- Uploads are authorized before parsing, use bounded in-memory buffers, inspect file signatures, reject SVG/unexpected types, and use server-generated Cloudinary IDs. URLs are not used as deletion identifiers.
- React renders data as escaped text. No `dangerouslySetInnerHTML`, arbitrary script execution, or persisted browser JWTs are used. Auth observers remain active across login/logout while private cached queries are removed.
- Full error/provider objects are no longer logged on 5xx responses; production responses hide stacks. Secrets belong only in server environment configuration. Frontend referrer headers reduce verification-link leakage.

## Verification Evidence

- Server tests cover auth, total rounding, user isolation, COD rollback, status restrictions, signature verification, wrong payment amounts, duplicate completion, expiry/cancel, reservation ownership, upload limits and demo provisioning guards.
- Browser tests use explicit API fixtures to exercise actual React routing/forms/query caches; they are not live payment or database integration tests.
- Run `npm test`, `npm run test:browser`, `npm run lint`, `npm run build`, and `npm audit` after dependency changes. Dependency audit results are time-dependent and are not a permanent security guarantee.
- Validate real Atlas transactions, provider failure/replay paths and deployed cookie behavior using the deployment checklist before launch.