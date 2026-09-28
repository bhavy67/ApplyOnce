// Controlled React form: values only change if React sees the events.
import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';

const initial = {
  firstName: '', lastName: '', email: '', phone: '', city: '', country: '', postal: '',
  years: '', portfolio: '', notes: '', referral: '', relocate: false, sponsorship: '',
};

function App() {
  const [form, setForm] = useState(initial);
  const [showPortfolio, setShowPortfolio] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const bind = (key) => ({
    name: key,
    value: form[key],
    onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });
  const field = (label, id, props) =>
    h('div', null, h('label', { htmlFor: id }, label), h('input', { id, ...props }));

  return h('form', { id: 'application', onSubmit: (e) => { e.preventDefault(); setSubmitted(true); } },
    field('First Name', 'first', bind('firstName')),
    h('label', null, 'Last Name ', h('input', bind('lastName'))),
    field('Email', 'email', { type: 'email', autoComplete: 'email', ...bind('email') }),
    field('Phone', 'phone', { type: 'tel', ...bind('phone') }),
    field('City', 'city', bind('city')),
    h('div', null, h('label', { htmlFor: 'country' }, 'Country'),
      h('select', { id: 'country', ...bind('country') },
        h('option', { value: '' }, 'Select…'),
        h('option', { value: 'CA' }, 'Canada'),
        h('option', { value: 'US' }, 'United States'))),
    field('Postal Code', 'postal', bind('postal')),
    field('Years of Experience', 'years', { type: 'number', ...bind('years'), name: 'yearsOfExperience' }),
    showPortfolio && field('Portfolio', 'portfolio', { type: 'url', ...bind('portfolio') }),
    h('div', null, h('p', null, 'Notes'), h('textarea', bind('notes'))),
    field('Referral code', 'referral', bind('referral')),
    h('label', null, h('input', { type: 'checkbox', name: 'relocate', checked: form.relocate,
      onChange: (e) => setForm((f) => ({ ...f, relocate: e.target.checked })) }), ' Willing to relocate'),
    h('fieldset', null, h('legend', null, 'Do you require visa sponsorship?'),
      ['yes', 'no'].map((v) => h('label', { key: v }, h('input', { type: 'radio', name: 'question_7', value: v,
        checked: form.sponsorship === v, onChange: () => setForm((f) => ({ ...f, sponsorship: v })) }), v === 'yes' ? ' Yes' : ' No'))),
    h('button', { type: 'button', id: 'toggle-portfolio', onClick: () => setShowPortfolio(false) }, 'Remove portfolio field'),
    h('button', { type: 'submit' }, 'Submit application'),
    h('pre', { id: 'state' }, JSON.stringify(form)),
    h('p', { id: 'submitted' }, String(submitted)),
  );
}

createRoot(document.getElementById('root')).render(h(App));
