-- B1: Align inari_zukan_species with Zukan SQLite schema
-- Adds missing columns that exist in the local SQLite but not in Supabase

ALTER TABLE inari_zukan_species
  ADD COLUMN IF NOT EXISTS taxonomy         text,
  ADD COLUMN IF NOT EXISTS habitat          text,
  ADD COLUMN IF NOT EXISTS ecology          text,
  ADD COLUMN IF NOT EXISTS fishing_method   text,
  ADD COLUMN IF NOT EXISTS cooking_details  text,
  ADD COLUMN IF NOT EXISTS processed_products text,
  ADD COLUMN IF NOT EXISTS regional_dishes  text,
  ADD COLUMN IF NOT EXISTS regional_names   text,
  ADD COLUMN IF NOT EXISTS rarity           text;

-- Unique index for upsert by name_ja
CREATE UNIQUE INDEX IF NOT EXISTS zukan_species_name_ja_uq
  ON inari_zukan_species (name_ja);

-- Verify
SELECT column_name FROM information_schema.columns
WHERE  table_name = 'inari_zukan_species'
ORDER  BY ordinal_position;
