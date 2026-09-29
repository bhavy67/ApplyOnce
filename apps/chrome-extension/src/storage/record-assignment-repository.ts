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

/**
 * Bump when the stored shape changes; unknown versions are refused, never discarded.
 *
 * - 1: page, field id, field metadata, target (Phase 13).
 * - 2: plus `identityKey`, the field's semantic identity (Phase 14). Version 1 entries are
 *   read unchanged (no identity key) and kept until removed or reassigned.
 */
export const RECORD_ASSIGNMENTS_VERSION = 2;

/** Oldest assignments beyond this are dropped: they are page-scoped and cheap to redo. */
export const MAX_RECORD_ASSIGNMENTS = 500;

/**
 * The user's explicit choice of profile record for one repeated field on one page
 * ("this Degree on this page is Education record <id>'s degree"). Page-scoped by design: the
 * field is identified by the page (origin + path), its semantic identity (`identityKey`, a
 * fingerprint unique on the page when saved), and its metadata including how many times its
 * question appears. If any of that differs, the assignment does not apply and the field must
 * be assigned again. Never a question-level rule. Only fields with a unique identity are
 * saved; see the service worker for identical copies.
 */
export interface RecordAssignment {
  page: string;
  /** The field id when assigned (for removal and version 1 matching). */
  fieldId: string;
  /** Semantic identity (FieldIdentity.key). Absent on entries saved by version 1. */
  identityKey?: string;
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
  version: typeof RECORD_ASSIGNMENTS_VERSION | 1;
  assignments: RecordAssignment[];
}

/** Identifies one stored assignment (for removal); built from stored data only. */
export interface AssignmentHandle {
  page: string;
  fieldId: string;
  identityKey?: string;
}

export type SaveAssignmentResult =
  { ok: true; assignment: RecordAssignment } | { ok: false; error: 'invalid-assignment' };

export interface RecordAssignmentRepository {
  list(): Promise<RecordAssignment[]>;
  /**
   * Creates or replaces the assignment for this page and field (one per field, by identity
   * or field id). The field must have a unique identity.
   */
  save(input: { page: string; field: FormField; target: string }): Promise<SaveAssignmentResult>;
  /** Removes the assignments of this field (by identity or field id). */
  deleteForField(page: string, field: FormField): Promise<boolean>;
  /** Removes exactly one stored assignment. */
  remove(handle: AssignmentHandle): Promise<boolean>;
  clear(): Promise<void>;
}

export class UnsupportedRecordAssignmentsVersionError extends Error {
  constructor(readonly storedVersion: unknown) {
    super(`Record assignments have unsupported version ${String(storedVersion)}`);
    this.name = 'UnsupportedRecordAssignmentsVersionError';
  }
}

/** Stored assignments of a known version whose content is malformed; refused, never repaired. */
export class CorruptedRecordAssignmentsError extends Error {
  constructor() {
    super('Record assignments are corrupted');
    this.name = 'CorruptedRecordAssignmentsError';
  }
}

const isText = (value: unknown, max = 10_000) => typeof value === 'string' && value.length <= max;

/**
 * One stored assignment exactly as this repository writes it: only known keys, a page key
 * (origin + path, never credentials, query, or fragment), a record-id target with a canonical
 * field, field metadata only, and an identity key when present.
 */
export function isStoredRecordAssignment(value: unknown): value is RecordAssignment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const keys = ['page', 'fieldId', 'identityKey', 'field', 'target', 'createdAt', 'updatedAt'];
  if (!Object.keys(entry).every((k) => keys.includes(k))) return false;
  const field = entry.field as Record<string, unknown> | null;
  if (typeof field !== 'object' || field === null || Array.isArray(field)) return false;
  if (
    !Object.keys(field).every((k) =>
      ['type', 'name', 'htmlId', 'label', 'repeatedCount'].includes(k),
    )
  )
    return false;
  return (
    isPageKey(entry.page) &&
    isText(entry.fieldId, 2000) &&
    (entry.identityKey === undefined || isIdentityKey(entry.identityKey)) &&
    isRecordIdTarget(entry.target) &&
    typeof field.type === 'string' &&
    resolveProfileTarget(entry.target)?.fieldTypes.includes(field.type as FieldType) === true &&
    ['name', 'htmlId', 'label'].every((k) => field[k] === undefined || isText(field[k])) &&
    Number.isInteger(field.repeatedCount) &&
    (field.repeatedCount as number) >= 1 &&
    isText(entry.createdAt, 64) &&
    isText(entry.updatedAt, 64)
  );
}

export function isIdentityKey(value: unknown): value is string {
  return typeof value === 'string' && /^fp-[0-9a-f]{16}$/.test(value);
}

/** An entry belongs to this field: same page, and same identity (or, version 1, field id). */
function isForField(a: RecordAssignment, page: string, field: FormField): boolean {
  if (a.page !== page) return false;
  return a.identityKey !== undefined
    ? a.identityKey === field.identity?.key
    : a.fieldId === field.id;
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

/**
 * The same field as when it was assigned: same kind, name, label, and repeat count, and the
 * same element id unless `byIdentity`. Entries matched by semantic identity skip the id: an
 * authored id is already part of the identity, and a generated one (React, Vue, Angular, …)
 * changes on every render.
 */
export function isSameAssignedField(
  assigned: AssignedField,
  field: FormField,
  byIdentity = false,
): boolean {
  const current = assignedFieldOf(field);
  return (
    assigned.type === current.type &&
    assigned.name === current.name &&
    (byIdentity || assigned.htmlId === current.htmlId) &&
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
    // Version 1 entries have the same shape without identityKey: read as they are.
    const version = (record as { version?: unknown } | null)?.version;
    if (version !== RECORD_ASSIGNMENTS_VERSION && version !== 1) {
      throw new UnsupportedRecordAssignmentsVersionError(version);
    }
    // Every entry is checked; one malformed entry refuses the whole record (fail closed).
    const { assignments } = record as { assignments: unknown };
    if (
      !Array.isArray(assignments) ||
      assignments.length > MAX_RECORD_ASSIGNMENTS ||
      !assignments.every(isStoredRecordAssignment)
    ) {
      throw new CorruptedRecordAssignmentsError();
    }
    return assignments;
  }

  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = writes.then(operation);
    writes = result.catch(() => undefined);
    return result;
  }

  const write = (assignments: RecordAssignment[]) =>
    store.set('recordAssignments', { version: RECORD_ASSIGNMENTS_VERSION, assignments });

  function removeWhere(predicate: (a: RecordAssignment) => boolean): Promise<boolean> {
    return serialized(async () => {
      const assignments = await read();
      const remaining = assignments.filter((a) => !predicate(a));
      if (remaining.length === assignments.length) return false;
      await write(remaining);
      return true;
    });
  }

  return {
    list: read,

    save({ page, field, target }) {
      const definition = resolveProfileTarget(target);
      const valid =
        isPageKey(page) &&
        isRecordIdTarget(target) &&
        definition?.fieldTypes.includes(field.type) === true &&
        !field.record &&
        (field.repeatedCount ?? 1) > 1 &&
        field.identity?.unique === true &&
        isIdentityKey(field.identity.key);
      if (!valid) return Promise.resolve({ ok: false, error: 'invalid-assignment' });
      return serialized(async () => {
        const assignments = await read();
        const identityKey = field.identity?.key;
        const mine = (a: RecordAssignment) => isForField(a, page, field);
        const existing = assignments.find(mine);
        const timestamp = now().toISOString();
        const assignment: RecordAssignment = {
          page,
          fieldId: field.id,
          ...(identityKey ? { identityKey } : {}),
          field: assignedFieldOf(field),
          target,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        const others = assignments.filter((a) => !mine(a));
        await write([...others, assignment].slice(-MAX_RECORD_ASSIGNMENTS));
        return { ok: true as const, assignment };
      });
    },

    deleteForField(page, field) {
      return removeWhere((a) => isForField(a, page, field));
    },

    remove(handle) {
      return removeWhere(
        (a) =>
          a.page === handle.page &&
          a.fieldId === handle.fieldId &&
          a.identityKey === handle.identityKey,
      );
    },

    clear: () => serialized(() => store.remove('recordAssignments')),
  };
}
