-- Migration: Knowledge tables for admin UI
-- Created: 2026-05-20

-- ── 1. Zukan Marine Species ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inari_zukan_species (
  id              SERIAL PRIMARY KEY,
  name_ja         TEXT NOT NULL UNIQUE,
  url             TEXT,
  scientific_name TEXT,
  foreign_names   TEXT,
  category        TEXT,
  basic_info      TEXT,
  market_note     TEXT,
  taste           TEXT,
  season          TEXT,
  nutrition       TEXT,
  cooking_methods TEXT,
  selection       TEXT,
  origin_natural  TEXT,
  origin_farmed   TEXT,
  taste_rating    TEXT,
  importance      TEXT,
  knowledge_level TEXT,
  crawled_at      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Food Knowledge MD Files ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inari_food_knowledge (
  id         SERIAL PRIMARY KEY,
  source_dir TEXT NOT NULL,
  filename   TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  content    TEXT,
  category   TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
