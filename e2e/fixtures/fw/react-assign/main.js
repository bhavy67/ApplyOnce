import { createElement as h, useId, useState } from 'react';
import { createRoot } from 'react-dom/client';

// Two "Degree" inputs told apart only by their names; ids come from useId (generated).
function DegreeField({ name, value, onChange }) {
  const id = useId();
  return h('p', null, h('label', { htmlFor: id }, 'Degree'), h('input', { id, name, value, onChange: (e) => onChange(e.target.value) }));
}

function App() {
  const [s, set] = useState({ degree_undergrad: '', degree_postgrad: '', institution: '' });
  const [ui, setUi] = useState({ swapped: false, key: 0, submitted: false });
  const names = ui.swapped ? ['degree_postgrad', 'degree_undergrad'] : ['degree_undergrad', 'degree_postgrad'];
  return h('form', { onSubmit: (e) => { e.preventDefault(); setUi((u) => ({ ...u, submitted: true })); } },
    h('section', { key: ui.key }, h('h2', null, 'Education'),
      names.map((name) => h(DegreeField, { key: `${name}-${ui.key}`, name, value: s[name], onChange: (v) => set((c) => ({ ...c, [name]: v })) })),
      h('p', null, h('label', { htmlFor: 'inst' }, 'Institution'), h('input', { id: 'inst', name: 'institution', value: s.institution, onChange: (e) => set((c) => ({ ...c, institution: e.target.value })) }))),
    h('button', { type: 'button', id: 'swap', onClick: () => setUi((u) => ({ ...u, swapped: !u.swapped })) }, 'Swap'),
    h('button', { type: 'button', id: 'rerender', onClick: () => setUi((u) => ({ ...u, key: u.key + 1 })) }, 'Re-render'),
    h('button', { type: 'submit' }, 'Submit'),
    h('pre', { id: 'state' }, JSON.stringify(s)),
    h('p', { id: 'submitted' }, String(ui.submitted)));
}
createRoot(document.getElementById('app')).render(h(App));
