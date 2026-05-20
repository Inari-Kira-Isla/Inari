-- Add stock tracking columns to inari_products
ALTER TABLE inari_products ADD COLUMN IF NOT EXISTS stock_qty NUMERIC DEFAULT 0;
ALTER TABLE inari_products ADD COLUMN IF NOT EXISTS stock_unit TEXT;
ALTER TABLE inari_products ADD COLUMN IF NOT EXISTS stock_min_qty NUMERIC DEFAULT 0;
ALTER TABLE inari_products ADD COLUMN IF NOT EXISTS stock_notes TEXT;
