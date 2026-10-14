import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, test } from 'vitest';

import PageMeta, { metaForPath } from './PageMeta.jsx';

const Navigate = () => {
  window.navigateForPageMetaTest = useNavigate();
  return null;
};

beforeEach(() => {
  document.head.innerHTML = '<meta name="description" content="static" />';
  document.title = 'static';
});

describe('PageMeta', () => {
  test('maps routes, a trailing slash and unknown paths', () => {
    expect(metaForPath('/tldr').path).toBe('/tldr');
    expect(metaForPath('/threats/').path).toBe('/threats');
    expect(metaForPath('/no-such-page').path).toBe('/');
  });

  test('sets the title and description on navigation', () => {
    render(
      <MemoryRouter initialEntries={['/trending']}>
        <PageMeta />
        <Navigate />
      </MemoryRouter>,
    );

    expect(document.title).toBe(metaForPath('/trending').title);

    act(() => window.navigateForPageMetaTest('/threats?feed=cves'));
    expect(document.title).toBe(metaForPath('/threats').title);
    expect(document.querySelector('meta[name="description"]').getAttribute('content'))
      .toBe(metaForPath('/threats').description);
  });
});
