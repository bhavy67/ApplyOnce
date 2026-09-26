import type { FormField } from '@applyonce/core';
import { fieldDisplayName, hasClearLabel } from './analyze-page';

/** Read-only list of detected fields. Shows metadata only, never values. */
export function FieldList({ fields }: { fields: readonly FormField[] }) {
  return (
    <ul className="field-list">
      {fields.map((field) => {
        const { name, htmlId } = field.signals;
        const flags = [
          field.required && 'required',
          !field.visible && 'hidden',
          field.disabled && 'disabled',
          !hasClearLabel(field) && 'needs review',
        ].filter(Boolean);
        return (
          <li key={field.id}>
            <span className="field-name">{fieldDisplayName(field)}</span>
            <span className="field-meta">
              {field.htmlType === field.type ? field.type : `${field.type} (${field.htmlType})`}
              {name && ` · name="${name}"`}
              {htmlId && ` · id="${htmlId}"`}
              {field.options && ` · ${field.options.length} options`}
            </span>
            {flags.length > 0 && <span className="field-flags">{flags.join(' · ')}</span>}
          </li>
        );
      })}
    </ul>
  );
}
