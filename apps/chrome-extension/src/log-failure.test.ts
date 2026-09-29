import { afterEach, describe, expect, it, vi } from 'vitest';
import { logFailure } from './log-failure';

/** Every source file in the workspace packages, as text (Vite glob; tests filtered out). */
const SOURCES = Object.entries(
  import.meta.glob<string>('../../../{apps,packages,adapters}/*/src/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
).filter(([path]) => !/\.test\.tsx?$/.test(path) && !/(^|\/)log-failure\.ts$/.test(path));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logging audit (Phase 16)', () => {
  it('logFailure records the operation and error type only, never the message', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logFailure('page fill', new TypeError('jane.doe@example.com at https://jane.example.com'));
    logFailure('page scan', 'University A');
    expect(error.mock.calls).toEqual([
      ['ApplyOnce: page fill failed (TypeError)'],
      ['ApplyOnce: page scan failed (string)'],
    ]);
  });

  it('no production code logs anything except through logFailure', () => {
    expect(SOURCES.length).toBeGreaterThan(50);
    const offenders = SOURCES.filter(([, text]) => /\bconsole\s*\.\s*\w+\s*\(/.test(text));
    expect(offenders.map(([path]) => path)).toEqual([]);
  });

  it('logFailure is never given values: only fixed operation names and errors', () => {
    const calls = SOURCES.flatMap(([, text]) =>
      [...text.matchAll(/logFailure\(\s*([^,]+),/g)].map((m) => m[1]?.trim()),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const operation of calls) {
      // A string literal, or a template naming only the adapter or message type.
      expect(operation).toMatch(/^'[^']*'$|^`[^`$]*(\$\{(adapter\.id|message\.type)\}[^`$]*)*`$/);
    }
  });
});
