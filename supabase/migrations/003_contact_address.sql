-- ============================================================
-- Add address column to contacts
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS address text;
