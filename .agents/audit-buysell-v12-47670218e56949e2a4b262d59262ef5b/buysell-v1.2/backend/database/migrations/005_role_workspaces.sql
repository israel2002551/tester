CREATE TABLE IF NOT EXISTS supplier_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  supplier_key CITEXT UNIQUE NOT NULL,
  business_name TEXT,
  description TEXT,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','suspended')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE supplier_connections ADD COLUMN IF NOT EXISTS supplier_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_connections_supplier_user ON supplier_connections(supplier_user_id, created_at DESC);
UPDATE supplier_connections sc SET supplier_user_id=sp.user_id FROM supplier_profiles sp WHERE sc.supplier_user_id IS NULL AND lower(sc.supplier_key)=lower(sp.supplier_key::text);

CREATE TABLE IF NOT EXISTS seller_manager_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  due_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manager_tasks_manager ON seller_manager_tasks(manager_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_supplier_profiles_touch ON supplier_profiles;
CREATE TRIGGER trg_supplier_profiles_touch BEFORE UPDATE ON supplier_profiles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_seller_manager_tasks_touch ON seller_manager_tasks;
CREATE TRIGGER trg_seller_manager_tasks_touch BEFORE UPDATE ON seller_manager_tasks FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
