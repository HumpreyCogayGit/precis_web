# Public Article Moderation Model

Precis Web is currently a read-only public site. It does not expose admin or write endpoints. Public publication is controlled at the database read-model layer.

## Current model: automatic approval with scraper review holds

The scraper already stores extraction quality signals on each `articles` row:

- `needs_review BOOLEAN NOT NULL DEFAULT FALSE`
- `flag_reason TEXT`
- `matched_strategy TEXT`

For the current read-only product, these fields are sufficient as the publish/review status:

- `needs_review = FALSE` means the record is publishable and may appear in the public web API.
- `needs_review = TRUE` means the record is held for operator review and must not appear publicly.

The public API reads only `public.public_articles`, which applies `WHERE COALESCE(needs_review, FALSE) = FALSE` and exposes only public fields plus a truncated `excerpt`. It does not expose `body_text`, `content_hash`, `matched_strategy`, `flag_reason`, `raw_html_path`, or scraper run metadata.

## Operator review process

1. Review scraper run summaries and flagged counts after each run.
2. Inspect held records with an owner/scraper credential, never the web read-only credential:

   ```sql
   SELECT site, topic, url, title, matched_strategy, needs_review, flag_reason, fetched_at
   FROM public.articles
   WHERE needs_review = TRUE
   ORDER BY fetched_at DESC;
   ```

3. Fix extraction configs or source-specific selectors when flags indicate systemic extraction issues.
4. Re-run the scraper after fixes so records are re-extracted and `needs_review` is recalculated.
5. If a one-off record is acceptable after manual inspection, an operator with a write-capable scraper/admin credential may clear its hold:

   ```sql
   UPDATE public.articles
   SET needs_review = FALSE,
       flag_reason = NULL
   WHERE url = 'https://example.com/article-reviewed-by-operator';
   ```

6. Confirm the record appears through the public read model:

   ```sql
   SELECT url, title, excerpt
   FROM public.public_articles
   WHERE url = 'https://example.com/article-reviewed-by-operator';
   ```

## Future manual workflow

Before adding a browser-based moderation UI, add authenticated admin endpoints and a dedicated moderation status such as `publication_status IN ('pending', 'approved', 'rejected')`. Keep the public API behind the view and update `public.public_articles` to require both `publication_status = 'approved'` and `needs_review = FALSE`.