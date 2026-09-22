-- Adds provenance tracking: which signed-in owner added each item.
-- Run against the live zoptavi-tab D1 database with:
--   npx wrangler d1 execute zoptavi-tab --remote --file=./migrations/0001_items_added_by.sql
-- (drop --remote to apply to your local/dev D1 first for testing)

ALTER TABLE items ADD COLUMN added_by TEXT;
