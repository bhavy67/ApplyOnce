import type { FillResult, FormField } from '@applyonce/core';
import { useId, useState } from 'react';
import type { ProfileRecordCounts, ReviewedMapping } from '../messaging/protocol';
import { fieldDisplayName } from './analyze-page';
import {
  canTeach,
  FILL_STATUS_LABELS,
  isSelectable,
  mappingNote,
  mappingLine,
  teachActionLabel,
  teachOptions,
} from './review';

interface ReviewListProps {
  fields: readonly FormField[];
  mappings: ReadonlyMap<string, ReviewedMapping>;
  selected: ReadonlySet<string>;
  results: ReadonlyMap<string, FillResult>;
  /** Record counts, so Teach Once offers only records the profile has. */
  records: ProfileRecordCounts;
  disabled: boolean;
  onToggle: (fieldId: string, selected: boolean) => void;
  /** Saves a taught mapping; resolves to an error message, or undefined on success. */
  onTeach: (field: FormField, profileField: string) => Promise<string | undefined>;
}

/** Each detected field with its mapping, source, and fill state. Never shows values. */
export function ReviewList({ fields, mappings, ...rest }: ReviewListProps) {
  return (
    <ul className="review-list">
      {fields.map((field) => {
        const mapping = mappings.get(field.id);
        return mapping ? (
          <ReviewItem key={field.id} field={field} mapping={mapping} {...rest} />
        ) : null;
      })}
    </ul>
  );
}

type ReviewItemProps = Omit<ReviewListProps, 'fields' | 'mappings'> & {
  field: FormField;
  mapping: ReviewedMapping;
};

function ReviewItem({
  field,
  mapping,
  selected,
  results,
  records,
  disabled,
  onToggle,
  onTeach,
}: ReviewItemProps) {
  const checkboxId = useId();
  const [teaching, setTeaching] = useState(false);
  const isSelected = selected.has(field.id);
  const result = results.get(field.id);
  const { name, htmlId } = field.signals;

  return (
    <li className={`review-item status-${mapping.status} source-${mapping.source}`}>
      <div className="review-row">
        <input
          id={checkboxId}
          type="checkbox"
          checked={isSelected}
          disabled={disabled || !isSelectable(mapping)}
          onChange={(event) => onToggle(field.id, event.target.checked)}
        />
        <label htmlFor={checkboxId} className="review-body">
          <span className="field-name">{fieldDisplayName(field)}</span>
          <span className="mapping">{mappingLine(mapping, field)}</span>
          <span className="field-meta">
            {field.type}
            {name && ` · name="${name}"`}
            {htmlId && ` · id="${htmlId}"`}
          </span>
          <span className={`note ${result ? `result-${result.status}` : ''}`}>
            {result
              ? `${FILL_STATUS_LABELS[result.status]}. ${result.status === 'filled' ? '' : result.message}`
              : mappingNote(mapping, isSelected)}
          </span>
        </label>
      </div>
      {canTeach(mapping) &&
        (teaching ? (
          <TeachEditor
            field={field}
            records={records}
            current={mapping.profileField}
            onCancel={() => setTeaching(false)}
            onSave={async (profileField) => {
              const error = await onTeach(field, profileField);
              if (!error) setTeaching(false);
              return error;
            }}
          />
        ) : (
          <button
            type="button"
            className="link teach"
            disabled={disabled}
            onClick={() => setTeaching(true)}
          >
            {teachActionLabel(mapping)}
          </button>
        ))}
    </li>
  );
}

interface TeachEditorProps {
  field: FormField;
  records: ProfileRecordCounts;
  current: string | undefined;
  onSave: (profileField: string) => Promise<string | undefined>;
  onCancel: () => void;
}

/** Choose a profile field (only ones this field type can hold). No free-text values. */
function TeachEditor({ field, records, current, onSave, onCancel }: TeachEditorProps) {
  const selectId = useId();
  const groups = teachOptions(field.type, records);
  const [choice, setChoice] = useState(current ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    setSaving(true);
    setError(await onSave(choice));
    setSaving(false);
  }

  return (
    <div className="teach-editor">
      <label htmlFor={selectId}>Map to</label>
      <select id={selectId} value={choice} onChange={(event) => setChoice(event.target.value)}>
        <option value="">Choose a profile field…</option>
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="teach-actions">
        <button
          type="button"
          className="small"
          disabled={!choice || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save mapping'}
        </button>
        <button type="button" className="small secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
