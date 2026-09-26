import type { FormField } from '@applyonce/core';
import type { Profile } from '@applyonce/profile';

/**
 * Every message exchanged between extension contexts. Messages never leave the
 * extension; nothing here talks to external services.
 *
 *   popup ──ScanPage/Ping──► content script (tabs.sendMessage)
 *   content script ──GetProfileStatus──► service worker (runtime.sendMessage)
 *   extension pages ──GetProfile──► service worker
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
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export interface Message<T extends MessageType = MessageType> {
  type: T;
}

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

/** Response payload for each message type. */
export interface ResponseDataByType {
  [MessageType.Ping]: { ready: true };
  [MessageType.ScanPage]: PageScan;
  [MessageType.GetProfile]: Profile;
  [MessageType.GetProfileStatus]: ProfileStatus;
}

export type MessageError =
  | 'malformed-message'
  | 'unknown-message'
  | 'forbidden'
  | 'profile-unavailable'
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

const MESSAGE_TYPES: ReadonlySet<string> = new Set(Object.values(MessageType));

/** Validates an incoming message without trusting its shape. */
export function parseMessage(value: unknown): MessageResult<Message> {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return fail('malformed-message');
  }
  if (typeof value.type !== 'string') return fail('malformed-message');
  if (!MESSAGE_TYPES.has(value.type)) return fail('unknown-message');
  return ok({ type: value.type as MessageType });
}

export function isMessageResult(value: unknown): value is MessageResult<unknown> {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false;
  return value.ok === true ? 'data' in value : 'error' in value && typeof value.error === 'string';
}

export function isPageScan(value: unknown): value is PageScan {
  return (
    typeof value === 'object' &&
    value !== null &&
    'title' in value &&
    typeof value.title === 'string' &&
    'platform' in value &&
    typeof value.platform === 'string' &&
    'fields' in value &&
    Array.isArray(value.fields) &&
    'profileStatus' in value &&
    (value.profileStatus === null || typeof value.profileStatus === 'object')
  );
}
