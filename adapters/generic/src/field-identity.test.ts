// @vitest-environment happy-dom
import type { FillInstruction, FormField } from '@applyonce/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { isGeneratedId } from './field-identity';
import { fillFields } from './fill-fields';
import { scanControls, scanFields } from './scan-fields';

const fields = () => scanFields(document);
const byId = (id: string) => fields().find((f) => f.signals.htmlId === id || f.signals.name === id);
const keyOf = (f: FormField | undefined) => f?.identity?.key;
const input = (attrs: string, label = 'Degree') => `<label>${label} <input ${attrs}></label>`;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('generated ids', () => {
  it.each([
    ':r1:',
    '_r_0_',
    '_R_1b_',
    ':R2d5:',
    '«r3»',
    'mui-12',
    'mat-input-4',
    'ember392',
    'react-select-3-input',
    'downshift-0-input',
    'headlessui-listbox-button-7',
    'radix-:r5:',
    'input-12',
    'field_7',
    '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    'a1b2c3d4e5f6a7b8c9d0',
  ])('%j is treated as generated', (id) => expect(isGeneratedId(id)).toBe(true));

  it.each(['degree_undergrad', 'firstName', 'email', 'edu-degree', 'degree2', 'school_name'])(
    '%j is an authored id',
    (id) => expect(isGeneratedId(id)).toBe(false),
  );
});

describe('field identity', () => {
  it('gives every field an "fp-" identity, unique when nothing else matches it', () => {
    document.body.innerHTML = `${input('id="deg" name="degree"')}${input('id="uni"', 'University')}`;
    for (const f of fields())
      expect(f.identity).toEqual({
        key: expect.stringMatching(/^fp-[0-9a-f]{16}$/) as string,
        unique: true,
      });
  });

  it.each([
    ['A. truly identical fields', `${input('')}${input('')}`, false],
    ['F. only a different DOM position', `<div><div>${input('')}</div></div>${input('')}`, false],
    [
      'B. different stable names',
      `${input('name="degree_undergrad"')}${input('name="degree_postgrad"')}`,
      true,
    ],
    ['   different authored ids', `${input('id="degree-ug"')}${input('id="degree-pg"')}`, true],
    [
      'C. different fieldsets',
      `<fieldset><legend>Undergraduate</legend>${input('')}</fieldset><fieldset><legend>Postgraduate</legend>${input('')}</fieldset>`,
      true,
    ],
    [
      'D. different named forms',
      `<form name="ug">${input('')}</form><form name="pg">${input('')}</form>`,
      true,
    ],
    [
      'E. different labeled containers',
      `<section aria-label="Undergraduate">${input('')}</section><section aria-label="Postgraduate">${input('')}</section>`,
      true,
    ],
    [
      '   different autocomplete',
      `${input('autocomplete="section-a organization-title"')}${input('autocomplete="section-b organization-title"')}`,
      true,
    ],
    [
      '   different control types',
      `${input('')}<label>Degree <select><option>BSc</option></select></label>`,
      true,
    ],
    ['   different generated ids only', `${input('id=":r1:"')}${input('id=":r2:"')}`, false],
    ['   different classes only', `${input('class="a"')}${input('class="b"')}`, false],
    ['   different current values only', `${input('value="BSc"')}${input('value="MSc"')}`, false],
    [
      '   different unrelated text only',
      `<div><p>Undergraduate</p>${input('')}</div><div><p>Postgraduate</p>${input('')}</div>`,
      false,
    ],
  ])('%s → unique: %s', (_, html, unique) => {
    document.body.innerHTML = html;
    const [a, b] = fields();
    expect(a?.identity?.unique).toBe(unique);
    expect(b?.identity?.unique).toBe(unique);
    expect(keyOf(a) === keyOf(b)).toBe(!unique);
  });

  it('is independent of position: a field keeps its identity when the fields swap', () => {
    const ug = input('name="degree_undergrad"');
    const pg = input('name="degree_postgrad"');
    document.body.innerHTML = `<form>${ug}${pg}</form>`;
    const before = { ug: keyOf(byId('degree_undergrad')), pg: keyOf(byId('degree_postgrad')) };
    document.body.innerHTML = `<form>${pg}${ug}</form>`;
    expect({ ug: keyOf(byId('degree_undergrad')), pg: keyOf(byId('degree_postgrad')) }).toEqual(
      before,
    );
  });

  it('survives a re-render with new nodes and new generated ids', () => {
    const render = (a: string, b: string) =>
      `<form name="edu"><fieldset><legend>Undergraduate</legend><label for="${a}">Degree</label><input id="${a}"></fieldset><fieldset><legend>Postgraduate</legend><label for="${b}">Degree</label><input id="${b}"></fieldset></form>`;
    document.body.innerHTML = render(':r1:', ':r2:');
    const before = fields().map(keyOf);
    document.body.innerHTML = render(':r7:', ':r8:');
    expect(fields().map(keyOf)).toEqual(before);
  });

  it('changes when meaningful identity changes (a new name is a new field)', () => {
    document.body.innerHTML = input('name="degree_one"');
    const before = keyOf(fields()[0]);
    document.body.innerHTML = input('name="degree_two"');
    expect(keyOf(fields()[0])).not.toBe(before);
  });

  it('uses a site adapter’s stable key (e.g. Workday automation ids)', () => {
    document.body.innerHTML = `${input('data-auto="jobTitle"')}${input('data-auto="jobTitle"')}${input('data-auto="school"')}`;
    const scanned = scanControls(document, {
      stableIdentity: (el) => el.getAttribute('data-auto') ?? undefined,
    });
    expect(scanned.map(({ field }) => field.identity?.unique)).toEqual([false, false, true]);
  });

  it('never puts the identity on the page', () => {
    document.body.innerHTML = `${input('name="a"')}${input('name="b"')}`;
    fields();
    expect(document.body.innerHTML).not.toMatch(/fp-[0-9a-f]/);
  });
});

describe('filling checks the identity', () => {
  const instruction = (name: string, value: string): FillInstruction => {
    const found = fields().find((f) => f.signals.name === name);
    if (!found?.identity) throw new Error('no field');
    return {
      fieldId: found.id,
      value,
      expected: {
        type: found.type,
        name,
        label: found.signals.label,
        identity: found.identity,
        ...(found.repeatedCount ? { repeatedCount: found.repeatedCount } : {}),
      },
    };
  };

  it('fills the field with the expected identity', async () => {
    document.body.innerHTML = `<form>${input('name="degree_undergrad"')}${input('name="degree_postgrad"')}</form>`;
    const [result] = await fillFields(document, [instruction('degree_postgrad', 'MSc')]);
    expect(result).toMatchObject({ status: 'filled' });
  });

  it('refuses when the field at that id now has a different identity', async () => {
    document.body.innerHTML = `<form><fieldset><legend>Undergraduate</legend>${input('name="degree"')}</fieldset></form>`;
    const approved = instruction('degree', 'BSc');
    const legend = document.querySelector('legend');
    if (legend) legend.textContent = 'Postgraduate';
    const [result] = await fillFields(document, [approved]);
    expect(result).toMatchObject({
      status: 'skipped',
      message: 'This field is not the one that was assigned. Analyze again.',
    });
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('');
  });
});
