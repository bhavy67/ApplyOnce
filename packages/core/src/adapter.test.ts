import { describe, expect, it } from 'vitest';
import { selectAdapter, type FormAdapter } from './adapter';

function fakeAdapter(id: string, hostname: string): FormAdapter<null> {
  return {
    id,
    detect: ({ url }) => url.includes(hostname),
    getFields: () => [],
  };
}

describe('selectAdapter', () => {
  const site = fakeAdapter('site', 'jobs.example.com');
  const fallback = fakeAdapter('generic', '');

  it('picks the first site adapter that detects the page', () => {
    const context = { url: 'https://jobs.example.com/apply', root: null };
    expect(selectAdapter([site], fallback, context).id).toBe('site');
  });

  it('falls back when no site adapter matches', () => {
    const context = { url: 'https://other.example.org/form', root: null };
    expect(selectAdapter([site], fallback, context).id).toBe('generic');
  });
});
