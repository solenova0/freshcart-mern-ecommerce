# Deployment: Atlas, Render, and Vercel

Use Stripe test mode first. This guide describes deployment, not a claim of live payment verification. Read [the security review](SECURITY.md) before a public launch.

## Release Status: October 4, 2026

- GitHub repository is published and its first quality workflow passed.
- The [portfolio case study](https://solan-portfolio.vercel.app/case-study/freshcart) is published separately from the shop.
- Vercel projects `freshcart-storefront` and `freshcart-admin` are created with Node 24, workspace root directories, and parent-source inclusion. No commerce production deployment has been made; both need the configured public API URL.
- Render/Atlas/Brevo/Cloudinary setup and live integration verification are pending owner-side credential configuration. Enter secrets directly in provider dashboards, never in chat or Git.

## Repository and Release Automation

The intended GitHub destination is https://github.com/solenova0/freshcart-mern-ecommerce. The [quality workflow](../.github/workflows/ci.yml) checks Node 22.12 and 24, runs the browser gate on 24, and audits runtime dependencies. Protect `main` with both checks after the first workflow succeeds.

Import the repository as a Render **Blueprint** to use [render.yaml](../render.yaml), or configure the service manually below. The blueprint intentionally leaves provider secrets and deployment origins to the dashboard and generates a JWT secret. It selects a free demonstration service, which can sleep and is unsuitable for dependable payment webhooks; review costs and choose an always-on plan before accepting real orders. It does not provision Atlas, Brevo, Cloudinary, Stripe, or Vercel projects.

Set `API_PUBLIC_URL` to the Render service origin and enter the final Vercel origins in `STOREFRONT_URL` / `CORS_ORIGINS` before testing browser sessions. If project URLs are assigned during setup, update these values and redeploy after both frontend projects exist. Stripe is disabled until both secrets are added manually. Never seed the published administrator credentials into this deployment.

Deployments trigger only after repository checks pass in Render. Vercel deployment protection/approval is configured separately in its dashboard; a GitHub check alone does not prevent a Vercel deployment. Record real deployment URLs in the portfolio case study only after the post-deploy checklist passes.

## 1. MongoDB Atlas

1. Create an Atlas project and cluster. Atlas supports the multi-document transactions required by checkout and payment stock updates; a standalone local MongoDB server does not.
2. Create a database user with read/write access only to the `freshcart` database. Generate a unique password and do not commit it.
3. In Network Access, add the outbound IP ranges shown for your Render service. Add your current local IP temporarily if running seed commands locally. Avoid an unrestricted `0.0.0.0/0` production rule.
4. Copy the driver connection URI, URL-encode reserved characters in its password, and set the database name:

```text
mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/freshcart?retryWrites=true&w=majority
```

5. Enable backups appropriate to your plan. Use separate development/test and production databases.

## 2. Brevo and Cloudinary

1. Verify your sender in Brevo, preferably with SPF/DKIM for your domain. Obtain a transactional API key.
2. Obtain Cloudinary cloud name, API key, and API secret. Use a dedicated environment/account namespace and set `CLOUDINARY_FOLDER=freshcart` (or a production-specific prefix).
3. Keep all credentials on the API only. Check provider quotas and operational alerts.

## 3. API on Render

1. Push this monorepo to your Git provider. Create a Render Web Service using the repository.
2. Leave **Root Directory empty** so the root npm workspaces and lockfile are available.
3. Set Runtime to Node, Build Command to `npm ci`, Start Command to `npm start`, and Health Check Path to `/api/ready`.
4. Select a supported Node.js 24 LTS version; the repository includes `.nvmrc` with `24`. If overriding `NODE_VERSION`, use the latest supported Node 24 LTS patch.
5. Configure the following environment variables in Render's dashboard, not committed files. Render supplies `PORT`; do not hardcode a conflicting port.

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Atlas URI |
| `JWT_SECRET` | Locally generated random 32-byte-or-longer secret |
| `JWT_TTL_SECONDS` | `86400` (or your chosen shorter lifetime) |
| `API_PUBLIC_URL` | `https://YOUR-API.onrender.com` |
| `STOREFRONT_URL` | `https://YOUR-STOREFRONT.vercel.app` |
| `CORS_ORIGINS` | `https://YOUR-STOREFRONT.vercel.app,https://YOUR-ADMIN.vercel.app` |
| `COOKIE_SAME_SITE` | `none` for unrelated Render/Vercel sites |
| `TRUST_PROXY` | `1` for a verified single trusted ingress hop; confirm your proxy topology |
| `VERIFICATION_TOKEN_TTL_MINUTES` | `60` |
| `BREVO_API_KEY` | Transactional API key |
| `BREVO_SENDER_EMAIL` | Verified sender address |
| `BREVO_SENDER_NAME` | `FreshCart` |
| `CLOUDINARY_CLOUD_NAME` | Your cloud name |
| `CLOUDINARY_API_KEY` | Server API key |
| `CLOUDINARY_API_SECRET` | Server API secret |
| `CLOUDINARY_FOLDER` | `freshcart-production` |
| `STRIPE_SECRET_KEY` | Stripe test-mode secret initially |
| `STRIPE_WEBHOOK_SECRET` | Endpoint signing secret from Stripe |

6. Deploy. The API waits for database indexes before listening. Verify `/api/health` and `/api/ready` return 200 over HTTPS.
7. Restrict Atlas access to Render outbound ranges, ensure logs contain no credentials, and configure uptime alerts. For reliable webhooks, use a service plan that does not suspend unexpectedly.

## 4. Storefront on Vercel

1. Import the same Git repository as a separate Vercel project.
2. Set **Root Directory** to `storefront`, Framework Preset to Vite, Build Command to `npm run build`, Output Directory to `dist`.
3. Make the monorepo's parent lockfile/workspaces available using Vercel's option to include files outside the root directory. Use Install Command `cd .. && npm ci` if not automatically detected from the workspace lockfile.
4. Set `VITE_API_URL=https://YOUR-API.onrender.com/api` for Production. Set a separate test API URL for Preview environments; do not give untrusted PR previews access to production.
5. Deploy. [storefront/vercel.json](../storefront/vercel.json) rewrites extensionless React Router paths to `index.html` while preserving static assets, and adds basic security/referrer headers.
6. Open and refresh `/shop`, `/products/VALID_PRODUCT_ID`, `/login`, and `/verify-email`. Confirm network requests target the API's `/api` base.

## 5. Admin on Vercel

1. Create a second Vercel project from the same repository.
2. Set **Root Directory** to `admin`, Framework Preset to Vite, Build Command `npm run build`, Output Directory `dist`.
3. Use the same parent-lockfile install arrangement, and set `VITE_API_URL=https://YOUR-API.onrender.com/api`.
4. Deploy. [admin/vercel.json](../admin/vercel.json) includes React Router rewrites and basic security headers.
5. Refresh `/orders`, `/categories`, and `/products`. Logged-out users should be directed to `/login`; a customer session must not grant access.

Changing a `VITE_*` variable requires a rebuild. Never put Stripe secret keys, webhook secrets, Cloudinary secrets, Brevo keys, or JWT secrets into frontend variables.

## 6. Cookies, CORS, and Browsers

- Use `NODE_ENV=production` and `COOKIE_SAME_SITE=none` for unrelated Render/Vercel domains. Cookies will be `SameSite=None; Secure; HttpOnly`, host-only, scoped to `/api`. They cannot be used over HTTP.
- Both Axios clients send `withCredentials: true`. The API reflects only exact origins listed in `CORS_ORIGINS`, with credentials enabled; never use `*`.
- For None cookies, every protected browser mutation must send an allowlisted `Origin`. Browser Axios supplies it; manual `curl` mutation requests need `-H 'Origin: https://YOUR-STOREFRONT.vercel.app'`. The signed Stripe webhook does not use cookies/Origin auth.
- Some browsers block third-party cookies even with None/Secure. For dependable access, use sibling custom domains such as `shop.example.com`, `admin.example.com`, and `api.example.com`; these are same-site over HTTPS and may use `COOKIE_SAME_SITE=lax`. Update all origin/public URL variables and rebuild frontends.
- Do not set a cookie Domain covering the frontend hosts. The API's host-only cookie is sufficient. Do not broadly trust every proxy or every Vercel preview hostname.

## 7. Stripe Webhook

1. In Stripe test mode, create a webhook destination at:

```text
https://YOUR-API.onrender.com/webhooks/stripe
```

2. Select `checkout.session.completed` and `checkout.session.expired`. Only card Checkout is currently enabled; asynchronous payment methods are not supported.
3. Copy this endpoint's signing secret to Render `STRIPE_WEBHOOK_SECRET`; set the matching test-mode `STRIPE_SECRET_KEY`. Redeploy the API. These must both be populated or both blank (blank disables card payments).
4. Create a Stripe order from the storefront. The API reserves stock on session creation, uses server-side prices in USD, and redirects to Stripe's hosted Checkout.
5. Use Stripe's documented test card `4242 4242 4242 4242`, a future expiry, and any valid test CVC. Do not enter real card details in test mode.
6. Confirm the signed webhook is accepted, the order becomes paid, stock decreases once, and the reservation clears. A success redirect alone does not mark an order paid.
7. Resend the same event in Stripe's dashboard: stock/order state must not change again.
8. Test the Cancel path. Orders exposes an explicit Cancel payment action; it expires the provider session before releasing stock. A Stripe Cancel redirect alone leaves the session retryable. An expired-session webhook releases stock and cancels the pending order.
9. Before going live, confirm Stripe permits your products/jurisdiction, use separate live secrets and a live webhook destination, test refunds/disputes operationally, and follow the unresolved-risk list. Paid Stripe cancellation/refund automation is intentionally not implemented.

Local webhook testing:

```sh
stripe listen --forward-to localhost:5000/webhooks/stripe
```

Use the CLI's signing secret locally, not the deployed endpoint's secret. Complete a real test-mode Checkout for an existing order; generic CLI event fixtures lack this application's metadata/amount and should be rejected.

## 8. Seed and Administrator

1. Set the chosen Atlas URI in a secure server environment and run `npm run seed` once. It creates two categories and twenty products without overwriting existing edits.
2. For local demos only, run `npm run seed:admin` to create the documented demo account. It is not run at startup or by the catalog seed.
3. For production, set `NODE_ENV=production`, `DEMO_ADMIN_EMAIL` to your private administrator email, and `DEMO_ADMIN_PASSWORD` to a unique 16-72-byte password, then run `npm run seed:admin` from a trusted shell/one-off job with database access. The command refuses the published demo credentials and refuses to elevate an existing customer.
4. Do not expose seed commands as HTTP routes. Remove provisioning password variables after use. Existing admin credentials are never reset by rerunning the seed.

## Post-Deploy Checklist

- [ ] API readiness succeeds; Atlas access is restricted and backups enabled.
- [ ] Both apps refresh on nested React Router URLs without 404.
- [ ] Registration email arrives; valid token verifies once; expired/replayed tokens fail.
- [ ] Login sets the expected HttpOnly/Secure/SameSite cookie; logout invalidates copied sessions.
- [ ] Disallowed Origin, originless None-cookie mutations, unauthenticated writes, and customer admin access fail.
- [ ] Catalog search/filter/sort/pagination and image uploads work; replaced owned images disappear.
- [ ] Address and cart data are isolated per account; COD totals use current server prices.
- [ ] Checkout runs real Atlas transactions; simultaneous checkouts cannot oversell or duplicate cart consumption.
- [ ] Stripe completion, duplicate webhook, cancellation and expiry are exercised on deployed services.
- [ ] Reservations reconcile after failed provider requests; alert on stuck reservations/webhook failures.
- [ ] Admin stats reflect paid orders; allowed transitions work and illegal transitions fail.
- [ ] Mobile layouts, empty/loading/error states and validation messages are checked.
- [ ] Public demo credentials do not exist in production; provider secrets are not in client bundles or logs.
- [ ] Remaining security/operational limitations are accepted or fixed before a public launch.