import {
  isRecordIdTarget,
  resolveProfileTarget,
  type FieldType,
  type FormField,
  type LocalStore,
  type ProfileRecordIdTarget,
} from '@applyonce/core';
import { isPageKey } from '../messaging/validate';
import type { ExtensionStorageSchema } from './profile-repository';

/** Bump when the stored shape changes; unknown versions are refused, never discarded. */
export const RECORD_ASSIGNMENTS_VERSION = 1;

/** Oldest assignments beyond this are dropped: they are page-scoped and cheap to redo. */
export const MAX_RECORD_ASSIGNMENTS = 500;

/**
 * The user's explicit choice of profile record for one repeated field on one page
 * ("the second Degree on this page is Education record <id>'s degree"). Page-scoped by
 * design: the field is identified by the page (origin + path), its field id, and its
 * metadata including how many times its question appears. If any of that differs, the
 * assignment does not apply and the field must be assigned again. Never a question-level
 * rule, so it cannot apply to other pages or other fields asking the same question.
 */
export interface RecordAssignment {
  page: string;
  fieldId: string;
  field: AssignedField;
  target: ProfileRecordIdTarget;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}

/** Field metadata only (never values), as when the field was assigned. */
export interface AssignedField {
  type: FieldType;
  name?: string;
  htmlId?: string;
  label?: string;
  repeatedCount: number;
}

export interface RecordAssignmentsRecord {
  version: typeof RECORD_ASSIGNMENTS_VERSION;
  assignments: RecordAssignment[];
}

export type SaveAssignmentResult =
  { ok: true; assignment: RecordAssignment } | { ok: false; error: 'invalid-assignment' };

export interface RecordAssignmentRepository {
  list(): Promise<RecordAssignment[]>;
  /** Creates or replaces the assignment for this page and field (one per field). */
  save(input: { page: string; field: FormField; target: string }): Promise<SaveAssignmentResult>;
  delete(page: string, fieldId: string): Promise<boolean>;
  clear(): Promise<void>;
}

export class UnsupportedRecordAssignmentsVersionError extends Error {
  constructor(readonly storedVersion: unknown) {
    super(`Record assignments have unsupported version ${String(storedVersion)}`);
    this.name = 'UnsupportedRecordAssignmentsVersionError';
  }
}

export function assignedFieldOf(field: FormField): AssignedField {
  const { name, htmlId, label } = field.signals;
  return {
    type: field.type,
    ...(name !== undefined ? { name } : {}),
    ...(htmlId !== undefined ? { htmlId } : {}),
    ...(label !== undefined ? { label } : {}),
    repeatedCount: field.repeatedCount ?? 1,
  };
}

/** The same field as when it was assigned: same kind, name/id, label, and repeat count. */
export function isSameAssignedField(assigned: AssignedField, field: FormField): boolean {
  const current = assignedFieldOf(field);
  return (
    assigned.type === current.type &&
    assigned.name === current.name &&
    assigned.htmlId === current.htmlId &&
    assigned.label === current.label &&
    assigned.repeatedCount === current.repeatedCount
  );
}

/**
 * Record assignments over the extension's LocalStore, stored apart from the profile and the
 * saved (taught) mappings. Only metadata, a page key, and a record id target are stored:
 * never page values or profile values. Writes are serialized.
 */
export function createRecordAssignmentRepository(
  store: LocalStore<ExtensionStorageSchema>,
  now: () => Date = () => new Date(),
): RecordAssignmentRepository {
  let writes: Promise<unknown> = Promise.resolve();

  async function read(): Promise<RecordAssignment[]> {
    const record = await store.get('recordAssignments');
    if (record === undefined) return [];
    if (record.version !== RECORD_ASSIGNMENTS_VERSION) {
      throw new UnsupportedRecordAssignmentsVersionError(record.version);
    }
    return record.assignments;
  }

  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = writes.then(operation);
    writes = result.catch(() => undefined);
    return result;
  }

  const write = (assignments: RecordAssignment[]) =>
    store.set('recordAssignments', { version: RECORD_ASSIGNMENTS_VERSION, assignments });

  return {
    list: read,

    save({ page, field, target }) {
      const definition = resolveProfileTarget(target);
      const valid =
        isPageKey(page) &&
        isRecordIdTarget(target) &&
        definition?.fieldTypes.includes(field.type) === true &&
        !field.record &&
        (field.repeatedCount ?? 1) > 1;
      if (!valid) return Promise.resolve({ ok: false, error: 'invalid-assignment' });
      return serialized(async () => {
        const assignments = await read();
        const existing = assignments.find((a) => a.page === page && a.fieldId === field.id);
        const timestamp = now().toISOString();
        const assignment: RecordAssignment = {
          page,
          fieldId: field.id,
          field: assignedFieldOf(field),
          target,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        const others = assignments.filter((a) => a !== existing);
        await write([...others, assignment].slice(-MAX_RECORD_ASSIGNMENTS));
        return { ok: true as const, assignment };
      });
    },

    delete(page, fieldId) {
      return serialized(async () => {
        const assignments = await read();
        const remaining = assignments.filter((a) => !(a.page === page && a.fieldId === fieldId));
        if (remaining.length === assignments.length) return false;
        await write(remaining);
        return true;
      });
    },

    clear: () => serialized(() => store.remove('recordAssignments')),
  };
}
