import type { FillResult, FormField } from '@applyonce/core';
import { useEffect, useId, useState } from 'react';
import {
  PROFILE_RECORD_COLLECTION_DEFINITIONS,
  PROFILE_RECORD_COLLECTIONS,
  recordFieldsOf,
  recordIdTarget,
} from '@applyonce/core';
import type {
  ProfileRecordCounts,
  RecordChoicesByCollection,
  ReviewedMapping,
} from '../messaging/protocol';
import { fieldDisplayName, loadRecordChoices } from './analyze-page';
import {
  assignActionLabel,
  canAssign,
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
  /** Assigns a repeated field to one profile record; absent where assignment is unavailable. */
  onAssign?: (field: FormField, target: string) => Promise<string | undefined>;
  onUnassign: (field: FormField) => Promise<string | undefined>;
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
  onAssign,
  onUnassign,
}: ReviewItemProps) {
  const [assigning, setAssigning] = useState(false);
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
      {onAssign &&
        canAssign(mapping, field) &&
        (assigning ? (
          <AssignEditor
            field={field}
            current={mapping.source === 'assigned' ? mapping.profileField : undefined}
            onCancel={() => setAssigning(false)}
            onSave={async (target) => {
              const error = await onAssign(field, target);
              if (!error) setAssigning(false);
              return error;
            }}
          />
        ) : (
          <div className="assign-actions">
            <button
              type="button"
              className="link assign"
              disabled={disabled}
              onClick={() => setAssigning(true)}
            >
              {assignActionLabel(mapping)}
            </button>
            {mapping.source === 'assigned' && (
              <button
                type="button"
                className="link unassign"
                disabled={disabled}
                onClick={() => void onUnassign(field)}
              >
                Remove assignment
              </button>
            )}
          </div>
        ))}
    </li>
  );
}

interface AssignEditorProps {
  field: FormField;
  current: string | undefined;
  onSave: (target: string) => Promise<string | undefined>;
  onCancel: () => void;
}

/**
 * Choose one specific profile record and field for a repeated question: records are grouped
 * as "Education 2 — University A · Master's" (current order), with the fields this control
 * can hold. Record ids stay in option values only; they are never shown.
 */
function AssignEditor({ field, current, onSave, onCancel }: AssignEditorProps) {
  const selectId = useId();
  const [choices, setChoices] = useState<RecordChoicesByCollection | null>();
  const [choice, setChoice] = useState(current ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    loadRecordChoices().then(
      (loaded) => !cancelled && setChoices(loaded ?? null),
      () => !cancelled && setChoices(null),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = choices
    ? PROFILE_RECORD_COLLECTIONS.flatMap((collection) => {
        const fields = recordFieldsOf(collection).filter(
          (f) => f.teachable && f.fieldTypes.includes(field.type),
        );
        if (fields.length === 0) return [];
        return choices[collection].map((record) => ({
          label: record.summary ? `${record.label} — ${record.summary}` : record.label,
          options: fields.map((f) => ({
            value: recordIdTarget(collection, record.recordId, f.field),
            text: `${record.label} → ${f.label}`,
          })),
        }));
      })
    : [];

  async function save() {
    setSaving(true);
    setError(await onSave(choice));
    setSaving(false);
  }

  return (
    <div className="teach-editor assign-editor">
      <label htmlFor={selectId}>Assign to record</label>
      {field.identity?.unique !== true && (
        <p className="note warning" role="note">
          This question appears more than once with nothing to tell the copies apart, so ApplyOnce
          can’t keep track of which is which. This assignment won’t be saved: it applies only until
          you close this popup.
        </p>
      )}
      {choices === undefined ? (
        <p className="note">Loading your records…</p>
      ) : groups.length === 0 ? (
        <p className="note">
          {choices === null
            ? 'Your records could not be loaded.'
            : `No ${PROFILE_RECORD_COLLECTIONS.map((c) => PROFILE_RECORD_COLLECTION_DEFINITIONS[c].label.toLowerCase()).join(', ')} records can hold this field. Add them on the profile page.`}
        </p>
      ) : (
        <select id={selectId} value={choice} onChange={(event) => setChoice(event.target.value)}>
          <option value="">Choose a record and field…</option>
          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.text}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      <div className="teach-actions">
        <button
          type="button"
          className="small"
          disabled={!choice || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save assignment'}
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
