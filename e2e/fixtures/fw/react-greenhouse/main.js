// A local Greenhouse-style application page (structure as observed read-only on public
// job-boards.greenhouse.io forms), using the real react-select library Greenhouse uses.
// Fixture-only additions: native select, checkbox, radio group, dynamic field, repeated
// question, navigation buttons, re-render. Fake data only; submitting is prevented.
import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';

const options = (...labels) => labels.map((label) => ({ value: label.toLowerCase().replace(/\W+/g, '-'), label }));
const COUNTRIES = options('India', 'Canada', 'United States', 'United Kingdom');
const STATES = options('Ontario', 'Quebec', 'British Columbia');
const EMPLOYMENT = options('Full-time', 'Part-time', 'Contract');
const AUTH = options('Authorized to work in Canada', 'Require sponsorship');
const EEO = options('Decline to self-identify', 'Option A', 'Option B');

function Label({ id, text, required }) {
  return h('label', { id: `${id}-label`, htmlFor: id, className: 'label' }, text, required && h('span', { 'aria-hidden': 'true' }, '*'));
}
function TextQuestion({ id, label, value, onChange, required, multiline }) {
  return h('div', { className: 'field-wrapper' }, h('div', { className: 'text-input-wrapper' }, h('div', { className: 'input-wrapper' },
    h(Label, { id, text: label, required }),
    h(multiline ? 'textarea' : 'input', { id, className: 'input input__single-line', 'aria-label': label, 'aria-required': required ? 'true' : undefined, type: multiline ? undefined : 'text', value, onChange: (e) => onChange(e.target.value) }))));
}
function SelectQuestion({ id, label, opts, value, onChange, required, async }) {
  const common = {
    inputId: id, instanceId: id, classNamePrefix: 'select', className: 'select-shell', placeholder: 'Select...', 'aria-labelledby': `${id}-label`,
    value: value ?? null, onChange: (o) => onChange(o), required,
  };
  const control = async
    ? h(AsyncSelect, { ...common, cacheOptions: true, loadOptions: (input) => Promise.resolve(input.length < 2 ? [] : options(`${input} (City)`)) })
    : h(Select, { ...common, options: opts });
  return h('div', { className: 'field-wrapper' }, h('div', { className: 'select' }, h('div', { className: 'select__container' }, h(Label, { id, text: label, required }), control)));
}

function App() {
  const [s, set] = useState({
    first_name: '', last_name: '', email: '', phone: '', country: null, location: null,
    q_linkedin: '', q_github: '', q_website: '', q_company: '', q_title: '', q_years: '',
    q_employment: null, q_auth: null, q_why: '', q_name: '', q_city: 'Kept City', q_state: STATES[0],
    q_workmode: '', q_relocate: false, q_sponsor: '', q_portfolio: '', q_degree1: '', q_degree2: '',
    gender: null, hispanic: null, veteran: null, demo_gender: null,
  });
  const [ui, setUi] = useState({ showPortfolio: false, key: 0, nav: 0, submitted: false });
  const bind = (key) => ({ value: s[key], onChange: (v) => set((c) => ({ ...c, [key]: v })) });
  const nav = () => setUi((u) => ({ ...u, nav: u.nav + 1 }));
  const summary = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v && typeof v === 'object' ? v.label : v]));
  return h('div', null,
    h('div', { className: 'job__description' }, h('h1', null, 'Software Engineer'), h('p', null, 'Apply through Greenhouse. Greenhouse will process your data.')),
    h('form', { id: 'application-form', className: 'application--form', key: ui.key, onSubmit: (e) => { e.preventDefault(); setUi((u) => ({ ...u, submitted: true })); } },
      h('div', { className: 'application--questions' },
        h(TextQuestion, { id: 'first_name', label: 'First Name', required: true, ...bind('first_name') }),
        h(TextQuestion, { id: 'last_name', label: 'Last Name', required: true, ...bind('last_name') }),
        h(TextQuestion, { id: 'email', label: 'Email', required: true, ...bind('email') }),
        h(SelectQuestion, { id: 'country', label: 'Country', opts: COUNTRIES, required: true, ...bind('country') }),
        h(TextQuestion, { id: 'phone', label: 'Phone', ...bind('phone') }),
        h(SelectQuestion, { id: 'candidate-location', label: 'Location (City)', async: true, ...bind('location') }),
        h('div', { className: 'field-wrapper' }, h('div', { role: 'group', 'aria-labelledby': 'upload-label-resume', className: 'file-upload' },
          h('div', { id: 'upload-label-resume', className: 'label upload-label' }, 'Resume/CV'),
          h('button', { type: 'button', className: 'btn btn--rounded' }, 'Attach'),
          h('label', { className: 'visually-hidden', htmlFor: 'resume' }, 'Attach'),
          h('input', { id: 'resume', className: 'visually-hidden', type: 'file' })))),
      h('div', { className: 'application--questions' },
        h(TextQuestion, { id: 'question_101', label: 'LinkedIn Profile', ...bind('q_linkedin') }),
        h(TextQuestion, { id: 'question_102', label: 'GitHub', ...bind('q_github') }),
        h(TextQuestion, { id: 'question_103', label: 'Website', ...bind('q_website') }),
        h(TextQuestion, { id: 'question_104', label: 'Current Company', ...bind('q_company') }),
        h(TextQuestion, { id: 'question_105', label: 'Current Job Title', ...bind('q_title') }),
        h(TextQuestion, { id: 'question_106', label: 'Years of Experience', ...bind('q_years') }),
        h(SelectQuestion, { id: 'question_107', label: 'Employment Type', opts: EMPLOYMENT, ...bind('q_employment') }),
        h(SelectQuestion, { id: 'question_108', label: 'Work Authorization', opts: AUTH, ...bind('q_auth') }),
        h(TextQuestion, { id: 'question_109', label: 'Why do you want to work at Example Co?', multiline: true, ...bind('q_why') }),
        h(TextQuestion, { id: 'question_110', label: 'What name should we use?', ...bind('q_name') }),
        h(TextQuestion, { id: 'question_111', label: 'City', ...bind('q_city') }),
        h(SelectQuestion, { id: 'question_112', label: 'State', opts: STATES, ...bind('q_state') }),
        h('div', { className: 'field-wrapper' }, h('label', { htmlFor: 'question_113' }, 'Work Mode'),
          h('select', { id: 'question_113', value: s.q_workmode, onChange: (e) => set((c) => ({ ...c, q_workmode: e.target.value })) },
            h('option', { value: '' }, 'Select...'), h('option', { value: 'remote' }, 'Remote'), h('option', { value: 'hybrid' }, 'Hybrid'), h('option', { value: 'onsite' }, 'On-site'))),
        h('div', { className: 'field-wrapper' }, h('label', null, h('input', { type: 'checkbox', id: 'question_114', checked: s.q_relocate, onChange: (e) => set((c) => ({ ...c, q_relocate: e.target.checked })) }), ' Willing to relocate')),
        h('fieldset', { className: 'field-wrapper' }, h('legend', null, 'Will you require visa sponsorship?'),
          ['Yes', 'No'].map((v) => h('label', { key: v }, h('input', { type: 'radio', name: 'question_115', value: v, checked: s.q_sponsor === v, onChange: () => set((c) => ({ ...c, q_sponsor: v })) }), ` ${v}`))),
        h(TextQuestion, { id: 'question_116', label: 'Degree', ...bind('q_degree1') }),
        h(TextQuestion, { id: 'question_117', label: 'Degree', ...bind('q_degree2') }),
        ui.showPortfolio && h(TextQuestion, { id: 'question_118', label: 'Portfolio', ...bind('q_portfolio') }),
        h('button', { type: 'button', id: 'add-link', onClick: () => setUi((u) => ({ ...u, showPortfolio: true })) }, 'Add another link')),
      h('div', { className: 'eeoc__container body' },
        h('h2', { className: 'section-header' }, 'Voluntary Self-Identification'),
        h(SelectQuestion, { id: 'gender', label: 'Gender', opts: EEO, ...bind('gender') }),
        h(SelectQuestion, { id: 'hispanic_ethnicity', label: 'Are you Hispanic/Latino?', opts: EEO, ...bind('hispanic') }),
        h(SelectQuestion, { id: 'veteran_status', label: 'Veteran Status', opts: EEO, ...bind('veteran') })),
      h('div', { id: 'demographic-section', className: 'demographic--container' },
        h(SelectQuestion, { id: '4033064002', label: 'Gender Identity (optional)', opts: EEO, ...bind('demo_gender') })),
      ['Next', 'Continue', 'Save', 'Apply'].map((t) => h('button', { type: 'button', key: t, className: 'nav-button', onClick: nav }, t)),
      h('button', { type: 'submit', className: 'btn btn--rounded' }, 'Submit application')),
    h('button', { type: 'button', id: 'rerender', onClick: () => setUi((u) => ({ ...u, key: u.key + 1 })) }, 'Re-render'),
    h('pre', { id: 'state' }, JSON.stringify(summary)),
    h('p', { id: 'nav' }, String(ui.nav)),
    h('p', { id: 'submitted' }, String(ui.submitted)));
}
createRoot(document.getElementById('app')).render(h(App));
