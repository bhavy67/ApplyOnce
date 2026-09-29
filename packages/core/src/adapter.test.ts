import { describe, expect, it } from 'vitest';
import {
  resolvePlatform,
  type DetectionStrength,
  type FormAdapter,
  type PlatformDetection,
} from './adapter';

function fakeAdapter(
  id: string,
  detect: (url: string) => DetectionStrength | PlatformDetection,
): FormAdapter<null> {
  return {
    id,
    detect: ({ url }) => {
      const result = detect(url);
      return typeof result === 'string' ? { strength: result, evidence: [result] } : result;
    },
    getFields: () => [],
    fillFields: () => Promise.resolve([]),
  };
}

const context = { url: 'https://jobs.example.com/apply', root: null };
const fallback = fakeAdapter('generic', () => 'none');
const resolve = (...adapters: FormAdapter<null>[]) => resolvePlatform(adapters, fallback, context);

describe('resolvePlatform', () => {
  it.each<[DetectionStrength, string, string]>([
    ['host', 'site', 'host'],
    ['structure', 'site', 'structure'],
    ['weak', 'generic', 'no-evidence'],
    ['none', 'generic', 'no-evidence'],
  ])('%s evidence → %s (%s)', (strength, adapter, reason) => {
    const result = resolve(fakeAdapter('site', () => strength));
    expect(result.adapter.id).toBe(adapter);
    expect(result.reason).toBe(reason);
  });

  it('the strongest evidence wins: a host beats another platform’s structure', () => {
    const a = fakeAdapter('a', () => 'structure');
    const b = fakeAdapter('b', () => 'host');
    expect(resolve(a, b).adapter.id).toBe('b');
    expect(resolve(b, a).adapter.id).toBe('b');
  });

  it('structure beats weak evidence from another platform', () => {
    const a = fakeAdapter('a', () => 'weak');
    const b = fakeAdapter('b', () => 'structure');
    expect(resolve(a, b).adapter.id).toBe('b');
  });

  it.each<DetectionStrength>(['host', 'structure'])(
    'a tie at %s is a conflict: generic, whatever the order',
    (strength) => {
      const a = fakeAdapter('a', () => strength);
      const b = fakeAdapter('b', () => strength);
      for (const order of [
        [a, b],
        [b, a],
      ]) {
        const result = resolve(...order);
        expect(result.adapter.id).toBe('generic');
        expect(result.reason).toBe('conflict');
      }
    },
  );

  it('several weak signals never select an adapter', () => {
    const result = resolve(
      fakeAdapter('a', () => 'weak'),
      fakeAdapter('b', () => 'weak'),
    );
    expect(result).toMatchObject({ reason: 'no-evidence' });
    expect(result.adapter.id).toBe('generic');
  });

  it('a detector that throws counts as no evidence', () => {
    const broken = fakeAdapter('broken', () => {
      throw new Error('boom');
    });
    expect(resolve(broken).adapter.id).toBe('generic');
    expect(
      resolve(
        broken,
        fakeAdapter('ok', () => 'structure'),
      ).adapter.id,
    ).toBe('ok');
  });

  it('reports every site adapter’s evidence, in order', () => {
    const result = resolve(
      fakeAdapter('a', () => 'weak'),
      fakeAdapter('b', () => 'host'),
    );
    expect(result.detections).toEqual([
      { id: 'a', detection: { strength: 'weak', evidence: ['weak'] } },
      { id: 'b', detection: { strength: 'host', evidence: ['host'] } },
    ]);
  });
});
