// Source display names, shared by the renderer and the search predicate.
//
// The stored site is a slug ("open_ai"); the reader only ever sees the masthead
// ("OpenAI"). Search has to match what the reader sees — nobody types "open_ai" —
// so this lives outside App.jsx rather than being threaded through filters.js as
// an option.

export const SOURCE_DISPLAY_NAMES = {
  alibaba: 'Alibaba Cloud',
  anthropic_news: 'Anthropic',
  google_innovation_ai: 'Google AI',
  krebs_on_security: 'KrebsOnSecurity',
  microsoft_ai_blog: 'Microsoft AI',
  nvidia: 'NVIDIA',
  open_ai: 'OpenAI',
  open_ai_releases: 'OpenAI',
  perplexity_blog: 'Perplexity',
  together_ai_blog: 'Together AI',
  x_ai_news: 'xAI',
};

export const formatSiteName = (site = '') => {
  const normalizedSite = String(site).trim().toLowerCase();

  if (SOURCE_DISPLAY_NAMES[normalizedSite]) {
    return SOURCE_DISPLAY_NAMES[normalizedSite];
  }

  return String(site)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bAi\b/g, 'AI');
};
