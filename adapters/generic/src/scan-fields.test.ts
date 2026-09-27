// @vitest-environment happy-dom
import type { FormField } from '@applyonce/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { genericAdapter } from './generic-adapter';
import { scanFields } from './scan-fields';

function scan(html: string): FormField[] {
  document.body.innerHTML = html;
  return scanFields(document);
}

function only(html: string): FormField {
  const [field, ...rest] = scan(html);
  if (!field || rest.length > 0) throw new Error('Expected exactly one field');
  return field;
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('supported field types', () => {
  it.each([
    ['<input type="text" name="a">', 'text', 'text'],
    ['<input name="a">', 'text', 'text'],
    ['<input type="url" name="a">', 'text', 'url'],
    ['<input type="search" name="a">', 'text', 'search'],
    ['<input type="email" name="a">', 'email', 'email'],
    ['<input type="tel" name="a">', 'tel', 'tel'],
    ['<input type="number" name="a">', 'number', 'number'],
    ['<textarea name="a"></textarea>', 'textarea', 'textarea'],
    ['<select name="a"><option>x</option></select>', 'select', 'select-one'],
    ['<select name="a" multiple><option>x</option></select>', 'select', 'select-multiple'],
    ['<input type="checkbox" name="a">', 'checkbox', 'checkbox'],
    ['<input type="radio" name="a" value="x">', 'radio', 'radio'],
  ])('%s → %s', (html, type, htmlType) => {
    const field = only(html);
    expect(field.type).toBe(type);
    expect(field.htmlType).toBe(htmlType);
  });

  it('ignores unsupported and unrelated elements', () => {
    const fields = scan(`
      <input type="password" name="password">
      <input type="hidden" name="token" value="secret">
      <input type="file" name="resume">
      <input type="date" name="start">
      <input type="submit" value="Send">
      <input type="button" value="Click">
      <button type="button">Next</button>
      <div contenteditable="true">Rich text</div>
      <p>Just text</p>
      <a href="#">A link</a>
    `);
    expect(fields).toEqual([]);
  });
});

describe('labels and signals', () => {
  it('reads a label connected with "for"', () => {
    const field = only(`
      <label for="first-name">First Name</label>
      <input id="first-name" name="firstName" type="text">
    `);
    expect(field).toEqual({
      id: 'id:first-name',
      type: 'text',
      htmlType: 'text',
      required: false,
      visible: true,
      disabled: false,
      signals: { name: 'firstName', htmlId: 'first-name', label: 'First Name' },
      // Phase 14: every scanned field has a semantic identity (unique here).
      identity: { key: expect.stringMatching(/^fp-[0-9a-f]{16}$/) as string, unique: true },
    });
  });

  it('reads a wrapping label without including nested option text', () => {
    const field = only(`
      <label>Country <span>*</span>
        <select name="country"><option value="ca">Canada</option><option value="in">India</option></select>
      </label>
    `);
    expect(field.signals.label).toBe('Country *');
    expect(field.options).toEqual([
      { value: 'ca', label: 'Canada' },
      { value: 'in', label: 'India' },
    ]);
  });

  it('reads placeholder, autocomplete, and aria-label', () => {
    const field = only(
      '<input type="email" placeholder="you@example.com" autocomplete="email" aria-label="Email address">',
    );
    expect(field.signals).toEqual({
      placeholder: 'you@example.com',
      autocomplete: 'email',
      ariaLabel: 'Email address',
    });
  });

  it('uses aria-labelledby text when there is no <label>', () => {
    const field = only('<span id="lbl">Postal code</span><input aria-labelledby="lbl">');
    expect(field.signals.label).toBe('Postal code');
  });

  it('uses preceding text for unlabeled fields, without borrowing from other fields', () => {
    const fields = scan(`
      <div><p>Notes</p><textarea></textarea></div>
      <div><label for="city">City</label><input id="city"></div>
      <div><input name="unlabeled"></div>
    `);
    expect(fields.map((f) => f.signals.nearbyText)).toEqual(['Notes', undefined, undefined]);
  });

  it('uses the fieldset legend as context', () => {
    const field = only(
      '<fieldset><legend>Employment type</legend><label><input type="checkbox" name="ft">Full-time</label></fieldset>',
    );
    expect(field.signals).toMatchObject({ label: 'Full-time', nearbyText: 'Employment type' });
  });
});

describe('radio groups', () => {
  it('groups radios by name into one field with options and the group question as label', () => {
    const field = only(`
      <fieldset>
        <legend>Do you require sponsorship?</legend>
        <label><input type="radio" name="sponsorship" value="yes"> Yes</label>
        <label><input type="radio" name="sponsorship" value="no" required> No</label>
      </fieldset>
    `);
    expect(field).toMatchObject({
      id: 'radio:sponsorship',
      type: 'radio',
      required: true,
      signals: { name: 'sponsorship', label: 'Do you require sponsorship?' },
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    });
  });

  it('keeps same-named radio groups in different forms separate', () => {
    const fields = scan(`
      <form id="a"><input type="radio" name="choice" value="1"></form>
      <form id="b"><input type="radio" name="choice" value="2"></form>
    `);
    expect(fields.map((f) => f.id)).toEqual(['radio:choice', 'radio:choice~2']);
  });
});

describe('state', () => {
  it('detects required fields, including aria-required', () => {
    const fields = scan(
      '<input name="a" required><input name="b" aria-required="true"><input name="c">',
    );
    expect(fields.map((f) => f.required)).toEqual([true, true, false]);
  });

  it('detects disabled fields, including inside a disabled fieldset', () => {
    const fields = scan(`
      <input name="a" disabled>
      <fieldset disabled><input name="b"></fieldset>
      <fieldset disabled><legend><input name="inLegend"></legend></fieldset>
      <input name="c">
    `);
    expect(fields.map((f) => f.disabled)).toEqual([true, true, false, false]);
  });

  it('marks hidden fields as not visible but still reports them', () => {
    document.head.innerHTML = '<style>.gone { display: none; }</style>';
    const fields = scan(`
      <input name="styleNone" style="display: none">
      <input name="hiddenAttr" hidden>
      <input name="invisible" style="visibility: hidden">
      <div style="display: none"><input name="inHiddenParent"></div>
      <input name="viaClass" class="gone">
      <input name="shown">
    `);
    expect(fields.map((f) => [f.signals.name, f.visible])).toEqual([
      ['styleNone', false],
      ['hiddenAttr', false],
      ['invisible', false],
      ['inHiddenParent', false],
      ['viaClass', false],
      ['shown', true],
    ]);
  });
});

describe('page structure', () => {
  it('handles multiple forms and fields outside any form', () => {
    const fields = scan(`
      <form id="apply" name="application" action="/submit"><input name="email" type="email"></form>
      <form><input name="query"></form>
      <input name="outside">
      <input name="linked" form="apply">
    `);
    expect(fields.map((f) => [f.signals.name, f.form])).toEqual([
      ['email', { id: 'apply', name: 'application', action: '/submit' }],
      ['query', undefined],
      ['outside', undefined],
      ['linked', { id: 'apply', name: 'application', action: '/submit' }],
    ]);
  });

  it('reads form attributes even when controls shadow form.id/name/action', () => {
    const field = scan(`
      <form id="f" name="real"><input name="id"><input name="name"><input name="action"></form>
    `)[0];
    expect(field?.form).toEqual({ id: 'f', name: 'real' });
  });

  it('handles fields without name or id, and deeply nested fields', () => {
    const fields = scan(`
      <div><div><section><span><input type="text"></span></section></div></div>
      <input type="text">
    `);
    expect(fields.map((f) => f.id)).toEqual(['index:0', 'index:1']);
    expect(fields[0]?.signals).toEqual({});
  });

  it('produces the same ids when the same page is scanned again', () => {
    const html =
      '<input id="a"><input name="b"><input name="b"><input><input type="radio" name="r">';
    const first = scan(html).map((f) => f.id);
    expect(first).toEqual(['id:a', 'name:b', 'name:b~2', 'index:3', 'radio:r']);
    expect(scan(html).map((f) => f.id)).toEqual(first);
  });
});

describe('privacy', () => {
  it('never captures values the user entered or selected', () => {
    document.body.innerHTML = `
      <input name="first" value="Jane-Secret">
      <textarea name="notes">Private note</textarea>
      <select name="s"><option value="x">X</option><option value="y" selected>Y</option></select>
      <input type="checkbox" name="c" checked>
    `;
    (document.querySelector('[name=first]') as HTMLInputElement).value = 'Typed-Secret';
    const serialized = JSON.stringify(scanFields(document));

    expect(serialized).not.toContain('Secret');
    expect(serialized).not.toContain('Private note');
    expect(serialized).not.toMatch(/"(value|checked|selected)":\s*(true|"Typed)/);
  });
});

describe('genericAdapter', () => {
  it('scans the page it is given', () => {
    document.body.innerHTML = '<label>Email <input type="email" name="email"></label>';
    const fields = genericAdapter.getFields({ url: 'https://example.com', root: document });
    expect(fields.map((f) => f.signals.label)).toEqual(['Email']);
  });
});

describe('Phase 6: label association', () => {
  it.each([
    ['nested text', '<label for="f"><span><b>First</b> name</span></label><input id="f">'],
    ['extra whitespace', '<label for="f">\n   First\n   name   </label><input id="f">'],
    [
      'decorative marker hidden from assistive technology',
      '<label for="f">First name <span aria-hidden="true">*</span></label><input id="f">',
    ],
    [
      'wrapper label without for',
      '<div class="field"><label>First name</label><div><input id="f"></div></div>',
    ],
    [
      'wrapper label two levels up',
      '<div><div><label>First name</label></div><div><span><input id="f"></span></div></div>',
    ],
  ])('reads the label from %s', (_, html) => {
    expect(only(html).signals.label).toBe('First name');
  });

  it('joins aria-labelledby references in order', () => {
    const field = only(
      '<span id="a">Emergency contact</span><span id="b">Phone</span><input aria-labelledby="a b">',
    );
    expect(field.signals.label).toBe('Emergency contact Phone');
  });

  it('prefers <label for> and aria-labelledby over a wrapper label', () => {
    const field = only(
      '<div><label>Wrapper</label><span id="l">Explicit</span><input aria-labelledby="l"></div>',
    );
    expect(field.signals.label).toBe('Explicit');
  });

  it('never takes a wrapper label from a wrapper with several fields', () => {
    const fields = scan(`
      <div class="row"><label>First name</label><input name="a"><input name="b"></div>
    `);
    expect(fields.map((f) => f.signals.label)).toEqual([undefined, undefined]);
  });

  it('never takes a label that belongs to another field', () => {
    const fields = scan(
      '<div><label for="other">City</label><input name="mine"></div><input id="other">',
    );
    expect(fields[0]?.signals.label).toBeUndefined();
    expect(fields[1]?.signals.label).toBe('City');
  });

  it('never takes a wrapper label across a form or fieldset boundary', () => {
    const field = only(
      '<form><label>Form title</label><fieldset><div><input name="x"></div></fieldset></form>',
    );
    expect(field.signals.label).toBeUndefined();
  });

  it('keeps autocomplete for fields with no visible label', () => {
    expect(only('<input autocomplete="given-name">').signals).toEqual({
      autocomplete: 'given-name',
    });
  });
});

describe('Phase 6: groups and state', () => {
  it('keeps several radio groups on one page separate, even with similar legends', () => {
    const fields = scan(`
      <fieldset><legend>Work mode</legend>
        <label><input type="radio" name="mode" value="r"> Remote</label>
        <label><input type="radio" name="mode" value="h"> Hybrid</label>
        <label><input type="radio" name="mode" value="o"> On-site</label>
      </fieldset>
      <fieldset><legend>Work mode</legend>
        <label><input type="radio" name="mode2" value="r"> Remote</label>
        <label><input type="radio" name="mode2" value="o"> On-site</label>
      </fieldset>
      <div role="radiogroup" aria-label="Employment type">
        <label><input type="radio" name="type" value="ft"> Full time</label>
        <label><input type="radio" name="type" value="pt"> Part time</label>
      </div>`);
    expect(fields.map((f) => [f.id, f.signals.label, f.options?.length])).toEqual([
      ['radio:mode', 'Work mode', 3],
      ['radio:mode2', 'Work mode', 2],
      ['radio:type', 'Employment type', 2],
    ]);
  });

  it('records checkbox groups (same name) but not single checkboxes', () => {
    const fields = scan(`
      <fieldset><legend>Preferred locations</legend>
        <label><input type="checkbox" name="loc" value="amd"> Ahmedabad</label>
        <label><input type="checkbox" name="loc" value="bom"> Mumbai</label>
        <label><input type="checkbox" name="loc" value="blr"> Bengaluru</label>
      </fieldset>
      <label><input type="checkbox" name="relocate"> Willing to relocate</label>
      <label><input type="checkbox"> Unnamed</label>`);
    expect(fields.map((f) => [f.signals.label, f.groupSize])).toEqual([
      ['Ahmedabad', 3],
      ['Mumbai', 3],
      ['Bengaluru', 3],
      ['Willing to relocate', undefined],
      ['Unnamed', undefined],
    ]);
  });

  it('records read-only fields', () => {
    const fields = scan(
      '<input name="a" readonly><textarea name="b" aria-readonly="true"></textarea><input name="c">',
    );
    expect(fields.map((f) => f.readOnly)).toEqual([true, true, undefined]);
  });

  it('treats off-screen and transparent fields as visible', () => {
    const fields = scan(`
      <input name="offscreen" style="position:absolute; left:-10000px">
      <input name="transparent" style="opacity:0">`);
    expect(fields.map((f) => f.visible)).toEqual([true, true]);
  });

  it('does not detect contenteditable regions (unsupported, see README)', () => {
    expect(scan('<div contenteditable="true" aria-label="Cover letter"></div>')).toEqual([]);
  });
});

describe('Phase 8: scan options for site adapters', () => {
  it('excludes controls, prefers a stable identity, and post-processes the result', () => {
    document.body.innerHTML = `
      <nav><input name="search" aria-label="Search"></nav>
      <label for="gen-1">First name</label><input id="gen-1" data-key="first">
      <label for="gen-2">Last name</label><input id="gen-2">`;
    const fields = scanFields(document, {
      exclude: (element) => element.closest('nav') !== null,
      stableIdentity: (element) => element.getAttribute('data-key') ?? undefined,
      postProcess: (scanned) => scanned.filter(({ field }) => field.signals.label !== 'Last name'),
    });
    expect(fields.map((f) => f.id)).toEqual(['key:first']);
  });

  it('keeps the generic behavior without options', () => {
    document.body.innerHTML =
      '<label for="gen-1">First name</label><input id="gen-1" data-key="first">';
    expect(scanFields(document).map((f) => f.id)).toEqual(['id:gen-1']);
  });
});
