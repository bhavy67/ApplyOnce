import { createElement as h, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { FIELDS, search } from '../search-data.js';

// Workday-style search prompt: typing searches, clicking a suggestion puts it in the field.
function SearchField({ auto, label, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const request = useRef(0);
  const listId = `${auto}-list`;
  const open = results !== null;
  const onChange = async (e) => {
    const q = e.target.value;
    setQuery(q);
    onSelect('');
    const n = ++request.current;
    if (!q) return setResults(null);
    const found = await search(auto, q);
    if (n === request.current) setResults(found);
  };
  const choose = (value) => { setQuery(value); onSelect(value); setResults(null); request.current++; };
  const list = open && createPortal(h('ul', { role: 'listbox', id: listId, 'data-automation-id': 'activeListContainer' },
    results.map((r) => h('li', { key: r, role: 'option', 'data-automation-id': 'promptOption', onClick: () => choose(r) }, r))), document.body);
  return h('div', { 'data-automation-id': `formField-${auto}` },
    h('label', { htmlFor: `${auto}-input` }, label),
    h('input', { id: `${auto}-input`, 'data-automation-id': auto, 'data-uxi-widget-type': 'selectinput', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': String(open), 'aria-controls': open ? listId : undefined, value: query, onChange, onKeyDown: (e) => { if (e.key === 'Escape') setResults(null); } }),
    list);
}

function App() {
  const [s, set] = useState({ firstName: '', school: '', study: '', city: '' });
  const [ui, setUi] = useState({ nav: 0, submitted: false, key: 0 });
  return h('form', { onSubmit: (e) => { e.preventDefault(); setUi((u) => ({ ...u, submitted: true })); } },
    h('div', { 'data-automation-id': 'applyFlowPage' },
      h('div', { 'data-automation-id': 'formField-legalName-firstName' }, h('label', { htmlFor: 'first' }, 'First Name'), h('input', { id: 'first', 'data-automation-id': 'legalName-firstName', value: s.firstName, onChange: (e) => set((c) => ({ ...c, firstName: e.target.value })) })),
      FIELDS.map(([auto, label]) => h(SearchField, { key: `${auto}-${ui.key}`, auto, label, onSelect: (v) => set((c) => ({ ...c, [auto]: v })) })),
      h('button', { type: 'button', 'data-automation-id': 'pageFooterNextButton', onClick: () => setUi((u) => ({ ...u, nav: u.nav + 1 })) }, 'Save and Continue'),
      h('button', { type: 'submit', 'data-automation-id': 'submitButton' }, 'Submit')),
    h('button', { type: 'button', id: 'rerender', onClick: () => setUi((u) => ({ ...u, key: u.key + 1 })) }, 'Re-render'),
    h('pre', { id: 'state' }, JSON.stringify({ ...s, inputs: null })),
    h('p', { id: 'nav' }, String(ui.nav)),
    h('p', { id: 'submitted' }, String(ui.submitted)));
}
createRoot(document.getElementById('app')).render(h(App));
