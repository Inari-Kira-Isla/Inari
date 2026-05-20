#!/usr/bin/env python3
"""
sync_knowledge_to_supabase.py
Syncs local knowledge data to Supabase inari-production.
  1. Zukan SQLite DB → inari_zukan_species
  2. ~/inari-food-db/ MD files → inari_food_knowledge
"""
import subprocess
import sqlite3
import os
import re
import json
import urllib.request
import urllib.parse
import urllib.error

SUPABASE_URL = "https://cqartwwsbxnjjatmndtt.supabase.co"
ZUKAN_DB = os.path.expanduser("~/.openclaw/workspace/skills/zukan-knowledge-db/zukan.db")
FOOD_BASE = os.path.expanduser("~/inari-food-db")

FOOD_SUBDIRS = {
    "商品品類總覽":      "商品品類",
    "日本地區食文化研究": "地區食文化",
    "餐廳業態研究":      "餐廳業態",
    "專題研究":          "專題研究",
    "澳門營運":          "澳門營運",
    "超市商品研究":      "超市商品",
}


# ── helpers ──────────────────────────────────────────────────────────────────

def get_service_key() -> str:
    out = subprocess.check_output(
        ["/opt/homebrew/bin/python3", "/Users/kira/vault/vault.py",
         "get", "supabase_inari", "service_role_key"],
        stderr=subprocess.DEVNULL,
    )
    key = out.decode().strip()
    if not key or key.startswith("❌"):
        raise RuntimeError(f"Failed to get service role key: {key}")
    return key


def sb_request(method: str, path: str, key: str, payload=None, params: str = "") -> dict:
    url = f"{SUPABASE_URL}/rest/v1/{path}{params}"
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
            return {"ok": True, "status": resp.status, "body": body.decode() if body else ""}
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {"ok": False, "status": e.code, "body": body}


def chunk_upsert(records: list, endpoint: str, conflict_col: str, key: str, chunk_size: int = 50) -> tuple[int, int]:
    ok_count = 0
    fail_count = 0
    for i in range(0, len(records), chunk_size):
        batch = records[i:i + chunk_size]
        result = sb_request(
            "POST",
            f"{endpoint}?on_conflict={conflict_col}",
            key,
            batch,
        )
        if result["ok"] or result["status"] in (200, 201, 204):
            ok_count += len(batch)
        else:
            fail_count += len(batch)
            print(f"  [WARN] Batch {i}–{i+len(batch)} failed: HTTP {result['status']} — {result['body'][:200]}")
    return ok_count, fail_count


# ── Task 1: Zukan ─────────────────────────────────────────────────────────────

def sync_zukan(key: str):
    print("\n[1/2] Syncing Zukan species data...")
    if not os.path.exists(ZUKAN_DB):
        print(f"  ERROR: DB not found at {ZUKAN_DB}")
        return

    conn = sqlite3.connect(ZUKAN_DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("""
        SELECT name_ja, url, scientific_name, foreign_names, category,
               basic_info, market_note, taste, season, nutrition,
               cooking_methods, selection, origin_natural, origin_farmed,
               taste_rating, importance, knowledge_level, crawled_at
        FROM species_data
        WHERE name_ja IS NOT NULL AND name_ja != ''
    """)
    rows = cur.fetchall()
    conn.close()
    print(f"  Read {len(rows)} rows from SQLite")

    records = []
    for r in rows:
        records.append({
            "name_ja":         r["name_ja"],
            "url":             r["url"],
            "scientific_name": r["scientific_name"],
            "foreign_names":   r["foreign_names"],
            "category":        r["category"],
            "basic_info":      r["basic_info"],
            "market_note":     r["market_note"],
            "taste":           r["taste"],
            "season":          r["season"],
            "nutrition":       r["nutrition"],
            "cooking_methods": r["cooking_methods"],
            "selection":       r["selection"],
            "origin_natural":  r["origin_natural"],
            "origin_farmed":   r["origin_farmed"],
            "taste_rating":    r["taste_rating"],
            "importance":      r["importance"],
            "knowledge_level": r["knowledge_level"],
            "crawled_at":      r["crawled_at"],
        })

    ok, fail = chunk_upsert(records, "inari_zukan_species", "name_ja", key)
    print(f"  Zukan sync: {ok} upserted, {fail} failed")


# ── Task 2: Food knowledge MD ────────────────────────────────────────────────

def extract_title(content: str, filename: str) -> str:
    """Extract first # heading from markdown, fallback to filename."""
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
    # Strip frontmatter dashes and use filename as last resort
    base = os.path.splitext(filename)[0]
    return base


def strip_frontmatter(content: str) -> str:
    """Remove YAML frontmatter block if present."""
    if content.startswith("---"):
        idx = content.find("---", 3)
        if idx != -1:
            return content[idx + 3:].lstrip("\n")
    return content


def sync_food_knowledge(key: str):
    print("\n[2/2] Syncing food knowledge MD files...")
    records = []

    for subdir, category in FOOD_SUBDIRS.items():
        dirpath = os.path.join(FOOD_BASE, subdir)
        if not os.path.isdir(dirpath):
            print(f"  SKIP: {dirpath} not found")
            continue

        md_files = sorted(f for f in os.listdir(dirpath) if f.endswith(".md"))
        for fname in md_files:
            fpath = os.path.join(dirpath, fname)
            try:
                with open(fpath, encoding="utf-8") as f:
                    raw = f.read()
            except Exception as e:
                print(f"  WARN: Could not read {fpath}: {e}")
                continue

            content_stripped = strip_frontmatter(raw)
            title = extract_title(content_stripped, fname)
            # Keep first 3000 chars of content
            excerpt = content_stripped[:3000]

            records.append({
                "source_dir": subdir,
                "filename":   fname,
                "title":      title,
                "content":    excerpt,
                "category":   category,
            })

    print(f"  Read {len(records)} MD files")
    ok, fail = chunk_upsert(records, "inari_food_knowledge", "filename", key)
    print(f"  Food knowledge sync: {ok} upserted, {fail} failed")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=== Inari Knowledge Sync to Supabase ===")
    try:
        key = get_service_key()
        print("  Service role key: OK")
    except Exception as e:
        print(f"  FATAL: {e}")
        return

    sync_zukan(key)
    sync_food_knowledge(key)
    print("\n=== Done ===")


if __name__ == "__main__":
    main()
