# Route migration map

The hosting layer should issue HTTP 308 (or 301 where 308 is unsupported) for stable path-only migrations. Query/state translations that require parsing may use a small compatibility route, but the destination must `replace` history and declare the canonical target. Redirects are tested before old static wrappers are removed.

## Legacy public paths

| Legacy URL/pattern | Canonical destination | Handling | Notes |
| --- | --- | --- | --- |
| `/index.html` | `/` | Permanent redirect | One home canonical |
| `/marketing.html` | `/` | Permanent redirect | Marketplace-first home replaces portal landing |
| `/portal/` | `/` | Permanent redirect | Preserve optional campaign query parameters only |
| `/products.html` | `/products` | Permanent redirect | |
| `/products/` | `/products` | Permanent redirect | Normalize trailing slash |
| `/category-electronics.html` | `/category/electronics` | Permanent redirect | Repeat for real legacy category wrappers |
| `/category-fashion.html` | `/category/fashion` | Permanent redirect | |
| `/category-home.html` | `/category/home` | Permanent redirect | |
| `/category-phones.html` | `/category/phones` | Permanent redirect | |
| `/category-beauty.html` | `/category/beauty` | Permanent redirect | |
| `/category-sports.html` | `/category/sports` | Permanent redirect | |
| `/category-trending.html` | `/products?sort=popular` | Permanent/query redirect | Only if popularity is measured; otherwise `/products` |
| `/category-dropship.html` or `/category/dropship` | `/sourcing` | Permanent redirect | Retire hard-coded supplier catalog presentation |
| `/upcoming.html` | `/upcoming` | Permanent redirect | |
| `/product.html?id=:id` | resolved `/product/:slug` | Compatibility resolver | API looks up legacy ID, then replace-redirects to slug; 404 if unmapped |
| `/privacy.html` or `/privacy/` | `/privacy` | Permanent redirect | Preserve current policy content |
| `/terms.html` or `/terms/` | `/terms` | Permanent redirect | Preserve current policy content |
| `/404.html` | requested path / 404 route | Hosting fallback | Never canonicalize errors to `/404.html` |
| `/1688-sourcing` | `/sourcing` | Permanent redirect | Legacy provider-specific path; internal documentation only |
| `/seller/sourcing/1688` | `/seller/sourcing` | Permanent redirect | Legacy provider-specific path; internal documentation only |

## Legacy query/modal states

The global legacy application used query strings and imperative modal calls as pseudo-routes. The compatibility entry reads only allowlisted keys; no arbitrary function/action name is executed.

| Legacy state | Destination |
| --- | --- |
| `?page=products` / buyer product section | `/products` |
| `?category=:legacyName` | normalized `/category/:slug` or `/products?category=` |
| `?search=:term` or old search input state | `/search?q=:term` |
| product modal `?product=:id` / deep-link ID | resolved `/product/:slug` |
| cart modal/open-cart key | `/cart` |
| checkout modal/step key | `/checkout` (restart with a fresh server quote) |
| buyer orders/account tab | `/orders` or `/account` |
| inbox/modal partner key | `/messages` or mapped conversation if authorized |
| seller dashboard `section=products` | `/seller/products` |
| seller dashboard `section=orders` | `/seller/orders` |
| seller dashboard finance/withdrawals | `/seller/finance` or `/seller/payouts` |
| seller sourcing/dropship section | `/seller/sourcing` |
| admin dashboard section keys | matching `/admin/*` route after permission check |
| auth mode query | `/login`, `/signup`, or relevant recovery route |

Cart contents, selected checkout amount, role claims, and admin state are never trusted from a legacy URL or local storage. Anonymous cart data may be imported once, then revalidated against the API. Checkout state must be recreated from an authenticated cart and an unexpired quote.

## Static host configuration

1. Put exact redirects before the SPA fallback.
2. Preserve path/query when explicitly listed; discard unsafe legacy action parameters.
3. Route all remaining application paths to `frontend/index.html` with a rewrite, not a visible redirect.
4. Serve missing static assets as true 404s rather than the HTML app shell.
5. Remove duplicate `_redirects`, Vercel rewrites, route folders, and static wrappers only after production redirect tests pass.

## SEO migration checks

- Sitemap contains only canonical public URLs.
- Canonical, Open Graph URL, breadcrumbs, internal links, email links, and notifications use new paths.
- Provider-specific and dashboard paths are absent from sitemap and public navigation.
- Important old URLs return one hop to a 200 destination; no chains or loops.
- Product ID resolver retains mappings for migrated IDs and returns a stable canonical slug.
- Search Console/analytics monitor old-path hits and 404s during the retention window.
