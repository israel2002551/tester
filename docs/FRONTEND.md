# Frontend architecture

## Stack and responsibility

The rebuilt frontend is a React 19 + Vite application using TypeScript/TSX, React Router, TanStack Query, and a small Supabase Auth client. It renders the complete public marketplace, buyer account, seller, supplier, and admin surfaces. It does not query Supabase business tables, upload directly with privileged credentials, calculate authoritative totals, or decide permissions.

The client is responsible for presentation, local interaction state, auth session acquisition/refresh, calling the versioned API, query caching/invalidation, route metadata, accessible feedback, and responsive composition.

## Application boundaries

Recommended structure:

```text
frontend/src/
  app/          router, providers, config, error boundary
  assets/       official brand assets and local imagery
  components/   shared UI, navigation, commerce, forms, feedback
  features/     domain-specific API hooks, components, schemas
  layouts/      Marketplace, Account, Seller, Supplier, Admin
  pages/        route-level composition
  lib/          API, Supabase Auth, formatting, types
  styles/       tokens, reset, typography, globals, components
```

Keep server state in TanStack Query, transient form/view state near its component, and auth/account state in one focused provider. Do not recreate a global marketplace store that contains every product, order, modal, and dashboard.

## Routing and layouts

React Router owns all application routing. Public pages use `MarketplaceLayout`; account and buyer commerce use authenticated account/checkout layouts; seller, supplier, and admin use lazy-loaded route groups with their own navigation. See [ROUTES.md](ROUTES.md) for the registry.

`RequireAuth`, `RequireSeller`, `RequireSupplier`, and `RequireAdmin` improve UX by showing sign-in/access screens and preserving the intended destination. They are not security boundaries. A 403 from the API remains authoritative and gets an intentional access-denied view.

Legacy URLs are handled by explicit permanent hosting redirects where possible and small router compatibility components only when query translation is required. Every indexable destination emits one canonical URL.

## API and session client

The shared API client owns:

- `VITE_API_BASE_URL` resolution;
- Supabase access-token attachment;
- JSON request and response parsing;
- stable conversion of API error envelopes into `ApiError`;
- request ID capture for support;
- optional `AbortSignal` support;
- `Idempotency-Key` headers for order/payment-sensitive mutations;
- a single re-authentication/session-expiry path.

Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are used for Supabase Auth. No secret/service-role key or procurement configuration belongs in the frontend.

## Query strategy

Use stable query keys such as `['products', filters]`, `['product', slug]`, `['cart']`, `['order', id]`, and `['seller', storeId, 'orders', filters]`. Public catalog reads may use a moderate stale time. Account, cart, messages, inventory, finance, and admin queues should revalidate more aggressively.

After mutations, update a small obvious cached object optimistically only when rollback is reliable (for example a wishlist toggle). Invalidate affected aggregates after cart changes, product edits, inventory adjustments, order transitions, messages, payout requests, and settings changes. Payment success is confirmed by an API read; a redirect parameter alone is not success.

All list queries pass bounded `page`/`limit`, filters, and allowlisted sort values to the backend. Search input is debounced and represented in URL search parameters so results are shareable and navigable.

## Runtime states

Every route and major section has:

- a structure-preserving initial skeleton or progress state;
- a useful empty state with one relevant action;
- a persistent error with retry and request ID where available;
- mutation-pending state that prevents duplicate submission;
- success feedback and cache refresh.

The top-level error boundary handles unexpected rendering failures. Feature boundaries isolate expensive dashboard widgets where useful so one failed chart does not erase an operational page. Development demo data is enabled only by an explicit development-only flag and is visibly labelled; production never falls back to fake data after an API error.

## Forms

Forms use semantic `<form>`, visible labels, input-specific autocomplete, descriptions and errors connected with ARIA, client validation for immediate guidance, and server errors as the final authority. Long seller onboarding/product flows preserve draft state intentionally. Buttons disable while submitting; unsafe double clicks do not create duplicate orders, payments, campaigns, or payouts because the backend also enforces idempotency.

Reference URLs in sourcing are generic URLs. External links are normalized and opened with `rel="noopener noreferrer"`. No public component accepts or renders internal procurement fields.

## Responsive behavior

- Public header becomes a compact search/navigation pattern with 44px targets.
- Product grids use two columns at usable phone widths, then 3–6 based on container width.
- Product detail collapses gallery/buy-box/details into reading and purchase order; mobile may use a safe-area-aware sticky action.
- Checkout is summary + form on desktop and a single linear task on mobile; totals remain visible before payment.
- Seller/admin sidebars become accessible drawers; data tables use labelled cards or controlled horizontal scrolling.
- Messages use split pane on wide screens and list/detail routes on mobile.
- No fixed element covers checkout actions, form errors, or the last content row.

## SEO

Public product, store, category, sourcing, and marketing routes set a unique title, description, canonical, Open Graph/Twitter metadata, and breadcrumbs where useful. Product pages emit valid Product JSON-LD only from real price/availability/review data. Organization data uses verified BUYSELL facts. Sitemap entries include public pages and exclude auth, cart, checkout, account, messages, seller, supplier, and admin.

Because a static SPA cannot guarantee ideal crawler rendering for a large changing catalog, production should use build-time route generation, dynamic rendering, or a later SSR migration when catalog SEO becomes material. It must not introduce duplicate URLs or fabricate structured-data fields.

## Accessibility and performance

Follow [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md). Route changes move focus to the page heading and announce navigation. Dialogs restore focus; icon controls have accessible names; status does not rely on colour. Motion respects reduced-motion settings.

Lazy-load seller, supplier, admin, charting, and rich editor code. Keep shared dependencies small, load appropriately sized responsive images, reserve media dimensions, and inspect the build for unexpectedly large chunks. Avoid duplicate requests through Query, memoize only measured bottlenecks, and virtualize only genuinely large lists.

## Frontend verification

Run lint, unit/component tests, and production build. Then use desktop and mobile widths to verify the homepage, marketplace, search/category, product, cart, checkout, order, messages, seller dashboard/product form/orders/finance, sourcing, admin dashboard/users/KYC/sourcing, all guard states, 404, and legal pages. Inspect console and network responses; confirm no direct business-table request, internal source data, secret, or production demo fixture appears.
