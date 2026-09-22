import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import LeadCarousel from './LeadCarousel.jsx';

const ITEMS = ['One', 'Two', 'Three'];

const renderCarousel = (items = ITEMS) => render(
  <LeadCarousel
    items={items}
    getKey={(item) => item}
    renderItem={(item) => <h2>{item}</h2>}
    interval={5000}
  />,
);

const active = () => document.querySelector('.lead-slide.is-active');

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LeadCarousel', () => {
  test('a single item renders without carousel controls', () => {
    renderCarousel(['Only']);
    expect(screen.getByRole('heading', { name: 'Only' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next lead story' })).not.toBeInTheDocument();
  });

  test('advances on its own every interval and wraps around', () => {
    renderCarousel();
    expect(active()).toHaveTextContent('One');
    act(() => { vi.advanceTimersByTime(5000); });
    expect(active()).toHaveTextContent('Two');
    expect(active()).toHaveClass('lead-slide--next');
    act(() => { vi.advanceTimersByTime(5000); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(active()).toHaveTextContent('One');
  });

  test('previous slides the other way and wraps to the last story', () => {
    renderCarousel();
    fireEvent.click(screen.getByRole('button', { name: 'Previous lead story' }));
    expect(active()).toHaveTextContent('Three');
    expect(active()).toHaveClass('lead-slide--prev');
  });

  test('dots jump straight to a story', () => {
    renderCarousel();
    fireEvent.click(screen.getByRole('button', { name: 'Show lead story 3 of 3' }));
    expect(active()).toHaveTextContent('Three');
    expect(screen.getByRole('button', { name: 'Show lead story 3 of 3' }))
      .toHaveAttribute('aria-current', 'true');
  });

  test('pause stops the rotation and play resumes it', () => {
    renderCarousel();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => { vi.advanceTimersByTime(20000); });
    expect(active()).toHaveTextContent('One');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.blur(screen.getByRole('button', { name: 'Pause' }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(active()).toHaveTextContent('Two');
  });

  test('hovering holds the rotation', () => {
    renderCarousel();
    fireEvent.mouseEnter(screen.getByRole('region', { name: 'Lead stories' }));
    act(() => { vi.advanceTimersByTime(20000); });
    expect(active()).toHaveTextContent('One');
  });

  test('arrow keys move between stories', () => {
    renderCarousel();
    const region = screen.getByRole('region', { name: 'Lead stories' });
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(active()).toHaveTextContent('Two');
    fireEvent.keyDown(region, { key: 'ArrowLeft' });
    expect(active()).toHaveTextContent('One');
  });
});

describe('LeadCarousel first paint and late leads', () => {
  test('the first story is shown at rest, without a slide-in', () => {
    renderCarousel();
    expect(active()).not.toHaveClass('lead-slide--next');
    expect(active()).not.toHaveClass('lead-slide--prev');
  });

  test('a lead arriving later keeps the current story on screen', () => {
    const { rerender } = renderCarousel();
    fireEvent.click(screen.getByRole('button', { name: 'Next lead story' }));
    expect(active()).toHaveTextContent('Two');
    rerender(
      <LeadCarousel
        items={['Zero', ...ITEMS]}
        getKey={(item) => item}
        renderItem={(item) => <h2>{item}</h2>}
        interval={5000}
      />,
    );
    expect(active()).toHaveTextContent('Two');
  });
});
