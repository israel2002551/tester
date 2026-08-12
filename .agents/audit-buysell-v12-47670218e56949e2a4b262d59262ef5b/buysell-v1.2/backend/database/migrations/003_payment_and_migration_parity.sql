ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_auth_provider TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_auth_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_legacy_auth ON users(legacy_auth_provider, legacy_auth_id) WHERE legacy_auth_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS migration_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT
);
