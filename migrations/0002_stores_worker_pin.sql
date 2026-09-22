-- Adds worker PIN access: a short human-friendly store_code (shared with workers) plus a
-- hashed PIN, with basic brute-force lockout counters.
-- Run against the live zoptavi-tab D1 database with:
--   npx wrangler d1 execute zoptavi-tab --remote --file=./migrations/0002_stores_worker_pin.sql
-- (drop --remote to apply to your local/dev D1 first for testing)

ALTER TABLE stores ADD COLUMN store_code TEXT;
ALTER TABLE stores ADD COLUMN worker_pin_hash TEXT;
ALTER TABLE stores ADD COLUMN worker_pin_fail_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stores ADD COLUMN worker_pin_locked_until TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_store_code ON stores(store_code);
