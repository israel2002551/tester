# Frontend route registry

This file defines canonical route ownership. All paths are React Router routes served by the SPA fallback unless the hosting layer handles a redirect. Dynamic slugs are canonical; opaque IDs are acceptable for private resources. Private routes use `noindex` and are excluded from the sitemap.

## Public marketplace and information

| Route | Purpose | Indexing |
| --- | --- | --- |
| `/` | Marketplace-first home | Index |
| `/marketplace` | Broad discovery landing | Index |
| `/products` | All products | Index |
| `/search` | Search via `q`, filters, sort, page | Usually noindex filtered results |
| `/category/:categorySlug` | Category result | Index canonical |
| `/category/:categorySlug/:subcategorySlug` | Subcategory result | Index canonical |
| `/product/:productSlug` | Product detail and buy box | Index + Product structured data |
| `/store/:storeSlug` | Public store and products | Index |
| `/upcoming` | Real approved upcoming collection | Index when enabled |
| `/services`, `/service/:serviceId` | Real active service discovery/detail | Index when product policy enables it |
| `/sourcing` | BUYSELL Product Sourcing overview | Index |
| `/rfq` | Authenticated request-for-quote workspace | Noindex |
| `/about` | About BUYSELL | Index |
| `/how-it-works` | Marketplace overview | Index |
| `/how-to-buy` | Buyer guide | Index |
| `/how-to-sell` | Seller guide | Index |
| `/buyer-protection` | Buyer safeguards | Index |
| `/seller-protection` | Seller safeguards | Index |
| `/delivery` | Accurate delivery information | Index |
| `/safety` | Marketplace safety | Index |
| `/help` | Help centre | Index |
| `/help/:articleSlug` | Help article | Index per content policy |
| `/faq` | Frequently asked questions | Index |
| `/contact` | Contact/support channels | Index |
| `/terms`, `/privacy`, `/cookies` | Legal policies | Index |
| `/refund-policy`, `/prohibited-items` | Commerce policies | Index |

## Authentication and buyer account

| Route | Guard | Purpose |
| --- | --- | --- |
| `/login` | Anonymous-friendly | Login; redirect signed-in users safely |
| `/signup`, `/signup/buyer` | Anonymous-friendly | Buyer account creation |
| `/signup/seller`, `/signup/supplier` | Anonymous-friendly | Create identity then enter role onboarding |
| `/forgot-password`, `/reset-password` | Auth flow | Recovery/reset |
| `/auth/callback` | Auth flow | Supabase OAuth/email callback |
| `/account` | Auth | Account overview |
| `/account/profile` | Auth | Personal profile |
| `/account/addresses` | Auth | Owned delivery addresses |
| `/account/security` | Auth | Sessions/password/security guidance |
| `/account/notifications` | Auth | Email/push preferences |
| `/cart` | Optional auth | Anonymous/server cart and merge |
| `/checkout` | Auth | Server-quoted checkout |
| `/checkout/success` | Auth | Poll/reconcile payment; never trust query alone |
| `/orders`, `/orders/:orderId` | Auth + owner | Buyer order history/detail |
| `/wishlist` | Auth | Saved products |
| `/messages`, `/messages/:conversationId` | Auth + member | Conversation list/detail |

## Seller

All seller routes require authentication. Store routes also require an active membership and the route's permission; `/seller/onboarding` is available before membership is complete.

```text
/seller/dashboard
/seller/onboarding
/seller/store
/seller/store/customize
/seller/products
/seller/products/new
/seller/products/:productId
/seller/products/:productId/edit
/seller/inventory
/seller/orders
/seller/orders/:orderId
/seller/customers
/seller/messages
/seller/messages/:conversationId
/seller/analytics
/seller/finance
/seller/finance/transactions
/seller/payouts
/seller/advertising
/seller/advertising/new
/seller/advertising/:campaignId
/seller/referrals
/seller/team
/seller/verification
/seller/sourcing
/seller/sourcing/new
/seller/sourcing/:requestId
/seller/settings
```

## Supplier

Supplier routes are enabled only for an authenticated user with an active/eligible `SupplierProfile`. Unavailable modules show a deliberate not-enabled state rather than fixture data.

```text
/supplier/dashboard
/supplier/profile
/supplier/catalog
/supplier/requests
/supplier/requests/:requestId
/supplier/quotes
/supplier/orders
/supplier/messages
/supplier/messages/:conversationId
/supplier/analytics
/supplier/verification
/supplier/settings
```

## Administration

Every admin page is permission-gated by its API as well as the route shell.

```text
/admin
/admin/dashboard
/admin/users
/admin/users/:userId
/admin/buyers
/admin/sellers
/admin/sellers/:sellerId
/admin/suppliers
/admin/suppliers/:supplierId
/admin/products
/admin/products/:productId
/admin/categories
/admin/orders
/admin/orders/:orderId
/admin/payments
/admin/finance
/admin/commissions
/admin/payouts
/admin/disputes
/admin/disputes/:disputeId
/admin/kyc
/admin/kyc/:submissionId
/admin/sourcing
/admin/sourcing/:requestId
/admin/advertising
/admin/advertising/:campaignId
/admin/broadcasts
/admin/broadcasts/new
/admin/broadcasts/:campaignId
/admin/messages
/admin/notifications
/admin/analytics
/admin/audit-logs
/admin/settings
```

## Route behavior rules

- Unknown paths render a branded 404 with search, marketplace, and home actions; they do not silently redirect home.
- Auth redirects keep a validated same-origin `returnTo` path and reject open redirects.
- A missing owned resource returns not found without revealing whether another account owns it.
- Slug changes use a stored redirect/alias where supported rather than producing duplicate product/store URLs.
- Query parameters are validated and normalized; canonical tags drop tracking, pagination duplicates, and unsupported filters.
- Historic provider-specific sourcing routes redirect permanently to `/sourcing` or `/seller/sourcing` and never appear in navigation or the sitemap.
