import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import App from './App.jsx';

vi.mock('axios', () => ({
  default: {
    get: vi.fn((url) => {
      if (url.endsWith('/api/sites')) {
        return Promise.resolve({ data: ['nvidia'] });
      }

      if (url.endsWith('/api/topics')) {
        return Promise.resolve({ data: ['AI'] });
      }

      return Promise.resolve({
        data: [{
          url: 'https://example.com/article',
          site: 'nvidia',
          topic: 'AI',
          title: 'A deployable Precis story',
          author: 'Precis',
          published_at: '2026-08-31',
          image_url: '',
          body_text: 'A concise article summary for the deployment smoke test.',
          fetched_at: '2026-08-31T00:00:00Z',
        }],
      });
    }),
  },
}));

describe('App', () => {
  test('renders the Precis feed after loading articles', async () => {
    render(<App />);

    expect(await screen.findByText('Weekly Tech Brief')).toBeInTheDocument();
    expect(await screen.findByText('A deployable Precis story')).toBeInTheDocument();
  });
});
