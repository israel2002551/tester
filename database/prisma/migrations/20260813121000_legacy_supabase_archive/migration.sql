CREATE SCHEMA IF NOT EXISTS legacy_supabase;

REVOKE ALL ON SCHEMA legacy_supabase FROM PUBLIC;

CREATE TABLE IF NOT EXISTS legacy_supabase.import_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_project_ref text NOT NULL,
  source_snapshot_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'IMPORTING',
  expected_public_rows bigint NOT NULL DEFAULT 0,
  imported_public_rows bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS legacy_supabase.raw_row (
  batch_id uuid NOT NULL REFERENCES legacy_supabase.import_batch(id) ON DELETE RESTRICT,
  source_schema text NOT NULL,
  source_table text NOT NULL,
  source_ordinal bigint NOT NULL,
  source_row_key text,
  row_data jsonb NOT NULL,
  source_hash text GENERATED ALWAYS AS (md5(row_data::text)) STORED,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, source_schema, source_table, source_ordinal)
);

CREATE INDEX IF NOT EXISTS legacy_raw_row_lookup_idx
  ON legacy_supabase.raw_row (source_schema, source_table, source_row_key);

CREATE TABLE IF NOT EXISTS legacy_supabase.table_manifest (
  batch_id uuid NOT NULL REFERENCES legacy_supabase.import_batch(id) ON DELETE RESTRICT,
  source_schema text NOT NULL,
  source_table text NOT NULL,
  expected_rows bigint NOT NULL,
  imported_rows bigint NOT NULL,
  checksum text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, source_schema, source_table)
);

CREATE TABLE IF NOT EXISTS legacy_supabase.transform_manifest (
  batch_id uuid NOT NULL REFERENCES legacy_supabase.import_batch(id) ON DELETE RESTRICT,
  source_schema text NOT NULL,
  source_table text NOT NULL,
  source_row_key text,
  target_entity text NOT NULL,
  target_id text,
  status text NOT NULL,
  warning text,
  transformed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legacy_transform_manifest_source_idx
  ON legacy_supabase.transform_manifest (batch_id, source_schema, source_table, source_row_key);
