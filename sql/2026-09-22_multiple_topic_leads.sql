\set ON_ERROR_STOP on

BEGIN;

-- A topic now holds several leads, which the front page rotates through. The key
-- widens from topic alone to (topic, article_url); existing single leads carry over.
ALTER TABLE public.article_leads DROP CONSTRAINT IF EXISTS article_leads_pkey;
ALTER TABLE public.article_leads ADD PRIMARY KEY (topic, article_url);

COMMIT;

\echo 'AI and Cyber Security topics accept multiple leads.'
