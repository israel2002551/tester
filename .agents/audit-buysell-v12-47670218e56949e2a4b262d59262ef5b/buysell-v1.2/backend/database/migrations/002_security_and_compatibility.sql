-- Compatibility views and hardening helpers for the Supabase-to-API cutover.

CREATE OR REPLACE VIEW seller_revenue_summary AS
SELECT
  u.id AS seller_id,
  COALESCE(SUM(CASE WHEN o.status='delivered' THEN o.total_amount ELSE 0 END),0)::bigint AS delivered_revenue,
  COALESCE((SELECT SUM(w.amount) FROM withdrawals w WHERE w.seller_id=u.id AND w.status='pending'),0)::bigint AS pending_withdrawals,
  COALESCE((SELECT SUM(w.amount) FROM withdrawals w WHERE w.seller_id=u.id AND w.status='paid'),0)::bigint AS paid_withdrawals,
  COALESCE((SELECT SUM(CASE WHEN wt.type IN ('debit','purchase_debit') THEN wt.amount ELSE 0 END) FROM wallet_transactions wt WHERE wt.seller_id=u.id),0)::bigint AS wallet_debits
FROM users u
LEFT JOIN orders o ON o.seller_id=u.id
GROUP BY u.id;

CREATE OR REPLACE VIEW product_rating_summary AS
SELECT p.id AS product_id,
       COALESCE(AVG(r.rating),0)::numeric(3,2) AS average_rating,
       COUNT(r.id)::bigint AS review_count
FROM products p
LEFT JOIN reviews r ON r.product_id=p.id
GROUP BY p.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_seller_slug ON products(seller_id, slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_payment_ref ON orders(payment_ref) WHERE payment_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_provider_tx ON payment_transactions(provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_disputes_order_status ON disputes(order_id, status);
CREATE INDEX IF NOT EXISTS idx_ads_status_dates ON advertisements(status, starts_at, ends_at);

-- Ensure a default buyer role exists for every user imported during migration.
INSERT INTO user_roles(user_id, role)
SELECT id, 'buyer' FROM users
ON CONFLICT DO NOTHING;
