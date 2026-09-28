import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';

const initial = { firstName: '', email: '', phone: '', years: '', city: 'Prefilled Town', linkedin: '', github: '', portfolio: '', postal: '', mode: '', etype: '', relocate: false, cover: '', company: '', referral: '', locations: [] };

function App() {
  const [s, set] = useState(initial);
  const [ui, setUi] = useState({ github: true, portfolioKey: 0, postal: false, submitted: false });
  const bind = (key, extra = {}) => ({ name: key, value: s[key], onChange: (e) => set((c) => ({ ...c, [key]: e.target.value })), ...extra });
  const row = (label, id, input) => h('div', { className: 'field' }, h('label', { htmlFor: id }, label), input);
  return h('form', { onSubmit: (e) => { e.preventDefault(); setUi((u) => ({ ...u, submitted: true })); } },
    row('First Name *', 'first', h('input', { id: 'first', ...bind('firstName') })),
    row('Email', 'email', h('input', { id: 'email', type: 'email', autoComplete: 'email', ...bind('email') })),
    row('Phone', 'phone', h('input', { id: 'phone', type: 'tel', ...bind('phone') })),
    row('Years of Experience', 'years', h('input', { id: 'years', type: 'number', ...bind('years') })),
    row('City', 'city', h('input', { id: 'city', ...bind('city') })),
    row('LinkedIn URL', 'linkedin', h('input', { id: 'linkedin', type: 'url', ...bind('linkedin') })),
    ui.github && row('GitHub', 'github', h('input', { id: 'github', type: 'url', ...bind('github') })),
    h('div', { className: 'field', key: `portfolio-${ui.portfolioKey}` }, h('label', { htmlFor: 'portfolio' }, 'Portfolio'), h('input', { id: 'portfolio', type: 'url', ...bind('portfolio') })),
    ui.postal && row('Postal Code', 'postal', h('input', { id: 'postal', ...bind('postal') })),
    row('Work Mode', 'mode', h('select', { id: 'mode', ...bind('mode') }, h('option', { value: '' }, 'Select…'), h('option', { value: 'r' }, 'Remote'), h('option', { value: 'h' }, 'Hybrid'), h('option', { value: 'o' }, 'On site'))),
    h('fieldset', null, h('legend', null, 'Employment Type'), ['ft:Full time', 'pt:Part time', 'c:Contract'].map((o) => { const [v, l] = o.split(':'); return h('label', { key: v }, h('input', { type: 'radio', name: 'etype', value: v, checked: s.etype === v, onChange: () => set((c) => ({ ...c, etype: v })) }), ` ${l}`); })),
    h('label', null, h('input', { type: 'checkbox', name: 'relocate', checked: s.relocate, onChange: (e) => set((c) => ({ ...c, relocate: e.target.checked })) }), ' Willing to relocate'),
    row('Why do you want to work here?', 'cover', h('textarea', { id: 'cover', ...bind('cover') })),
    row('Company', 'company', h('input', { id: 'company', ...bind('company') })),
    row('Referral code', 'referral', h('input', { id: 'referral', ...bind('referral') })),
    h('fieldset', null, h('legend', null, 'Preferred locations'), ['Ahmedabad', 'Mumbai', 'Bengaluru'].map((l) => h('label', { key: l }, h('input', { type: 'checkbox', name: 'loc', value: l, checked: s.locations.includes(l), onChange: (e) => set((c) => ({ ...c, locations: e.target.checked ? [...c.locations, l] : c.locations.filter((x) => x !== l) })) }), ` ${l}`))),
    h('button', { type: 'button', id: 'remove-github', onClick: () => setUi((u) => ({ ...u, github: false })) }, 'Remove GitHub'),
    h('button', { type: 'button', id: 'replace-portfolio', onClick: () => setUi((u) => ({ ...u, portfolioKey: u.portfolioKey + 1 })) }, 'Replace portfolio'),
    h('button', { type: 'button', id: 'add-postal', onClick: () => setUi((u) => ({ ...u, postal: true })) }, 'Add postal code'),
    h('button', { type: 'submit' }, 'Submit application'),
    h('pre', { id: 'state' }, JSON.stringify(s)),
    h('p', { id: 'submitted' }, String(ui.submitted)),
  );
}
createRoot(document.getElementById('app')).render(h(App));
