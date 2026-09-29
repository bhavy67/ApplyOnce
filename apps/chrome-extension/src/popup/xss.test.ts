// @vitest-environment happy-dom
/**
 * Phase 17: page-controlled text (labels, names, ids, options) and results from the page's
 * process are rendered as text in the popup, never as HTML. React escapes text; nothing in
 * the popup uses raw HTML (see the source audit in security.test.ts).
 */
import type { FillResult, FormField } from '@applyonce/core';
import { createAliasMatcher, mapFields } from '@applyonce/field-mapper';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReviewedMapping } from '../messaging/protocol';
import { ReviewList } from './ReviewList';

const HOSTILE = [
  '<img src=x onerror="window.__xss=1">',
  '<script>window.__xss=2</script>',
  '"><svg onload="window.__xss=3">',
  'javascript:alert(1)',
];

const field = (id: string, signals: FormField['signals']): FormField => ({
  id,
  type: 'text',
  htmlType: 'text',
  required: false,
  visible: true,
  disabled: false,
  signals,
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('popup rendering of hostile page text', () => {
  it('labels, names, ids, and result messages appear as literal text; nothing executes', async () => {
    const fields = HOSTILE.map((text, i) =>
      field(`id:f${i}`, { label: text, name: text, htmlId: `f${i}"><b>x</b>` }),
    );
    const mappings = new Map<string, ReviewedMapping>(
      mapFields(fields, createAliasMatcher()).mappings.map((m) => [
        m.fieldId,
        { ...m, hasValue: false },
      ]),
    );
    const results = new Map<string, FillResult>(
      fields.map((f, i) => [f.id, { fieldId: f.id, status: 'failed', message: HOSTILE[i] ?? '' }]),
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(ReviewList, {
          fields,
          mappings,
          selected: new Set<string>(),
          results,
          records: { education: 0, workExperience: 0, certifications: 0 },
          disabled: false,
          onToggle: () => undefined,
          onTeach: () => Promise.resolve(undefined),
          onUnassign: () => Promise.resolve(undefined),
        }),
      );
    });
    expect(container.querySelectorAll('img, script, svg, b').length).toBe(0);
    for (const text of HOSTILE) expect(container.textContent).toContain(text);
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
    await act(async () => root.unmount());
  });
});
