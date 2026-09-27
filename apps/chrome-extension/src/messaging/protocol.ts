import type {
  FieldMapping,
  FillInstruction,
  FillResult,
  FormField,
  ProfileRecordCollection,
  SavedMapping,
} from '@applyonce/core';
import type { Profile } from '@applyonce/profile';
import {
  isBoundedArray,
  isFillInstruction,
  isFormField,
  isHostname,
  isMappingKey,
  isRecord,
} from './validate';

/**
 * Every message exchanged between extension contexts. Messages never leave the
 * extension; nothing here talks to external services.
 *
 *   popup ──Ping/ScanPage──► content script              (tabs.sendMessage)
 *   content script ──GetProfileStatus──► service worker  (runtime.sendMessage)
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
  /** Null when the profile could not be read. */
  profileStatus: ProfileStatus | null;
}

/** A mapping as shown for review: whether the profile has a value, never the value. */
export interface ReviewedMapping extends FieldMapping {
  hasValue: boolean;
}

/** The user's approval to fill one field from one profile field. */
export interface FieldApproval {
  field: FormField;
  profileField: string;
}

/** Request payload for each message type (undefined = no payload). */
export interface PayloadByType {
  [MessageType.Ping]: undefined;
  [MessageType.ScanPage]: undefined;
  [MessageType.GetProfile]: undefined;
  [MessageType.GetProfileStatus]: undefined;
  [MessageType.MapFields]: { fields: FormField[] };
  [MessageType.FillPage]: { tabId: number; approvals: FieldApproval[] };
  [MessageType.FillFields]: { instructions: FillInstruction[] };
  [MessageType.SaveMapping]: { field: FormField; profileField: string; site?: string };
  [MessageType.ListMappings]: undefined;
  [MessageType.DeleteMapping]: { key: string };
  [MessageType.ClearMappings]: undefined;
  [MessageType.GetRuntimeInfo]: undefined;
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
const PAYLOAD_VALIDATORS: Partial<Record<MessageType, (payload: unknown) => boolean>> = {
  [MessageType.MapFields]: (p) =>
    isRecord(p) && isBoundedArray(p.fields) && p.fields.every(isFormField),
  [MessageType.FillPage]: (p) =>
    isRecord(p) &&
    Number.isInteger(p.tabId) &&
    isBoundedArray(p.approvals) &&
    p.approvals.every(
      (a) => isRecord(a) && isFormField(a.field) && typeof a.profileField === 'string',
    ),
  [MessageType.FillFields]: (p) =>
    isRecord(p) && isBoundedArray(p.instructions) && p.instructions.every(isFillInstruction),
  [MessageType.SaveMapping]: (p) =>
    isRecord(p) &&
    isFormField(p.field) &&
    typeof p.profileField === 'string' &&
    (p.site === undefined || isHostname(p.site)),
  [MessageType.DeleteMapping]: (p) => isRecord(p) && isMappingKey(p.key),
};

const MESSAGE_TYPES: ReadonlySet<string> = new Set(Object.values(MessageType));

/** Validates an incoming message, including its payload, without trusting its shape. */
export function parseMessage(value: unknown): MessageResult<Message> {
  if (!isRecord(value) || typeof value.type !== 'string') return fail('malformed-message');
  if (!MESSAGE_TYPES.has(value.type)) return fail('unknown-message');
  const type = value.type as MessageType;
  const validate = PAYLOAD_VALIDATORS[type];
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
    (value.profileStatus === null || isRecord(value.profileStatus))
  );
}

export function isFillResultList(value: unknown): value is FillResult[] {
  return (
    Array.isArray(value) &&
    value.every((r) => isRecord(r) && typeof r.fieldId === 'string' && typeof r.status === 'string')
  );
}
