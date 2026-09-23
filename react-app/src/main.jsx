import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import './index.css';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App.jsx';
import AnalyticsTracker from './components/AnalyticsTracker.jsx';
import { initTheme } from './components/ThemeToggle.jsx';
import reportWebVitals from './reportWebVitals';

// The home page is the common entry, so it stays in the main bundle. Every other
// route is its own chunk, fetched on first visit, so no page downloads and parses
// the code of pages the reader never opens.
const TrendingPage = lazy(() => import('./pages/TrendingPage.jsx'));
const TldrPage = lazy(() => import('./pages/TldrPage.jsx'));
const PrivacyPolicyPage = lazy(() => import('./pages/LegalPages.jsx').then((m) => ({ default: m.PrivacyPolicyPage })));
const TermsPage = lazy(() => import('./pages/LegalPages.jsx').then((m) => ({ default: m.TermsPage })));

initTheme();

// The router lives here rather than inside App so that `/` renders the existing
// App component verbatim -- no new provider, state or wrapper reaches the home
// page. web/vercel.json already rewrites /(.*) -> index.html, so a deep link or a
// hard refresh on /trending resolves with no config change.
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/trending" element={<TrendingPage />} />
          <Route path="/tldr" element={<TldrPage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/terms" element={<TermsPage />} />
        </Routes>
      </Suspense>
      <AnalyticsTracker />
    </BrowserRouter>
    <Analytics />
    <SpeedInsights />
  </React.StrictMode>
);

// The loader in index.html covers the gap before this bundle has parsed and
// painted. Two frames after the first render puts the dismissal after React has
// committed, so the brief is on screen rather than a blank page.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    // Scoped to the boot splash: App mounts its own loader while it fetches.
    if (window.PrecisLoader) window.PrecisLoader.destroy('#precis-loader');
  });
});

reportWebVitals();
