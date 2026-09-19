\set ON_ERROR_STOP on

BEGIN;

DROP INDEX IF EXISTS public.idx_articles_single_lead;

CREATE TABLE IF NOT EXISTS public.article_leads (
  topic TEXT PRIMARY KEY REFERENCES public.topics(name),
  article_url TEXT NOT NULL REFERENCES public.articles(url) ON DELETE CASCADE,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT article_leads_supported_topic CHECK (topic IN ('AI', 'Cyber Security'))
);

INSERT INTO public.article_leads(topic, article_url)
SELECT topic, url FROM public.articles
WHERE is_lead AND topic IN ('AI', 'Cyber Security')
ON CONFLICT (topic) DO NOTHING;

UPDATE public.articles a
SET is_lead = EXISTS (
  SELECT 1 FROM public.article_leads l WHERE l.article_url = a.url
);

COMMIT;

\echo 'Independent AI and Cyber Security lead slots configured.'