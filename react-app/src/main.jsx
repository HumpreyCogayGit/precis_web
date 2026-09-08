import React from 'react';
import ReactDOM from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import './index.css';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App.jsx';
import CookieConsent from './components/CookieConsent.jsx';
import { initTheme } from './components/ThemeToggle.jsx';
import TrendingPage from './pages/TrendingPage.jsx';
import { PrivacyPolicyPage, TermsPage } from './pages/LegalPages.jsx';
import reportWebVitals from './reportWebVitals';

initTheme();

// The router lives here rather than inside App so that `/` renders the existing
// App component verbatim -- no new provider, state or wrapper reaches the home
// page. web/vercel.json already rewrites /(.*) -> index.html, so a deep link or a
// hard refresh on /trending resolves with no config change.
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/trending" element={<TrendingPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsPage />} />
      </Routes>
      <CookieConsent />
    </BrowserRouter>
    <Analytics />
  </React.StrictMode>
);

reportWebVitals();
