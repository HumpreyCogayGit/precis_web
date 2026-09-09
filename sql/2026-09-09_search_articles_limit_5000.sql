\set ON_ERROR_STOP on

-- Neon/hosted DB migration for the 5000-row working set change.
--
-- The application-side article list cap moved from 600 to 5000. The search
-- SECURITY DEFINER function has its own defensive clamp, so hosted databases
-- must receive the same function body or search results can still truncate at
-- the old ceiling. This includes the canonical, idempotent function definition
-- so grants and SECURITY DEFINER settings stay in one source of truth.

\ir create-search-articles-function.sql
