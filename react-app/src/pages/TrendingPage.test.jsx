import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { TrendArticleRow } from './TrendingPage.jsx';

const renderArticle = (url, title = 'Example headline') => render(
  <TrendArticleRow article={{
    url,
    title,
    site: 'example',
    published_at: new Date().toISOString(),
  }} />,
);

describe('TrendArticleRow URL safety', () => {
  test.each([
    'javascript:alert(document.domain)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'not a URL',
    '',
    null,
  ])('does not link an unsafe or malformed URL: %s', (url) => {
    renderArticle(url);

    expect(screen.getByText('Example headline')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Example headline' })).toBeNull();
  });

  test.each([
    ['https://example.com/story', 'https://example.com/story'],
    ['http://example.com/story?q=security', 'http://example.com/story?q=security'],
  ])('links a valid web URL: %s', (url, expected) => {
    renderArticle(url);

    expect(screen.getByRole('link', { name: 'Example headline' })).toHaveAttribute('href', expected);
  });
});