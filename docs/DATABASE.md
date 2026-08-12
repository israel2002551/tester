# Database design

## Conventions

The target store is PostgreSQL, accessed by the backend through Prisma. `DATABASE_URL` is the pooled runtime connection; `DIRECT_DATABASE_URL` is the non-pooled connection used for migrations and administrative commands. UUIDs identify domain records. Timestamps are stored in UTC.

All NGN amounts use integer kobo in `BigInt` columns, named `*Kobo`. This avoids binary floating-point errors. APIs serialize these values as decimal strings or deliberate safe-number display values; the frontend must not perform financial accounting. Foreign-currency procurement values use explicitly named minor-unit fields plus a `Decimal(18,8)` exchange rate.

Most mutable aggregate roots have `createdAt`/`updatedAt`. `User` and `Product` include `deletedAt` for soft deletion. Orders, payments, ledger entries, status history, webhook events, and audit logs are retained rather than deleted.

## Domain map

| Domain | Principal models | Relationship/invariant |
| --- | --- | --- |
| Identity | `User`, `UserProfile`, `AuthIdentity`, `PlatformRoleAssignment` | External identity is unique on provider + subject; roles are database-owned. |
| Stores | `Store`, `StoreSetting`, `StoreMembership`, `StoreMembershipPermission` | One owner; a user may belong to several stores with distinct roles. |
| Suppliers | `SupplierProfile`, `SupplierConnection`, `SupplierProduct` | Supplier identity is distinct from store membership; supplier catalog data is not automatically a public product. |
| Catalog | `Category`, `Brand`, `Product`, `ProductVariant`, product option/value joins | Store-scoped product slug; variant SKU unique within product; category is hierarchical. |
| Inventory | `InventoryItem`, `InventoryReservation`, `InventoryMovement` | Available quantity is `onHand - reserved`; changes have an audit movement and optimistic `version`. |
| Media | `MediaAsset`, `ProductMedia` and purpose relations | Provider object is unique; access is `PUBLIC` or `PRIVATE`; ownership is explicit. |
| Buyer | `Address`, `Cart`, `CartItem`, `Wishlist`, `WishlistItem` | One authenticated cart; a variant is unique per cart; saved product unique per wishlist. |
| Checkout | `CheckoutQuote`, `CheckoutQuoteItem` | Price/address/item snapshot expires and can be consumed only once. |
| Orders | `Order`, `StoreOrder`, `OrderItem`, `OrderStatusEvent` | One buyer order splits by store; item snapshots preserve purchase facts. |
| Payments | `Payment`, `PaymentAttempt`, `PaymentWebhookEvent` | Internal/provider references and provider event IDs are unique for idempotency. |
| Finance | `LedgerAccount`, `LedgerEntry`, `PayoutDestination`, `PayoutRequest`, `PayoutTransaction` | Store ledger is append-only; each financial effect has a unique idempotency key. |
| Messaging | `Conversation`, `ConversationMember`, `Message` | Access requires membership; conversations may link to an order or sourcing request. |
| Trust | `Review`, `KycSubmission`, `KycDocument`, `Dispute`, evidence/messages | One review per purchased line; sensitive documents are private media. |
| Growth | `AdCampaign`, `AdEvent`, `ReferralCode`, visits/conversions | Impressions and clicks are observed events, never derived fictional metrics. |
| Sourcing | `SourcingRequest`, `SourcingItem`, `SourcingQuote`, `SourcingStatusHistory` | Customer-owned service record and customer-facing quote. |
| Procurement | `SourcingProcurement` | One role-gated internal record per sourcing request; never part of a public DTO. |
| RFQ/services | `RfqRequest`, `RfqQuote`, `ServiceListing`, `ServiceBooking` | Supplier quote award and service booking lifecycles remain distinct from retail orders. |
| Operations | `FulfilmentHub`, `DeliveryAssignment`, `BroadcastCampaign`, `BroadcastDelivery` | Delivery and broadcast delivery state is tracked independently. |
| Platform | `SiteSetting`, `AuditLog`, `OutboxEvent` | Validated non-secret settings; sensitive action trace; durable side-effect queue. |

## Commerce snapshots

An order must remain intelligible after a seller renames, edits, archives, or deletes a product. `CheckoutQuoteItem` captures the server-calculated SKU, names, unit price, and shipping basis. `OrderItem` copies those values and the seller/platform allocation. `Order.addressSnapshot` preserves the delivery address used at purchase. These snapshots are immutable business records; display pages may link to the current product but must render the snapshot as the historical source of truth.

## Multi-store orders

`Order` owns buyer totals, payment state, address, and the overall status. `StoreOrder` groups items for one store, records the store-specific totals, commission, seller net, tracking, and fulfilment state. A payment may cover the parent order once. Ledger credits reference store orders so reconciliation remains possible even when each seller fulfils on a different schedule.

## Inventory invariants

The inventory service performs reservation in the same serializable transaction that creates an order:

1. Reload the quote and selected variants.
2. Atomically confirm `onHand - reserved >= requested` and the expected `version`.
3. Increase `reserved`, create `InventoryReservation`, and append `InventoryMovement(RESERVE)`.
4. On verified payment, decrease `onHand` and `reserved`, mark the reservation `COMMITTED`, and append `SALE_COMMIT`.
5. On expiry/cancellation, decrease `reserved`, mark it `RELEASED`/`EXPIRED`, and append `RELEASE`.

Negative quantities and undocumented direct increments are forbidden. A repair uses an `ADJUSTMENT` movement with actor, reference, and reason.

## Financial invariants

- Credits are positive and debits/holds are negative ledger entries.
- Payment verification, paid order transition, stock commit, store allocation, ledger entries, and outbox records occur atomically.
- Available payout balance is the sum of eligible entries whose `availableAt <= now`, including existing holds/debits.
- Payout creation takes a transaction-level lock/advisory lock and inserts `PAYOUT_HOLD` before returning success.
- Every provider event, order creation, ledger effect, and external transaction uses a uniqueness constraint or idempotency key.
- Stored destination account numbers are encrypted; only a stable fingerprint and masked representation are used for comparison/display.

## Important statuses

The schema defines typed enums for user, store, supplier, product, order, payment, payment attempt, webhook processing, inventory reservation/movement, payout, conversation/message, review, KYC, dispute, ad, sourcing, service booking, delivery, RFQ, and broadcast state. Status changes are made through service transition maps. Unknown strings from the legacy source are mapped or quarantined; they are not silently coerced.

Sourcing customer status is deliberately provider-neutral: `REQUEST_SUBMITTED`, `UNDER_REVIEW`, `MORE_INFO_REQUIRED`, `QUOTE_READY`, `AWAITING_PAYMENT`, `PAYMENT_CONFIRMED`, `PROCUREMENT_IN_PROGRESS`, `PROCURED`, `INTERNATIONAL_TRANSIT`, `ARRIVED_IN_COUNTRY`, `LOCAL_FULFILMENT`, `COMPLETED`, and `CANCELLED`.

## Index strategy

The Prisma schema includes indexes for frequent ownership and queue paths, including product publication/category/store, inventory reservation expiry, buyer/store order timelines, payment status, ledger eligibility, conversations and messages, notifications, moderation queues, sourcing state, and audit/outbox processing. Unique constraints enforce identity subjects, slugs within their scope, cart/wishlist duplication rules, checkout consumption, provider references, and webhook idempotency.

Before production, run `EXPLAIN (ANALYZE, BUFFERS)` against representative catalog search, store order lists, admin queues, balance calculation, and sourcing queue workloads. Add indexes from measured queries, not speculative duplicated indexes. PostgreSQL full-text/trigram indexes may back the first search implementation.

## Migration and schema workflow

1. Edit `database/prisma/schema.prisma`.
2. Run `npm run db:generate` and `npm run db:validate`.
3. Create a named Prisma migration against a disposable or staging Neon branch.
4. Apply it to a clean database and run seed/test queries.
5. Review generated SQL, especially destructive statements and enum changes.
6. Apply to production only during the approved deployment/cutover procedure using the direct connection.

Never use `db push` as a substitute for reviewed production migrations. Never point development or preview builds at the production branch. See [SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md) for data transfer and [PRODUCTION_CUTOVER.md](PRODUCTION_CUTOVER.md) for the switch procedure.
