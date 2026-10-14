import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import PAGE_META from '../pageMeta.json';

// The build writes each route's title into its own HTML shell (scripts/render-pages.js),
// but a client-side navigation keeps the shell of whatever page loaded first. This
// sets the same title and description on every route change, so tabs, history and
// GA4's page_title (read in trackPageView) name the page actually on screen. It must
// render before AnalyticsTracker so its effect runs first.
const byPath = new Map(PAGE_META.pages.map((page) => [page.path, page]));

export const metaForPath = (pathname) => {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return byPath.get(normalized) ?? byPath.get('/');
};

const PageMeta = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const page = metaForPath(pathname);
    document.title = page.title;
    const description = document.querySelector('meta[name="description"]');
    if (description) {
      description.setAttribute('content', page.description);
    }
  }, [pathname]);

  return null;
};

export default PageMeta;
