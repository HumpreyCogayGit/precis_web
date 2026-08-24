import './App.css';
import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : '');
const INITIAL_ARTICLE_COUNT = 12;
const ARTICLES_PER_PAGE = 12;

const proxiedImageUrl = (imageUrl) => (
  imageUrl ? `${API_BASE_URL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}` : ''
);

const parseDateTimestamp = (dateValue) => {
  if (!dateValue) {
    return 0;
  }

  const normalizedDate = String(dateValue).trim().replace(/^Published\s+/i, '');
  const timestamp = Date.parse(normalizedDate);

  if (!Number.isNaN(timestamp)) {
    return timestamp;
  }

  const utcTimestamp = Date.parse(`${normalizedDate} UTC`);
  return Number.isNaN(utcTimestamp) ? 0 : utcTimestamp;
};

const getArticleTimestamp = (article) => {
  return parseDateTimestamp(article.published_at) || parseDateTimestamp(article.fetched_at);
};

const getInitialVisibleCount = (site = '', topic = '') => (
  site || topic ? INITIAL_ARTICLE_COUNT : Number.POSITIVE_INFINITY
);

const formatSiteName = (site = '') => (
  site
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
);

const buildArticleUrl = (site = '', topic = '') => {
  const path = site ? `/api/articles/${encodeURIComponent(site)}` : '/api/articles';
  const params = new URLSearchParams();

  if (topic) {
    params.set('topic', topic);
  }

  const query = params.toString();
  return `${API_BASE_URL}${path}${query ? `?${query}` : ''}`;
};

const formatDisplayDate = (dateValue, options = {}) => {
  const timestamp = typeof dateValue === 'number' ? dateValue : parseDateTimestamp(dateValue);

  if (!timestamp) {
    return 'Date not captured';
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  }).format(new Date(timestamp));
};

const getExcerpt = (article) => {
  const excerpt = article.body_text?.replace(/\s+/g, ' ').trim();
  return excerpt ? `${excerpt.substring(0, 220)}${excerpt.length > 220 ? '…' : ''}` : 'No article text was captured yet.';
};

const ArticleCard = ({ article, variant = 'standard' }) => (
  <article className={`article-card article-card--${variant}`}>
    {article.image_url && (
      <a href={article.url} target="_blank" rel="noopener noreferrer" className="image-link" aria-label={`Open ${article.title}`}>
        <img src={proxiedImageUrl(article.image_url)} alt="" className="article-image" />
      </a>
    )}
    <div className="article-body">
      <div className="article-meta">
        <span className="site">{formatSiteName(article.site)}</span>
        {article.topic && <span className="topic">{article.topic}</span>}
        {article.published_at && <span className="date">{formatDisplayDate(article.published_at)}</span>}
      </div>
      <h2><a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a></h2>
      <p className="article-excerpt">{getExcerpt(article)}</p>
    </div>
    <div className="article-footer">
      {article.author && <span className="author">{article.author}</span>}
      <small>Captured {formatDisplayDate(article.fetched_at, { hour: '2-digit', minute: '2-digit' })}</small>
    </div>
  </article>
);

function App() {
  const [articles, setArticles] = useState([]);
  const [sites, setSites] = useState([]);
  const [topics, setTopics] = useState([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [selectedTopic, setSelectedTopic] = useState('');
  const [visibleCount, setVisibleCount] = useState(INITIAL_ARTICLE_COUNT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchArticles = useCallback(async (site = '', topic = '') => {
    try {
      setLoading(true);
      const response = await axios.get(buildArticleUrl(site, topic));

      setArticles(response.data);
      setVisibleCount(getInitialVisibleCount(site, topic));
      setError(null);
    } catch (err) {
      setError('Failed to fetch articles');
      console.error('Error fetching articles:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSites = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/sites`);
      setSites(response.data);
    } catch (err) {
      console.error('Error fetching sites:', err);
    }
  }, []);

  const fetchTopics = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/topics`);
      setTopics(response.data);
    } catch (err) {
      console.error('Error fetching topics:', err);
    }
  }, []);

  useEffect(() => {
    fetchSites();
    fetchTopics();
    fetchArticles();
  }, [fetchArticles, fetchSites, fetchTopics]);

  const handleSiteChange = (e) => {
    const site = e.target.value;
    setSelectedSite(site);
    fetchArticles(site, selectedTopic);
  };

  const handleTopicChange = (e) => {
    const topic = e.target.value;
    setSelectedTopic(topic);
    fetchArticles(selectedSite, topic);
  };

  const handleSourceClick = (site = '') => {
    setSelectedSite(site);
    fetchArticles(site, selectedTopic);
  };

  const handleTopicClick = (topic = '') => {
    setSelectedTopic(topic);
    fetchArticles(selectedSite, topic);
  };

  const sortedArticles = useMemo(
    () => [...articles].sort((a, b) => getArticleTimestamp(b) - getArticleTimestamp(a)),
    [articles]
  );

  const visibleArticles = Number.isFinite(visibleCount)
    ? sortedArticles.slice(0, visibleCount)
    : sortedArticles;
  const hasMoreArticles = visibleCount < sortedArticles.length;
  const featuredArticle = sortedArticles[0];
  const feedArticles = featuredArticle ? visibleArticles.slice(1) : visibleArticles;
  const topStories = sortedArticles.slice(1, 5);

  const handleShowMore = () => {
    setVisibleCount((currentCount) => currentCount + ARTICLES_PER_PAGE);
  };

  if (loading) {
    return (
      <div className="app app-state">
        <div className="loader-card" aria-live="polite">
          <span className="loader-line" aria-hidden="true"></span>
          <p className="state-kicker">Loading</p>
          <h1>Pulling the latest articles.</h1>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app app-state">
        <div className="message-card">
          <p className="state-kicker">No connection</p>
          <h1>The article list did not load.</h1>
          <p>{error}. Start the Precis web server, then refresh this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {sortedArticles.length > 0 ? (
        <>
          <section className="hero-stage" aria-labelledby="hero-title">
            <div className="hero-copy">
              <a className="brand hero-brand" href="/" aria-label="Precis home">
                <span>PRECIS</span>
              </a>
              <h1 id="hero-title">Weekly Tech Brief</h1>
              <p className="hero-deck">
                Curated news, blog posts, and product updates from leading tech teams, refreshed weekly.
              </p>

              {(sites.length > 0 || topics.length > 0) && (
                <div className="hero-filters" aria-label="Article filters">
                  {sites.length > 0 && (
                    <div className="filter-section">
                      <label htmlFor="site-filter">Source</label>
                      <div className="select-wrap">
                        <select id="site-filter" value={selectedSite} onChange={handleSiteChange}>
                          <option value="">All sources</option>
                          {sites.map(site => (
                            <option key={site} value={site}>{formatSiteName(site)}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {topics.length > 0 && (
                    <div className="filter-section">
                      <label htmlFor="topic-filter">Topic</label>
                      <div className="select-wrap">
                        <select id="topic-filter" value={selectedTopic} onChange={handleTopicChange}>
                          <option value="">All topics</option>
                          {topics.map(topic => (
                            <option key={topic} value={topic}>{topic}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <aside className="hero-feature" aria-label="Featured article">
              <span className="content-label">Featured</span>
              {featuredArticle.image_url && (
                <a href={featuredArticle.url} target="_blank" rel="noopener noreferrer" className="feature-image-link" aria-label={`Open ${featuredArticle.title}`}>
                  <img src={proxiedImageUrl(featuredArticle.image_url)} alt="" />
                </a>
              )}
              <div className="feature-copy">
                <div className="article-meta">
                  <span className="site">{formatSiteName(featuredArticle.site)}</span>
                  {featuredArticle.topic && <span className="topic">{featuredArticle.topic}</span>}
                  {featuredArticle.published_at && <span className="date">{formatDisplayDate(featuredArticle.published_at)}</span>}
                </div>
                <h2><a href={featuredArticle.url} target="_blank" rel="noopener noreferrer">{featuredArticle.title}</a></h2>
                <p>{getExcerpt(featuredArticle)}</p>
              </div>
            </aside>
          </section>

          <div className="section-divider" aria-hidden="true"></div>

          <section id="discover" className="source-panel source-panel--sources" aria-label="Available sources">
            <div className="section-heading">
              <p className="section-kicker">Discover</p>
              <h2>Explore by source</h2>
            </div>
            <div className="source-strip">
              <button
                type="button"
                className={`source-chip${selectedSite === '' ? ' active' : ''}`}
                onClick={() => handleSourceClick('')}
              >
                All sources
              </button>
              {sites.map((site) => (
                <button
                  key={site}
                  type="button"
                  className={`source-chip${selectedSite === site ? ' active' : ''}`}
                  onClick={() => handleSourceClick(site)}
                >
                  {formatSiteName(site)}
                </button>
              ))}

            </div>
          </section>

          {topics.length > 0 && (
            <section className="source-panel topic-panel" aria-label="Available topics">
              <div className="section-heading">
                <h2>Explore by topic</h2>
              </div>
              <div className="source-strip">
                <button
                  type="button"
                  className={`source-chip${selectedTopic === '' ? ' active' : ''}`}
                  onClick={() => handleTopicClick('')}
                >
                  All topics
                </button>
                {topics.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    className={`source-chip${selectedTopic === topic ? ' active' : ''}`}
                    onClick={() => handleTopicClick(topic)}
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </section>
          )}

          {topStories.length > 0 && (
            <section id="popular" className="top-stories" aria-labelledby="top-stories-title">
              <div className="section-heading section-heading--inline">
                <p className="section-kicker">Popular on Precis</p>
                <h2 id="top-stories-title">Editors Picks</h2>
              </div>
              <div className="story-list">
                {topStories.map((article, index) => (
                  <a key={article.url} href={article.url} target="_blank" rel="noopener noreferrer" className="story-row">
                    <span className="story-rank">{String(index + 1).padStart(2, '0')}</span>
                    <span className="story-topic">{article.topic || formatSiteName(article.site)}</span>
                    <strong>{article.title}</strong>
                    <small>{article.published_at ? formatDisplayDate(article.published_at) : 'Date not captured'}</small>
                  </a>
                ))}
              </div>
            </section>
          )}

          <main id="latest" className="latest-section" aria-label="Scraped articles">
            <div className="section-heading section-heading--inline">
              <p className="section-kicker">Newest from Precis</p>
              <h2>Browse All</h2>
            </div>
            <div className="articles-container">
              {feedArticles.map((article, index) => (
                <ArticleCard key={article.url} article={article} variant={index === 0 ? 'wide' : 'standard'} />
              ))}
            </div>
          </main>

          {hasMoreArticles && (
            <div className="show-more-section">
              <button type="button" className="show-more-button" onClick={handleShowMore}>
                Show 12 more
              </button>
              <p className="article-count">
                Showing {visibleArticles.length} of {sortedArticles.length} articles
              </p>
            </div>
          )}
        </>
      ) : (
        <section className="empty-state">
          <p className="state-kicker">Nothing here yet</p>
          <h2>No captured articles for this source.</h2>
          <p>Choose another source, or run the scraper and refresh this page.</p>
        </section>
      )}
    </div>
  );
}

export default App;