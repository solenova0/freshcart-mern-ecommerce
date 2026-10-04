# Shared UI and Accessibility Review

This report covers the refreshed storefront/admin, reusable components, and automated browser evidence. It is not a full WCAG certification or a substitute for manual assistive-technology testing. Browser data is explicitly mocked; live provider/database flows remain separate integration checks.

## Design System Files

| File | Purpose |
| --- | --- |
| [CSS variables and theme](../packages/design-system/theme.css) | Requested base/status colors, hookah overrides, self-hosted fonts, spacing/radii/shadows, focus/touch/contrast rules |
| [Shared tailwind.config.js](../packages/design-system/tailwind.config.js) | CSS-variable-backed Tailwind preset |
| [Storefront tailwind.config.js](../storefront/tailwind.config.js) | Imports the shared preset |
| [Admin tailwind.config.js](../admin/tailwind.config.js) | Imports the same preset |
| [Reusable components](../packages/design-system/src/components.jsx) | Button, Input, Select, Badge, Card, Modal, Drawer, Toast, Skeleton, EmptyState |

Tailwind v4 consumes the CSS `@theme inline` mapping and each app explicitly loads its JS preset with `@config`. Shared source scanning covers component classes. Fonts are locally bundled Plus Jakarta Sans (headings) and Inter (body), not external font requests. Prices use tabular numbers. Layout spacing uses an 8px base grid; 44px is the minimum interactive target, cards are 12-16px, and repeated items use restrained soft shadows.

Example usage:

```jsx
import { Button, Input, Badge, Card, Drawer } from '@freshcart/design-system'

<Card>
  <Input label="Email" type="email" error={errors.email} />
  <Button variant="accent" loading={saving}>Save</Button>
  <Badge status="shipped" />
</Card>
```

Use `data-theme="hookah"` on a section/overlay to swap variable values without rewriting component styles. The hookah backdrop is `#2D1B3D`, gold is `#C9A227`, and text is `#F5F0E8`.

## Issues Found and Fixed

| Issue | Fix / evidence |
| --- | --- |
| Independent hard-coded palettes, fonts, radii, and controls across apps | Shared workspace package and token-driven styles; both apps use the same reusable components and self-hosted fonts. |
| White text on requested orange fails normal-text AA (2.80:1) | Accent uses dark `#1C1917` text (6.24:1). Requested orange remains unchanged. |
| Blue focus ring on hookah surface was only 2.62:1 | Hookah uses a gold focus ring (5.60:1); dark sidebar focus uses a contrasting accent. |
| Input boundary on white was only 2.52:1 | Form/search boundaries darkened to `#8C837C` and explicitly checked against the 3:1 non-text threshold. Decorative card borders retain the requested border token. |
| Secondary text/placeholders could become too faint when themes changed | Accessible muted-text and error-text aliases; explicit placeholder color/opacity; high-contrast error text in dark theme. |
| Small icon/footer/gallery targets | Minimum 44px controls and footer/product links; icons have accessible names/tooltips and state-aware disabled controls. |
| Native dialog traversal could briefly move focus outside at its tab boundary | Explicit forward/backward Tab wrapping, Escape dismissal, backdrop dismissal, scroll locking and focus return to the trigger. Tested with repeated Tab presses. |
| Sticky headers/bottom nav could obscure focused controls | Scroll padding for documents/dialogs, visible focus outlines and skip-to-content links. |
| Admin recent-order scroll region was not keyboard reachable on small screens | Named focusable region with `tabIndex=0`; table overflow stays within its container. |
| Absolutely positioned screen-reader-only table header widened the page at 360/768px | Positioned scroll container; document-level overflow checks now pass. |
| Product card resized when add became a quantity stepper | Fixed action tracks on narrow screens and geometry assertions before/after cart insertion. |
| Validation only announced a toast | Input-linked inline errors, `aria-invalid`, `aria-describedby`, password visibility controls, loading/disabled buttons and checkout focus on the first invalid input. Toasts remain supplemental. |
| Delete/cancel operations could be triggered without a decision point | Accessible delete, basket clear and payment/order cancellation confirmation dialogs. |
| Uploads lacked drag/drop and primary-image semantics | Bounded drag/drop plus native file chooser, previews, remove/reorder buttons, primary marker, and object-URL cleanup. Both products and categories support multi-image upload. |
| Order timeline had no real transition times | Server stores statusHistory for new transitions; legacy missing times say “Time not recorded” instead of using invented timestamps. |
| First-load dev-server dependency optimization sometimes reloaded pages during scans | Separate Vite optimizer caches/predeclared dependencies; deployed-asset audit runs production preview builds rather than HMR pages. |

## Coverage

Automated axe checks use WCAG 2 A/AA, 2.1 AA and 2.2 AA tags. The suite visits Home, Shop, Product detail, Cart, Checkout, Orders, Login, Register, Verify-email, the hookah section, and admin Dashboard/Orders/Products/Categories at **360px, 768px and 1280px**. It checks document overflow, loading/error/empty affordances, open cart and age dialogs, and token contrast pairs. Operational workflows include COD checkout, Stripe retry/cancel controls, role denial, quantity controls, actual drag/drop dispatch, primary-image selection, keyboard focus trapping, and age storage failure/persistence.

```sh
npm run build
npx playwright install chromium
npm run test:browser
npm run lint
npm test
```

The Playwright suite starts production preview servers on 5273/5274; normal development stays on 5173/5174. Preview servers are test-managed and stop when the test run completes. The API remains mocked at port 5000 for browser checks. Test screenshots are stored under `docs/screenshots/`.

| View | 360px | 768px | 1280px |
| --- | --- | --- | --- |
| Storefront | [Screenshot](screenshots/ui-storefront-360.png) | [Screenshot](screenshots/ui-storefront-768.png) | [Screenshot](screenshots/ui-storefront-1280.png) |
| Hookah | [Screenshot](screenshots/ui-hookah-360.png) | [Screenshot](screenshots/ui-hookah-768.png) | [Screenshot](screenshots/ui-hookah-1280.png) |
| Admin | [Screenshot](screenshots/ui-admin-360.png) | [Screenshot](screenshots/ui-admin-768.png) | [Screenshot](screenshots/ui-admin-1280.png) |

## Behavior Boundaries

- Age confirmation in localStorage is a UI declaration remembered with try/catch, not authentication or identity proof. If storage is blocked, confirmation survives current app navigation but is requested after reload. Decline/Escape returns Home. Backend purchase checks still require the account's `ageConfirmed` field.
- Delivery fee is currently zero (“Free”), matching the server's existing total policy. A future nonzero fee must be calculated/persisted server-side, not invented by the UI.
- “Out for delivery” maps to the existing server status `shipped`; `processing` is intermediate confirmation/preparation. Allowed backend transitions are unchanged.
- Best sellers ranks quantities in paid, non-cancelled orders; no completed sales produces an honest empty state. New arrivals uses newest catalog order.
- Orders today uses UTC day boundaries. Low stock means available inventory (stock minus reservations) at or below three, including out-of-stock products.
- Category/product multi-image upload replaces the entire list; the first image is primary. Selecting a different primary before upload changes multipart ordering.
- Further manual checks should include VoiceOver/NVDA, browser zoom/text enlargement, OS high-contrast modes, and live errors/data. Automated no-violation results do not guarantee full accessibility for every user or third-party Stripe page.