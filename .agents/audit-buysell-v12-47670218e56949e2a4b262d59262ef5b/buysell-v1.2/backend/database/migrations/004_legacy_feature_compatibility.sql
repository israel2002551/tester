-- Features present in the legacy Supabase application that need durable V1.2 homes.

CREATE TABLE IF NOT EXISTS upcoming_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  video_url TEXT,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  videos JSONB NOT NULL DEFAULT '[]'::jsonb,
  launch_date TIMESTAMPTZ,
  priority INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','hidden','archived')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_upcoming_products_public ON upcoming_products(status, priority DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source TEXT,
  amount BIGINT NOT NULL DEFAULT 0,
  paid BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id, created_at DESC);

-- Keep legacy ad media semantics (including video ads) while the new API uses the
-- normalized body/destination_url/ends_at fields for most application code.
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS payment_status TEXT;
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS cta_text TEXT;
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS cta_link TEXT;
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE commission_receipts ADD COLUMN IF NOT EXISTS transaction_ref TEXT;
ALTER TABLE commission_receipts ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_broadcast_jobs_target ON broadcast_jobs(target, created_at DESC);
