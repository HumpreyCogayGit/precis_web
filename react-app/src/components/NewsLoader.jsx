const ArticleLines = () => (
  <span className="news-loader__lines">
    <i />
    <i />
    <i />
  </span>
);

const NewsLoader = () => (
  <main className="news-loading" aria-live="polite" aria-busy="true">
    <div className="news-loading__brand" aria-hidden="true">
      Precis<span>.</span>
    </div>

    <div className="news-loader" aria-hidden="true">
      <div className="news-loader__scene">
        <div className="news-loader__board">
          <span className="news-loader__grid" />
          <span className="news-loader__route news-loader__route--one" />
          <span className="news-loader__route news-loader__route--two" />
          <span className="news-loader__route news-loader__route--three" />
          <span className="news-loader__signal news-loader__signal--one" />
          <span className="news-loader__signal news-loader__signal--two" />
          <span className="news-loader__signal news-loader__signal--three" />

          <div className="news-loader__press">
            <span className="news-loader__press-mark">P</span>
            <span className="news-loader__press-label">TODAY</span>
          </div>

          <div className="news-loader__article news-loader__article--one">
            <span className="news-loader__article-image" />
            <ArticleLines />
          </div>
          <div className="news-loader__article news-loader__article--two">
            <span className="news-loader__article-image" />
            <ArticleLines />
          </div>
          <div className="news-loader__article news-loader__article--three">
            <span className="news-loader__article-image" />
            <ArticleLines />
          </div>

          <div className="news-loader__topic news-loader__topic--ai">
            <strong>AI</strong>
            <span>01</span>
          </div>
          <div className="news-loader__topic news-loader__topic--cyber">
            <strong>CY</strong>
            <span>02</span>
          </div>
          <div className="news-loader__topic news-loader__topic--signal">
            <span className="news-loader__pulse" />
            <span>LIVE</span>
          </div>
        </div>
      </div>
    </div>

    <div className="news-loading__copy">
      <p className="state-kicker">Gathering the signal</p>
      <h1>Building today&rsquo;s <span>edition.</span></h1>
      <div className="news-loading__progress" aria-hidden="true"><span /></div>
    </div>
  </main>
);

export default NewsLoader;
