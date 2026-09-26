import type { FillResult, FormField } from '@applyonce/core';
import type { ReviewedMapping } from '../messaging/protocol';
import { fieldDisplayName } from './analyze-page';
import {
  CONFIDENCE_LABELS,
  FILL_STATUS_LABELS,
  isSelectable,
  mappingNote,
  profileFieldDescription,
} from './review';

interface ReviewListProps {
  fields: readonly FormField[];
  mappings: ReadonlyMap<string, ReviewedMapping>;
  selected: ReadonlySet<string>;
  results: ReadonlyMap<string, FillResult>;
  disabled: boolean;
  onToggle: (fieldId: string, selected: boolean) => void;
}

/** Each detected field with its mapping, confidence, and fill state. Never shows values. */
export function ReviewList({
  fields,
  mappings,
  selected,
  results,
  disabled,
  onToggle,
}: ReviewListProps) {
  return (
    <ul className="review-list">
      {fields.map((field) => {
        const mapping = mappings.get(field.id);
        if (!mapping) return null;
        const isSelected = selected.has(field.id);
        const result = results.get(field.id);
        const target = profileFieldDescription(mapping);
        const { name, htmlId } = field.signals;
        return (
          <li key={field.id} className={`review-item status-${mapping.status}`}>
            <label>
              <input
                type="checkbox"
                checked={isSelected}
                disabled={disabled || !isSelectable(mapping)}
                onChange={(event) => onToggle(field.id, event.target.checked)}
              />
              <span className="review-body">
                <span className="field-name">{fieldDisplayName(field)}</span>
                <span className="mapping">
                  {target ? `→ ${target}` : 'No match'}
                  {mapping.status !== 'unknown' &&
                    ` · ${CONFIDENCE_LABELS[mapping.confidence.level]}`}
                </span>
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
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
