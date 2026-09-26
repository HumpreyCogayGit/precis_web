\set ON_ERROR_STOP on

-- Exploit/CVE details for the /threats page.
--
-- public.articles.threat is JSONB written by scraper/scripts/enrich_threats.py for the
-- threat feeds (sploitus, oss_security) and NULL for every other source:
--   { v, kind, cves[], cvss, cvss_source, severity, products[], subject, github }
-- The web app draws each item's cover from it instead of the source logo.
--
-- Usage with psql and an owner/admin credential, on the hosted database and on staging:
--   psql "$ADMIN_DATABASE_URL" -f sql/2026-09-26_article_threat.sql

BEGIN;

ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS threat JSONB;

COMMIT;

-- Re-apply the public view so it exposes the column. Idempotent (CREATE OR REPLACE)
-- and keeps its existing grants.
\ir create-public-articles-view.sql

\echo 'articles.threat installed; public_articles now exposes it.'
