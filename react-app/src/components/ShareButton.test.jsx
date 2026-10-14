import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import * as analytics from '../analytics';
import ShareButton from './ShareButton.jsx';

const URL_ = 'https://example.com/story';

beforeEach(() => {
  vi.spyOn(analytics, 'trackShare').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete navigator.share;
  delete navigator.clipboard;
});

describe('ShareButton', () => {
  test('renders nothing without a URL', () => {
    const { container } = render(<ShareButton url={null} title="t" contentType="article" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('uses the native share sheet when there is one', async () => {
    navigator.share = vi.fn().mockResolvedValue(undefined);
    render(<ShareButton url={URL_} title="A story" contentType="article" />);

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share: A story' })));

    expect(navigator.share).toHaveBeenCalledWith({ title: 'A story', url: URL_ });
    expect(analytics.trackShare).toHaveBeenCalledWith('native', 'article');
  });

  test('a dismissed share sheet is neither an error nor a share', async () => {
    navigator.share = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
    render(<ShareButton url={URL_} title="A story" contentType="article" />);

    await act(async () => fireEvent.click(screen.getByRole('button')));

    expect(screen.getByRole('button')).toHaveTextContent('Share');
    expect(analytics.trackShare).not.toHaveBeenCalled();
  });

  test('falls back to copying the link, then resets', async () => {
    vi.useFakeTimers();
    navigator.clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    render(<ShareButton url={URL_} title="A story" contentType="tldr" />);

    await act(async () => fireEvent.click(screen.getByRole('button')));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(URL_);
    expect(analytics.trackShare).toHaveBeenCalledWith('copy_link', 'tldr');
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Link copied');

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Share');
  });

  test('says so when the copy fails', async () => {
    navigator.clipboard = { writeText: vi.fn().mockRejectedValue(new Error('denied')) };
    render(<ShareButton url={URL_} title="A story" contentType="article" iconOnly />);

    await act(async () => fireEvent.click(screen.getByRole('button')));

    expect(screen.getByRole('button')).toHaveAttribute('title', 'Could not share');
    expect(analytics.trackShare).not.toHaveBeenCalled();
  });
});
