// @vitest-environment happy-dom
import type { FillInstruction, FormField } from '@applyonce/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { fillFields } from './fill-fields';
import { scanFields } from './scan-fields';

const records = () =>
  Object.fromEntries(
    scanFields(document).map((f: FormField) => [
      f.id,
      f.record
        ? `${f.record.collection}[${f.record.index}]`
        : f.repeatedCount
          ? `repeated×${f.repeatedCount}`
          : '-',
    ]),
  );

const block = (tag: string, heading: string, ids: string[], labels = ['Institution', 'Degree']) =>
  `<${tag}>${tag === 'fieldset' ? `<legend>${heading}</legend>` : `<h3>${heading}</h3>`}${ids
    .map((id, i) => `<label for="${id}">${labels[i] ?? id}</label><input id="${id}">`)
    .join('')}</${tag}>`;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('repeated record sections', () => {
  it('numbers headed blocks "Education 1/2/3" by document order', () => {
    document.body.innerHTML = `<form>
      <label for="fn">First Name</label><input id="fn">
      <section><h2>Education</h2>
        ${block('div', 'Education 1', ['i1', 'd1'])}
        ${block('div', 'Education 2', ['i2', 'd2'])}
        ${block('div', 'Education 3', ['i3', 'd3'])}
      </section></form>`;
    expect(records()).toEqual({
      'id:fn': '-',
      'id:i1': 'education[0]',
      'id:d1': 'education[0]',
      'id:i2': 'education[1]',
      'id:d2': 'education[1]',
      'id:i3': 'education[2]',
      'id:d3': 'education[2]',
    });
  });

  it('recognises fieldset legends, aria-labelledby, and aria-label as section headings', () => {
    document.body.innerHTML = `
      ${block('fieldset', 'Work Experience 1', ['c1'])}
      ${block('fieldset', 'Work Experience 2', ['c2'])}
      <div role="group" aria-labelledby="h1"><span id="h1">Certification 1</span><label for="n1">Name</label><input id="n1"></div>
      <div role="group" aria-label="Certification 2"><label for="n2">Name</label><input id="n2"></div>`;
    expect(records()).toEqual({
      'id:c1': 'workExperience[0]',
      'id:c2': 'workExperience[1]',
      'id:n1': 'certifications[0]',
      'id:n2': 'certifications[1]',
    });
  });

  it('accepts repeated unnumbered headings ("Certification", "Certification")', () => {
    document.body.innerHTML = `${block('div', 'Certification', ['a'])}${block('div', 'Certification', ['b'])}`;
    expect(records()).toEqual({ 'id:a': 'certifications[0]', 'id:b': 'certifications[1]' });
  });

  it('attributes fields in a nested sub-group to the enclosing record', () => {
    document.body.innerHTML = `
      <div><h3>Education 1</h3><fieldset><legend>Dates</legend><label for="s1">Start year</label><input id="s1"></fieldset></div>
      <div><h3>Education 2</h3><fieldset><legend>Dates</legend><label for="s2">Start year</label><input id="s2"></fieldset></div>`;
    expect(records()).toEqual({ 'id:s1': 'education[0]', 'id:s2': 'education[1]' });
  });

  it('leaves a single section exactly as before, even when numbered', () => {
    document.body.innerHTML = `${block('div', 'Work Experience 1', ['c1', 't1'], ['Company', 'Job Title'])}
      ${block('div', 'Education', ['i1'])}`;
    expect(records()).toEqual({ 'id:c1': '-', 'id:t1': '-', 'id:i1': '-' });
  });

  it('never uses field order or labels alone: repeated labels without record headings stay unmarked', () => {
    document.body.innerHTML = `<form><h2>Application</h2>
      <label for="a">Institution</label><input id="a"><label for="b">Institution</label><input id="b"></form>`;
    expect(records()).toEqual({ 'id:a': '-', 'id:b': '-' });
  });

  it('ignores headings that only contain a record word', () => {
    document.body.innerHTML = `${block('div', 'Education preferences', ['a'])}${block('div', 'Education preferences', ['b'])}
      ${block('div', 'Experience with our products', ['c'])}${block('div', 'Experience with our products', ['d'])}`;
    expect(records()).toEqual({ 'id:a': '-', 'id:b': '-', 'id:c': '-', 'id:d': '-' });
  });

  it('treats a wrapper holding the records as a wrapper; its own fields stay unmarked', () => {
    document.body.innerHTML = `<section><h2>Education</h2>
      <label for="lvl">Highest level</label><input id="lvl">
      ${block('div', 'Education 1', ['i1'])}${block('div', 'Education 2', ['i2'])}</section>`;
    expect(records()).toEqual({ 'id:lvl': '-', 'id:i1': 'education[0]', 'id:i2': 'education[1]' });
  });

  it.each([
    ['out of order', ['Education 2', 'Education 1']],
    ['a gap', ['Education 1', 'Education 3']],
    ['a duplicate', ['Education 1', 'Education 1']],
    ['mixed numbered and unnumbered', ['Education 1', 'Education']],
    ['not starting at 1', ['Education 2', 'Education 3']],
  ])('marks every field as a repeated question when numbering has %s', (_, headings) => {
    document.body.innerHTML = headings.map((h, i) => block('div', h, [`x${i}`])).join('');
    expect(records()).toEqual({ 'id:x0': 'repeated×2', 'id:x1': 'repeated×2' });
  });

  it('keeps the three collections apart on one page', () => {
    document.body.innerHTML = [
      block('div', 'Education 1', ['e1']),
      block('div', 'Work Experience 1', ['w1']),
      block('div', 'Education 2', ['e2']),
      block('div', 'Work Experience 2', ['w2']),
      block('div', 'License or Certification 1', ['c1']),
    ].join('');
    expect(records()).toEqual({
      'id:e1': 'education[0]',
      'id:w1': 'workExperience[0]',
      'id:e2': 'education[1]',
      'id:w2': 'workExperience[1]',
      'id:c1': '-',
    });
  });

  it('gives duplicated ids distinct field ids in each record', () => {
    document.body.innerHTML = `
      <div><h3>Education 1</h3><label>Institution <input name="institution"></label></div>
      <div><h3>Education 2</h3><label>Institution <input name="institution"></label></div>`;
    const fields = scanFields(document);
    expect(new Set(fields.map((f) => f.id)).size).toBe(2);
    expect(fields.map((f) => f.record?.index)).toEqual([0, 1]);
  });
});

describe('filling fields in repeated sections', () => {
  const page = () => `
    <div id="e1"><h3>Education 1</h3><label for="i1">Institution</label><input id="i1"></div>
    <div id="e2"><h3>Education 2</h3><label for="i2">Institution</label><input id="i2"></div>`;
  const instruction = (fieldId: string, value: string): FillInstruction => {
    const found = scanFields(document).find((f) => f.id === fieldId);
    if (!found) throw new Error('no field');
    const { name, htmlId, label } = found.signals;
    return {
      fieldId,
      value,
      expected: {
        type: found.type,
        name,
        htmlId,
        label,
        ...(found.record ? { record: found.record } : {}),
      },
    };
  };

  it('fills the field of the expected record', async () => {
    document.body.innerHTML = page();
    const [result] = await fillFields(document, [instruction('id:i2', 'University B')]);
    expect(result).toMatchObject({ status: 'filled' });
    expect((document.getElementById('i2') as HTMLInputElement).value).toBe('University B');
    expect((document.getElementById('i1') as HTMLInputElement).value).toBe('');
  });

  it('refuses a field whose record position changed since analysis', async () => {
    document.body.innerHTML = page();
    const approved = instruction('id:i2', 'University B');
    document.getElementById('e1')?.remove(); // Education 2 is now the only block
    const [result] = await fillFields(document, [approved]);
    expect(result).toMatchObject({ status: 'not-found' });
    expect((document.getElementById('i2') as HTMLInputElement).value).toBe('');
  });

  it('refuses when the analysed field had no record but now has one, and vice versa', async () => {
    document.body.innerHTML = page();
    const withoutRecord = {
      ...instruction('id:i1', 'X'),
      expected: { type: 'text' as const, htmlId: 'i1', label: 'Institution' },
    };
    expect((await fillFields(document, [withoutRecord]))[0]).toMatchObject({ status: 'not-found' });
    const wrongRecord = instruction('id:i1', 'X');
    wrongRecord.expected.record = { collection: 'education', index: 1 };
    expect((await fillFields(document, [wrongRecord]))[0]).toMatchObject({ status: 'not-found' });
  });
});
