import { createElement as h, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';

const MODES = [{ value: 'r', label: 'Remote' }, { value: 'h', label: 'Hybrid' }, { value: 'o', label: 'On-site' }];
const TYPES = [{ value: 'ft', label: 'Full time' }, { value: 'pt', label: 'Part time' }, { value: 'c', label: 'Contract' }];
const NOTICE = [{ value: '30', label: '30 days' }, { value: '60', label: '60 days' }];

function Dropdown({ id, label, options, value, onChange, kind = 'button', portal = false }) {
  const [open, setOpen] = useState(false);
  const listboxId = `${id}-listbox`;
  const labelId = `${id}-label`;
  const selected = options.find((o) => o.value === value);
  const toggle = () => setOpen((o) => !o);
  const listbox = open && h('ul', { role: 'listbox', id: listboxId },
    options.map((o) => h('li', { key: o.value, role: 'option', 'data-value': o.value, 'aria-selected': o.value === value ? 'true' : 'false', onClick: () => { onChange(o.value); setOpen(false); } }, o.label)));
  const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
  const control = kind === 'button'
    ? h('button', { type: 'button', id, 'aria-haspopup': 'listbox', 'aria-expanded': String(open), 'aria-controls': listboxId, 'aria-labelledby': `${labelId} ${id}`, onClick: toggle, onKeyDown }, selected ? selected.label : 'Select…')
    : h('input', { id, role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': String(open), 'aria-controls': open ? listboxId : undefined, value: selected ? selected.label : '', onChange: () => {}, onMouseDown: toggle, onKeyDown });
  return h('div', { className: 'field' }, h('label', { id: labelId, htmlFor: id }, label), control, portal && listbox ? createPortal(listbox, document.body) : listbox);
}

function App() {
  const [s, set] = useState({ firstName: '', mode: '', etype: '', notice: '60', role: '' });
  const [ui, setUi] = useState({ modeKey: 0, submitted: false });
  const field = (key) => ({ value: s[key], onChange: (v) => set((c) => ({ ...c, [key]: v })) });
  return h('form', { onSubmit: (e) => { e.preventDefault(); setUi((u) => ({ ...u, submitted: true })); } },
    h('div', { className: 'field' }, h('label', { htmlFor: 'first' }, 'First Name'), h('input', { id: 'first', name: 'firstName', value: s.firstName, onChange: (e) => set((c) => ({ ...c, firstName: e.target.value })) })),
    h(Dropdown, { key: `mode-${ui.modeKey}`, id: 'mode', label: 'Work Mode', options: MODES, ...field('mode') }),
    h(Dropdown, { id: 'etype', label: 'Employment Type', options: TYPES, kind: 'input', portal: true, ...field('etype') }),
    h(Dropdown, { id: 'notice', label: 'Notice Period', options: NOTICE, ...field('notice') }),
    h(Dropdown, { id: 'role', label: 'What kind of role are you looking for?', options: TYPES, ...field('role') }),
    h('button', { type: 'button', id: 'rerender', onClick: () => setUi((u) => ({ ...u, modeKey: u.modeKey + 1 })) }, 'Re-render work mode'),
    h('button', { type: 'submit' }, 'Submit'),
    h('pre', { id: 'state' }, JSON.stringify(s)),
    h('p', { id: 'submitted' }, String(ui.submitted)),
  );
}
createRoot(document.getElementById('app')).render(h(App));
