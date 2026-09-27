import type { FieldIdentity, FieldSignals, FormFieldRecord } from './form-field';
import type { FieldType } from './field-type';

/** A single profile value, as it is sent to the page for filling. */
export type FillValue = string | number | boolean;

/**
 * One approved field/value pair. `expected` is the field's metadata at analysis time,
 * used to detect that the page changed and the id now points at a different field (or,
 * in a repeated section, at a field of a different record).
 */
export interface FillInstruction {
  fieldId: string;
  value: FillValue;
  expected: {
    type: FieldType;
    record?: FormFieldRecord;
    /**
     * Set only for a repeated field the user assigned to a profile record: how many times
     * its question appeared at analysis. The field is filled only if that is unchanged.
     * (The record itself is never sent to the page.)
     */
    repeatedCount?: number;
    /** For an assigned field: its identity at analysis, which must still hold. */
    identity?: FieldIdentity;
  } & Pick<FieldSignals, 'name' | 'htmlId' | 'label'>;
}

/**
 * - filled: the value was written and the page was notified.
 * - skipped: deliberately not filled (e.g. no profile value, field now hidden, or it
 *   already has a value).
 * - failed: filling was attempted but could not be done safely (e.g. no matching option).
 * - not-found: the field no longer exists or was replaced by a different field.
 * - unsupported: the field or value cannot be filled by this adapter.
 */
export type FillStatus = 'filled' | 'skipped' | 'failed' | 'not-found' | 'unsupported';

export interface FillResult {
  fieldId: string;
  status: FillStatus;
  /** Short explanation for the user. Never contains the value. */
  message: string;
}
