import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { initAnalytics, trackPageView } from '../analytics';

const AnalyticsTracker = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    if (initAnalytics()) {
      trackPageView(pathname);
    }
  }, [pathname]);

  return null;
};

export default AnalyticsTracker;