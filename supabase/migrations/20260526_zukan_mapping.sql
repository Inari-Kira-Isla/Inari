-- B3: inari_zukan_mapping — item_code ↔ Zukan species mapping table

CREATE TABLE IF NOT EXISTS inari_zukan_mapping (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_code   text        NOT NULL,
  name_ja     text        NOT NULL,             -- FK to inari_zukan_species.name_ja
  confidence  text        NOT NULL DEFAULT 'keyword',  -- keyword / fuzzy:0.xx / ai / manual
  notes       text,
  tenant_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS zukan_mapping_item_uq
  ON inari_zukan_mapping (item_code);

CREATE INDEX IF NOT EXISTS zukan_mapping_name_ja
  ON inari_zukan_mapping (name_ja);

GRANT SELECT ON inari_zukan_mapping TO authenticated, anon;
GRANT ALL    ON inari_zukan_mapping TO service_role;

-- Verify
SELECT count(*) AS mapping_count FROM inari_zukan_mapping;
