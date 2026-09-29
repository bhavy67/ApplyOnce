import type { AssignmentHandle } from '../storage/record-assignment-repository';
import type {
  FieldMapping,
  FieldType,
  FillInstruction,
  FillResult,
  FormField,
  ProfileRecordCollection,
  SavedMapping,
} from '@applyonce/core';
import type { Profile } from '@applyonce/profile';
import { isRecordIdTarget } from '@applyonce/core';
import {
  hasOnlyKeys,
  isBoundedArray,
  isBoundedText,
  isFillInstruction,
  isFormField,
  isHostname,
  isMappingKey,
  isPageKey,
  isProfileTargetText,
  isRecord,
} from './validate';

/**
 * Every message exchanged between extension contexts. Messages never leave the
 * extension; nothing here talks to external services.
 *
 *   popup ──Ping/ScanPage──► content script              (tabs.sendMessage)
 *   popup ──GetProfileStatus──► service worker            (content scripts are refused
 *                                                          every service worker message)
 *   popup ──MapFields/FillPage──► service worker
 *   service worker ──FillFields──► content script        (approved values only)
 *   extension pages ──GetProfile──► service worker
 *   extension pages ──SaveMapping/ListMappings/DeleteMapping/ClearMappings──► service worker
 */
export const MessageType = {
  /** Is the content script already present in this tab? */
  Ping: 'applyonce/ping',
  /** Scan the page once and return field metadata. */
  ScanPage: 'applyonce/scan-page',
  /** The full saved profile. Extension pages only; refused for content scripts. */
  GetProfile: 'applyonce/get-profile',
  /** Whether a profile is saved, without any of its values. */
  GetProfileStatus: 'applyonce/get-profile-status',
  /** Map scanned fields to profile fields. Reports whether values exist, not the values. */
  MapFields: 'applyonce/map-fields',
  /** Fill the fields the user approved in a tab. Extension pages only. */
  FillPage: 'applyonce/fill-page',
  /** Service worker → content script: write these approved values into the page. */
  FillFields: 'applyonce/fill-fields',
  /** Teach Once: save (or replace) the mapping for a field. Extension pages only. */
  SaveMapping: 'applyonce/save-mapping',
  /** Saved mappings, for the management view. Extension pages only. */
  ListMappings: 'applyonce/list-mappings',
  DeleteMapping: 'applyonce/delete-mapping',
  ClearMappings: 'applyonce/clear-mappings',
  /** Which build the service worker runs, to detect a stale worker. Extension pages only. */
  GetRuntimeInfo: 'applyonce/get-runtime-info',
  /** Assign a repeated field on a page to one profile record. Extension pages only. */
  SaveAssignment: 'applyonce/save-assignment',
  /** Remove a field's record assignment. Extension pages only. */
  DeleteAssignment: 'applyonce/delete-assignment',
  /** The profile's records, labeled, to choose from when assigning. Extension pages only. */
  GetRecordChoices: 'applyonce/get-record-choices',
  /** Saved record assignments, for the management view. Extension pages only. */
  ListAssignments: 'applyonce/list-assignments',
  /** Remove one saved record assignment (management view). Extension pages only. */
  RemoveAssignment: 'applyonce/remove-assignment',
  /** Remove every saved record assignment. Extension pages only. */
  ClearAssignments: 'applyonce/clear-assignments',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** How many records each collection has. Counts only: never record values. */
export type ProfileRecordCounts = Readonly<Record<ProfileRecordCollection, number>>;

export interface ProfileStatus {
  hasData: boolean;
  valueCount: number;
}

export interface PageScan {
  title: string;
  /** Adapter that recognised the page ("generic", "workday", "greenhouse"). */
  platform: string;
  fields: FormField[];
  /**
   * Set when the platform's adapter could not read the page safely: `fields` is then empty
   * and nothing can be filled until the page changes.
   */
  unsupported?: true;
  /**
   * Added by the popup (the content script never asks the service worker for anything).
   * Null when the profile could not be read.
   */
  profileStatus?: ProfileStatus | null;
}

/** A mapping as shown for review: whether the profile has a value, never the value. */
export interface ReviewedMapping extends FieldMapping {
  hasValue: boolean;
  /**
   * For record assignments: the record's current position and field, e.g.
   * "Education 2 → Degree" (the stored target uses the record id, never shown).
   */
  targetLabel?: string;
  /**
   * Set for an assignment of identical copies (no unique identity): it is not saved and holds
   * only for this review.
   */
  transient?: boolean;
}

/** A saved record assignment as the management view shows it: labels only. */
export interface AssignmentView {
  /** Identifies the entry for removal; never displayed. */
  handle: AssignmentHandle;
  site: string;
  path: string;
  question: string;
  controlType: FieldType;
  /** "Education 2 · Degree", from the record's current position. */
  target: string;
  /** False when the assigned record no longer exists. */
  available: boolean;
  /** "legacy": saved before field identities (Phase 13). */
  kind: 'identity' | 'legacy';
}

/** One record to choose from when assigning, labeled for the extension UI. */
export interface RecordChoiceView {
  recordId: string;
  /** "Education 2" (current position). */
  label: string;
  /** "University A · Master's"; may be empty. */
  summary: string;
}

export type RecordChoicesByCollection = Readonly<
  Record<ProfileRecordCollection, readonly RecordChoiceView[]>
>;

/** The user's approval to fill one field from one profile field. */
export interface FieldApproval {
  field: FormField;
  profileField: string;
  /** An unsaved record assignment (identical copies), re-checked by the service worker. */
  transient?: boolean;
}

/** Request payload for each message type (undefined = no payload). */
export interface PayloadByType {
  [MessageType.Ping]: undefined;
  [MessageType.ScanPage]: undefined;
  [MessageType.GetProfile]: undefined;
  [MessageType.GetProfileStatus]: undefined;
  /** `page` (origin + path) lets record assignments for that page apply. */
  [MessageType.MapFields]: { fields: FormField[]; page?: string };
  [MessageType.FillPage]: { tabId: number; approvals: FieldApproval[]; page?: string };
  [MessageType.FillFields]: { instructions: FillInstruction[] };
  [MessageType.SaveMapping]: { field: FormField; profileField: string; site?: string };
  [MessageType.ListMappings]: undefined;
  [MessageType.DeleteMapping]: { key: string };
  [MessageType.ClearMappings]: undefined;
  [MessageType.GetRuntimeInfo]: undefined;
  [MessageType.SaveAssignment]: { page: string; field: FormField; target: string };
  [MessageType.DeleteAssignment]: { page: string; field: FormField };
  [MessageType.GetRecordChoices]: undefined;
  [MessageType.ListAssignments]: undefined;
  [MessageType.RemoveAssignment]: { handle: AssignmentHandle };
  [MessageType.ClearAssignments]: undefined;
}

/** Response payload for each message type. */
export interface ResponseDataByType {
  [MessageType.Ping]: { ready: true };
  [MessageType.ScanPage]: PageScan;
  [MessageType.GetProfile]: Profile;
  [MessageType.GetProfileStatus]: ProfileStatus;
  /** `records` lets the popup offer Teach Once targets for existing records only. */
  [MessageType.MapFields]: { mappings: ReviewedMapping[]; records: ProfileRecordCounts };
  [MessageType.FillPage]: { results: FillResult[] };
  [MessageType.FillFields]: { results: FillResult[] };
  /** The field's mapping after teaching, ready to replace the one under review. */
  [MessageType.SaveMapping]: { mapping: ReviewedMapping };
  [MessageType.ListMappings]: { mappings: SavedMapping[] };
  [MessageType.DeleteMapping]: { deleted: boolean };
  [MessageType.ClearMappings]: { cleared: true };
  [MessageType.GetRuntimeInfo]: { buildId: string };
  /** The field's mapping after the change, for review. */
  [MessageType.SaveAssignment]: { mapping: ReviewedMapping };
  [MessageType.DeleteAssignment]: { mapping: ReviewedMapping };
  [MessageType.GetRecordChoices]: { records: RecordChoicesByCollection };
  [MessageType.ListAssignments]: { assignments: AssignmentView[] };
  [MessageType.RemoveAssignment]: { removed: boolean };
  [MessageType.ClearAssignments]: { cleared: true };
}

export type Message<T extends MessageType = MessageType> = T extends MessageType
  ? PayloadByType[T] extends undefined
    ? { type: T }
    : { type: T; payload: PayloadByType[T] }
  : never;

export type PayloadArgs<T extends MessageType> = PayloadByType[T] extends undefined
  ? []
  : [payload: PayloadByType[T]];

export function createMessage<T extends MessageType>(type: T, ...args: PayloadArgs<T>): Message<T> {
  return (args.length > 0 ? { type, payload: args[0] } : { type }) as Message<T>;
}

export type MessageError =
  | 'malformed-message'
  | 'unknown-message'
  | 'forbidden'
  | 'profile-unavailable'
  /** A mapping that cannot be saved: not a profile field, wrong field type, or unkeyable field. */
  | 'invalid-mapping'
  | 'mappings-unavailable'
  | 'internal-error'
  /** Nobody answered (e.g. no content script in the tab). */
  | 'no-receiver'
  /** The answer did not have the expected shape. */
  | 'malformed-response';

export type MessageResult<T> = { ok: true; data: T } | { ok: false; error: MessageError };

export type ResponseFor<T extends MessageType> = MessageResult<ResponseDataByType[T]>;

export const ok = <T>(data: T): MessageResult<T> => ({ ok: true, data });
export const fail = (error: MessageError): { ok: false; error: MessageError } => ({
  ok: false,
  error,
});

/** Payload validators; types without a payload need none. */
const isApproval = (a: unknown) =>
  isRecord(a) &&
  hasOnlyKeys(a, ['field', 'profileField', 'transient']) &&
  isFormField(a.field) &&
  isProfileTargetText(a.profileField) &&
  (a.transient === undefined || typeof a.transient === 'boolean');

/**
 * Payload validators; types without a payload need none (and must not carry one). Every
 * payload may hold only its own keys, and every profile target must be canonical: nothing
 * here trusts the sender's shapes, ids, targets, or pages.
 */
const PAYLOAD_VALIDATORS: Partial<Record<MessageType, (payload: unknown) => boolean>> = {
  [MessageType.MapFields]: (p) =>
    isRecord(p) &&
    hasOnlyKeys(p, ['fields', 'page']) &&
    isBoundedArray(p.fields) &&
    p.fields.every(isFormField) &&
    (p.page === undefined || isPageKey(p.page)),
  [MessageType.FillPage]: (p) =>
    isRecord(p) &&
    hasOnlyKeys(p, ['tabId', 'approvals', 'page']) &&
    Number.isSafeInteger(p.tabId) &&
    (p.tabId as number) >= 0 &&
    isBoundedArray(p.approvals) &&
    p.approvals.every(isApproval) &&
    (p.page === undefined || isPageKey(p.page)),
  [MessageType.FillFields]: (p) =>
    isRecord(p) &&
    hasOnlyKeys(p, ['instructions']) &&
    isBoundedArray(p.instructions) &&
    p.instructions.every(isFillInstruction),
  [MessageType.SaveMapping]: (p) =>
    isRecord(p) &&
    hasOnlyKeys(p, ['field', 'profileField', 'site']) &&
    isFormField(p.field) &&
    isProfileTargetText(p.profileField) &&
    (p.site === undefined || isHostname(p.site)),
  [MessageType.DeleteMapping]: (p) => isRecord(p) && hasOnlyKeys(p, ['key']) && isMappingKey(p.key),
  [MessageType.SaveAssignment]: (p) =>
    isRecord(p) &&
    hasOnlyKeys(p, ['page', 'field', 'target']) &&
    isPageKey(p.page) &&
    isFormField(p.field) &&
    isRecordIdTarget(p.target) &&
    isProfileTargetText(p.target),
  [MessageType.DeleteAssignment]: (p) =>
    isRecord(p) && hasOnlyKeys(p, ['page', 'field']) && isPageKey(p.page) && isFormField(p.field),
  [MessageType.RemoveAssignment]: (p) =>
    isRecord(p) &&
    hasOnlyKeys(p, ['handle']) &&
    isRecord(p.handle) &&
    hasOnlyKeys(p.handle, ['page', 'fieldId', 'identityKey']) &&
    isPageKey(p.handle.page) &&
    isBoundedText(p.handle.fieldId, 2000) &&
    (p.handle.identityKey === undefined ||
      (typeof p.handle.identityKey === 'string' && /^fp-[0-9a-f]{16}$/.test(p.handle.identityKey))),
};

const MESSAGE_TYPES: ReadonlySet<string> = new Set(Object.values(MessageType));

/** Validates an incoming message, including its payload, without trusting its shape. */
export function parseMessage(value: unknown): MessageResult<Message> {
  if (!isRecord(value) || typeof value.type !== 'string') return fail('malformed-message');
  if (!MESSAGE_TYPES.has(value.type)) return fail('unknown-message');
  const type = value.type as MessageType;
  const validate = PAYLOAD_VALIDATORS[type];
  // A message is { type } or { type, payload }; a payload where none belongs is refused.
  if (!hasOnlyKeys(value, validate ? ['type', 'payload'] : ['type'])) {
    return fail('malformed-message');
  }
  if (validate && !validate(value.payload)) return fail('malformed-message');
  return ok(value as Message);
}

export function isMessageResult(value: unknown): value is MessageResult<unknown> {
  if (!isRecord(value) || !('ok' in value)) return false;
  return value.ok === true ? 'data' in value : typeof value.error === 'string';
}

export function isPageScan(value: unknown): value is PageScan {
  return (
    isRecord(value) &&
    typeof value.title === 'string' &&
    typeof value.platform === 'string' &&
    Array.isArray(value.fields) &&
    (value.unsupported === undefined || value.unsupported === true) &&
    (value.profileStatus === undefined ||
      value.profileStatus === null ||
      isRecord(value.profileStatus))
  );
}

export function isFillResultList(value: unknown): value is FillResult[] {
  return (
    Array.isArray(value) &&
    value.every((r) => isRecord(r) && typeof r.fieldId === 'string' && typeof r.status === 'string')
  );
}
