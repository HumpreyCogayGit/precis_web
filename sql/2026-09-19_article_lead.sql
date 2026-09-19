\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS is_lead BOOLEAN NOT NULL DEFAULT FALSE;

WITH ranked_leads AS (
  SELECT url, row_number() OVER (ORDER BY fetched_at DESC, url) AS position
  FROM public.articles
  WHERE is_lead
)
UPDATE public.articles a
SET is_lead = FALSE
FROM ranked_leads r
WHERE a.url = r.url AND r.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_single_lead
  ON public.articles (is_lead) WHERE is_lead;

COMMIT;

\echo 'Single article lead designation configured.'