// @vitest-environment happy-dom
import type { FillInstruction, FormField } from '@applyonce/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { fillFields } from './fill-fields';
import { scanFields } from './scan-fields';

/** Field id → repeat count ("-" when not repeated), plus record for record-section fields. */
const marks = () =>
  Object.fromEntries(
    scanFields(document).map((f: FormField) => [
      f.id,
      f.record ? `${f.record.collection}[${f.record.index}]` : (f.repeatedCount ?? '-'),
    ]),
  );

const input = (id: string, label: string, type = 'text') =>
  `<label for="${id}">${label}</label><input id="${id}" type="${type}">`;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('repeated questions without record context', () => {
  it.each([
    ['exact duplicates', 'Degree', 'Degree'],
    ['required markers', 'Degree *', 'Degree (required)'],
    ['case', 'DEGREE', 'degree'],
    ['whitespace', '  Degree ', 'Degree'],
    ['punctuation', 'Degree:', 'Degree'],
  ])('%s are one repeated question', (_, a, b) => {
    document.body.innerHTML = `<section><h2>Education</h2>${input('a', a)}${input('b', b)}${input('u', 'University')}</section>`;
    expect(marks()).toEqual({ 'id:a': 2, 'id:b': 2, 'id:u': '-' });
  });

  it('matches a label with the same aria-label or placeholder question (same normalization)', () => {
    document.body.innerHTML = `<label for="a">Degree</label><input id="a">
      <input id="b" aria-label="Degree"><input id="c" placeholder="Degree *">`;
    expect(marks()).toEqual({ 'id:a': 3, 'id:b': 3, 'id:c': 3 });
  });

  it('ignores the control type: the same question twice is ambiguous whatever the widget', () => {
    document.body.innerHTML = `${input('a', 'Country')}<label for="b">Country</label><select id="b"><option>Canada</option></select>`;
    expect(marks()).toEqual({ 'id:a': 2, 'id:b': 2 });
  });

  it('does not treat different questions as repeated because they share a word', () => {
    document.body.innerHTML = `${input('a', 'Education level')}${input('b', 'Education preferences')}
      ${input('c', 'Current Company')}${input('d', 'Previous Company')}${input('e', 'Degree')}${input('f', 'Degree required')}`;
    expect(marks()).toEqual({
      'id:a': '-',
      'id:b': '-',
      'id:c': '-',
      'id:d': '-',
      'id:e': '-',
      'id:f': '-',
    });
  });

  it('keeps a single question as it is', () => {
    document.body.innerHTML = `<section><h2>Education</h2>${input('d', 'Degree')}${input('f', 'Field of Study')}${input('u', 'University')}</section>`;
    expect(marks()).toEqual({ 'id:d': '-', 'id:f': '-', 'id:u': '-' });
  });

  it('treats separate forms as separate scopes; fields outside forms share one scope', () => {
    document.body.innerHTML = `<form>${input('a', 'Email', 'email')}</form><form>${input('b', 'Email', 'email')}</form>
      ${input('c', 'Phone', 'tel')}<div>${input('d', 'Phone', 'tel')}</div>`;
    expect(marks()).toEqual({ 'id:a': '-', 'id:b': '-', 'id:c': 2, 'id:d': 2 });
  });

  it('repeats within one form even when other forms exist', () => {
    document.body.innerHTML = `<form>${input('a', 'Email', 'email')}${input('b', 'Email', 'email')}</form><form>${input('c', 'Email', 'email')}</form>`;
    expect(marks()).toEqual({ 'id:a': 2, 'id:b': 2, 'id:c': '-' });
  });

  it('distinguishes fieldset legends (context), but not plain headings', () => {
    document.body.innerHTML = `
      <fieldset><legend>Home</legend>${input('a', 'Phone', 'tel')}</fieldset>
      <fieldset><legend>Work</legend>${input('b', 'Phone', 'tel')}</fieldset>
      <div><h3>Home</h3>${input('c', 'Street')}</div><div><h3>Work</h3>${input('d', 'Street')}</div>`;
    expect(marks()).toEqual({ 'id:a': '-', 'id:b': '-', 'id:c': 2, 'id:d': 2 });
  });

  it('marks unlabeled duplicates by their shared name', () => {
    document.body.innerHTML = `<form><input name="phone[]"><input name="phone[]"><input name="other"></form>`;
    const fields = scanFields(document);
    expect(fields.map((f) => f.repeatedCount ?? '-')).toEqual([2, 2, '-']);
  });

  it('counts only visible copies (a hidden template does not make a field ambiguous)', () => {
    document.body.innerHTML = `${input('a', 'Degree')}<div hidden>${input('b', 'Degree')}</div>`;
    expect(marks()).toEqual({ 'id:a': '-', 'id:b': '-' });
  });

  it('leaves recognized record sections to their record context', () => {
    document.body.innerHTML = [1, 2, 3]
      .map((n) => `<div><h3>Education ${n}</h3>${input(`d${n}`, 'Degree')}</div>`)
      .join('');
    expect(marks()).toEqual({
      'id:d1': 'education[0]',
      'id:d2': 'education[1]',
      'id:d3': 'education[2]',
    });
  });

  it('marks a repeat outside the record sections while the records keep their context', () => {
    document.body.innerHTML = `${input('x', 'Degree')}${input('y', 'Degree')}
      <div><h3>Education 1</h3>${input('d1', 'Degree')}</div><div><h3>Education 2</h3>${input('d2', 'Degree')}</div>`;
    expect(marks()).toEqual({
      'id:x': 2,
      'id:y': 2,
      'id:d1': 'education[0]',
      'id:d2': 'education[1]',
    });
  });
});

describe('filling and repeated questions', () => {
  const instruction = (fieldId: string, value: string): FillInstruction => {
    const found = scanFields(document).find((f) => f.id === fieldId);
    if (!found) throw new Error('no field');
    const { name, htmlId, label } = found.signals;
    return { fieldId, value, expected: { type: found.type, name, htmlId, label } };
  };
  const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

  it('refuses a field that became repeated after Analyze, and keeps filling the others', async () => {
    document.body.innerHTML = `<form id="f">${input('deg', 'Degree')}${input('uni', 'University')}</form>`;
    const approved = [instruction('id:deg', 'Degree A'), instruction('id:uni', 'University A')];
    document.getElementById('f')?.insertAdjacentHTML('beforeend', input('deg2', 'Degree'));
    const results = await fillFields(document, approved);
    expect(results.map((r) => r.status)).toEqual(['skipped', 'filled']);
    expect(results[0]?.message).toBe(
      'This question now appears more than once on the page. Analyze again.',
    );
    expect([value('deg'), value('deg2'), value('uni')]).toEqual(['', '', 'University A']);
  });

  it('fills a field that stopped being repeated, once it is approved from a new analysis', async () => {
    document.body.innerHTML = `<form>${input('deg', 'Degree')}<div id="extra">${input('deg2', 'Degree')}</div></form>`;
    expect(scanFields(document)[0]?.repeatedCount).toBe(2);
    document.getElementById('extra')?.remove();
    expect(scanFields(document)[0]?.repeatedCount).toBeUndefined();
    const [result] = await fillFields(document, [instruction('id:deg', 'Degree A')]);
    expect(result).toMatchObject({ status: 'filled' });
  });

  it('never fills a repeated field even if an instruction for it arrives', async () => {
    document.body.innerHTML = `<form>${input('a', 'Degree')}${input('b', 'Degree')}</form>`;
    const results = await fillFields(document, [
      instruction('id:a', 'Degree A'),
      instruction('id:b', 'Degree A'),
    ]);
    expect(results.map((r) => r.status)).toEqual(['skipped', 'skipped']);
    expect([value('a'), value('b')]).toEqual(['', '']);
  });
});
