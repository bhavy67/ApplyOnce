import {
  isRecordIdTarget,
  PROFILE_RECORD_COLLECTION_DEFINITIONS,
  PROFILE_RECORD_COLLECTIONS,
  resolveProfileTarget,
  type FieldMapping,
  type ProfileRecordCollection,
  type FillInstruction,
  type FillResult,
  type FormField,
} from '@applyonce/core';
import {
  applyRecordAssignments,
  createAliasMatcher,
  createMappingKeyParts,
  isAssignableField,
  mapFields,
  type SavedMappingLookup,
} from '@applyonce/field-mapper';
import {
  countProfileValues,
  getProfileValue,
  recordChoices,
  recordCount,
  recordIndexById,
  type Profile,
} from '@applyonce/profile';
import { BUILD_ID } from '../build-info';
import { logFailure } from '../log-failure';
import {
  fail,
  MessageType,
  ok,
  parseMessage,
  type FieldApproval,
  type MessageResult,
  type AssignmentView,
  type ProfileRecordCounts,
  type RecordChoicesByCollection,
  type ReviewedMapping,
} from '../messaging/protocol';
import type {
  ProfileRepository,
  RecordAssignmentRepository,
  SavedMappingRepository,
} from '../storage';
import {
  isSameAssignedField,
  type RecordAssignment,
} from '../storage/record-assignment-repository';

/** The parts of chrome.runtime.MessageSender the handler relies on. */
export interface Sender {
  url?: string;
}

/**
 * Sends approved instructions to the content script in a tab. Resolves to one result per
 * instruction, or undefined when the page could not be reached.
 */
export type FillInTab = (
  tabId: number,
  instructions: FillInstruction[],
) => Promise<FillResult[] | undefined>;

/**
 * Scans a tab again (the same scan as Analyze) right before filling. Resolves to the page's
 * current fields, "unreadable" when the platform adapter cannot read the page safely, or
 * undefined when the page could not be reached.
 */
export type ScanTab = (tabId: number) => Promise<readonly FormField[] | 'unreadable' | undefined>;

export interface ServiceWorkerMessageHandlerOptions {
  repository: ProfileRepository;
  mappings: SavedMappingRepository;
  /** Explicit record assignments for repeated fields. */
  assignments: RecordAssignmentRepository;
  /** e.g. "chrome-extension://<id>/", from chrome.runtime.getURL(''). */
  extensionOrigin: string;
  fillInTab: FillInTab;
  scanTab: ScanTab;
}

const matcher = createAliasMatcher();

/** Messages about saved mappings; storage failures for these are reported as such. */
const MAPPING_MESSAGES: ReadonlySet<string> = new Set([
  MessageType.SaveMapping,
  MessageType.ListMappings,
  MessageType.DeleteMapping,
  MessageType.ClearMappings,
  MessageType.SaveAssignment,
  MessageType.DeleteAssignment,
  MessageType.ListAssignments,
  MessageType.RemoveAssignment,
  MessageType.ClearAssignments,
]);

interface MappingContext {
  profile: Profile;
  lookup: SavedMappingLookup;
  assignments: readonly RecordAssignment[];
}

/**
 * Handles messages addressed to the service worker: the only context that reads the
 * profile for other contexts, and the only writer of saved mappings. Never throws: every
 * outcome is a MessageResult.
 */
export function createServiceWorkerMessageHandler({
  repository,
  mappings: savedMappings,
  assignments: recordAssignments,
  extensionOrigin,
  fillInTab,
  scanTab,
}: ServiceWorkerMessageHandlerOptions) {
  // Extension pages have this extension's own origin; a content script's sender URL is the
  // web page's. The origin ends with "/", so no other origin can match it as a prefix.
  const isExtensionPage = (sender: Sender) => sender.url?.startsWith(extensionOrigin) === true;

  /**
   * Saved mappings by key. If they cannot be read, mapping falls back to the automatic
   * matcher only (and taught approvals are then refused), rather than failing entirely.
   */
  async function loadContext(): Promise<MappingContext> {
    const profile = await repository.load();
    let lookup: SavedMappingLookup = new Map();
    try {
      const saved = await savedMappings.list();
      lookup = new Map(saved.map((mapping) => [mapping.key, mapping]));
    } catch (error) {
      logFailure('saved mappings load', error);
    }
    // Without assignments, repeated fields simply stay unsupported (never a fallback).
    const assignments = await recordAssignments.list().catch((error: unknown) => {
      logFailure('record assignments load', error);
      return [];
    });
    return { profile, lookup, assignments };
  }

  return async function handleMessage(
    rawMessage: unknown,
    sender: Sender,
  ): Promise<MessageResult<unknown>> {
    const parsed = parseMessage(rawMessage);
    if (!parsed.ok) return parsed;
    const message = parsed.data;

    // Phase 17: every service worker message requires an extension page. Content scripts
    // share a process with the web page and are never privileged callers: they get nothing
    // from the service worker, not even the profile status.
    if (!isExtensionPage(sender)) {
      return MESSAGE_TYPES_FOR_WORKER.has(message.type)
        ? fail('forbidden')
        : fail('unknown-message');
    }

    try {
      switch (message.type) {
        case MessageType.GetProfile:
          return ok(await repository.load());

        case MessageType.GetProfileStatus: {
          const valueCount = countProfileValues(await repository.load());
          return ok({ hasData: valueCount > 0, valueCount });
        }

        case MessageType.MapFields: {
          const { fields, page } = message.payload;
          const context = await loadContext();
          return ok({
            mappings: reviewMappings(fields, context, page),
            records: recordCounts(context.profile),
          });
        }

        case MessageType.FillPage: {
          const { tabId, approvals, page } = message.payload;
          return ok({
            results: await fillApproved(
              tabId,
              approvals,
              await loadContext(),
              { fillInTab, scanTab },
              page,
            ),
          });
        }

        case MessageType.SaveAssignment: {
          const { page, field, target } = message.payload;
          const context = await loadContext();
          if (!isValidAssignment(field, target, context)) return fail('invalid-mapping');
          // Identical copies (no unique identity) are never saved: the assignment lives only in
          // this review, so it cannot follow the field somewhere else later.
          if (field.identity?.unique !== true) {
            const [reviewed] = reviewMappings(
              [field],
              context,
              page,
              new Map([[field.id, target]]),
            );
            return reviewed ? ok({ mapping: reviewed }) : fail('internal-error');
          }
          const saved = await recordAssignments.save({ page, field, target });
          if (!saved.ok) return fail('invalid-mapping');
          // Assigning never fills: the updated mapping goes back for review only.
          const [reviewed] = reviewMappings([field], await loadContext(), page);
          return reviewed ? ok({ mapping: reviewed }) : fail('internal-error');
        }

        case MessageType.DeleteAssignment: {
          const { page, field } = message.payload;
          await recordAssignments.deleteForField(page, field);
          const [reviewed] = reviewMappings([field], await loadContext(), page);
          return reviewed ? ok({ mapping: reviewed }) : fail('internal-error');
        }

        case MessageType.GetRecordChoices:
          return ok({ records: recordChoicesView(await repository.load()) });

        case MessageType.ListAssignments: {
          const assignments = await recordAssignments.list();
          const profile = await repository.load();
          return ok({ assignments: assignments.map((a) => assignmentView(a, profile)) });
        }

        case MessageType.RemoveAssignment:
          return ok({ removed: await recordAssignments.remove(message.payload.handle) });

        case MessageType.ClearAssignments:
          await recordAssignments.clear();
          return ok({ cleared: true });

        case MessageType.SaveMapping: {
          const { field, profileField, site } = message.payload;
          const parts = createMappingKeyParts(field);
          if (!parts) return fail('invalid-mapping');
          const saved = await savedMappings.save({
            parts,
            profileField,
            ...(site ? { site } : {}),
          });
          if (!saved.ok) return fail('invalid-mapping');
          // Teaching never fills: the updated mapping goes back for review only.
          const [mapping] = reviewMappings([field], await loadContext());
          return mapping ? ok({ mapping }) : fail('internal-error');
        }

        case MessageType.GetRuntimeInfo:
          return ok({ buildId: BUILD_ID });

        case MessageType.ListMappings:
          return ok({ mappings: await savedMappings.list() });

        case MessageType.DeleteMapping:
          return ok({ deleted: await savedMappings.delete(message.payload.key) });

        case MessageType.ClearMappings:
          await savedMappings.clear();
          return ok({ cleared: true });

        default:
          return fail('unknown-message');
      }
    } catch (error) {
      logFailure(`service worker ${message.type}`, error);
      return fail(
        MAPPING_MESSAGES.has(message.type) ? 'mappings-unavailable' : 'profile-unavailable',
      );
    }
  };
}

/** Message types the service worker handles (the rest go to content scripts). */
const MESSAGE_TYPES_FOR_WORKER: ReadonlySet<string> = new Set([
  MessageType.GetProfile,
  MessageType.GetProfileStatus,
  MessageType.MapFields,
  MessageType.FillPage,
  MessageType.GetRuntimeInfo,
  MessageType.GetRecordChoices,
  ...MAPPING_MESSAGES,
]);

/** Records to choose from when assigning: current position, summary, and id (extension only). */
function recordChoicesView(profile: Profile): RecordChoicesByCollection {
  const choices = recordChoices(profile);
  return Object.fromEntries(
    PROFILE_RECORD_COLLECTIONS.map((collection) => [
      collection,
      choices[collection].map(({ recordId, index, summary }) => ({
        recordId,
        label: `${PROFILE_RECORD_COLLECTION_DEFINITIONS[collection].itemLabel} ${index + 1}`,
        summary,
      })),
    ]),
  ) as unknown as RecordChoicesByCollection;
}

/**
 * The deterministic mapping, then the user's record assignments for this page. An
 * assignment applies only to the same field (id and metadata, including how often its
 * question repeats) on the same page; if its record was deleted it is "unavailable".
 */
function mapWithAssignments(
  fields: readonly FormField[],
  { profile, lookup, assignments }: MappingContext,
  page: string | undefined,
  transient?: ReadonlyMap<string, string>,
): FieldMapping[] {
  const mappings = mapFields(fields, matcher, lookup).mappings;
  if (!page) return mappings;
  return applyRecordAssignments(fields, mappings, (field) => {
    // An unsaved assignment is accepted only for a field without a unique identity.
    const unsaved = field.identity?.unique === true ? undefined : transient?.get(field.id);
    const target = unsaved ?? findAssignment(assignments, page, field)?.target;
    if (!target) return undefined;
    const record = resolveProfileTarget(target)?.record;
    if (record?.recordId === undefined || !isRecordIdTarget(target)) return 'unavailable';
    return recordIndexById(profile, record.collection, record.recordId) >= 0
      ? target
      : 'unavailable';
  });
}

/** Field ids taken from the page's own attributes (not positional ones like "index:3" or "~2"). */
const ATTRIBUTE_FIELD_ID = /^(?:id|name|key):[^~]+$/;

/**
 * The saved assignment for this field on this page. Saved assignments match by the field's
 * semantic identity, and only when that identity is unique on the page now (two fields with
 * the same identity get neither). Assignments saved before identities existed (version 1)
 * match only a uniquely identifiable field whose id comes from its own attributes.
 */
function findAssignment(
  assignments: readonly RecordAssignment[],
  page: string,
  field: FormField,
): RecordAssignment | undefined {
  const { identity } = field;
  if (identity?.unique !== true) return undefined;
  const samePage = assignments.filter((a) => a.page === page);
  return (
    samePage.find(
      (a) => a.identityKey === identity.key && isSameAssignedField(a.field, field, true),
    ) ??
    samePage.find(
      (a) =>
        a.identityKey === undefined &&
        a.fieldId === field.id &&
        ATTRIBUTE_FIELD_ID.test(field.id) &&
        isSameAssignedField(a.field, field),
    )
  );
}

/** An assignment the user may make: a repeated field without record context, an existing record. */
function isValidAssignment(field: FormField, target: string, context: MappingContext): boolean {
  const [mapping] = mapFields([field], matcher, context.lookup).mappings;
  const definition = resolveProfileTarget(target);
  const record = definition?.record;
  return (
    mapping !== undefined &&
    isAssignableField(field, mapping) &&
    isRecordIdTarget(target) &&
    definition?.fieldTypes.includes(field.type) === true &&
    record?.recordId !== undefined &&
    recordIndexById(context.profile, record.collection, record.recordId) >= 0
  );
}

/** A stored assignment as the management view shows it: labels only, never ids or values. */
function assignmentView(assignment: RecordAssignment, profile: Profile): AssignmentView {
  const url = new URL(assignment.page);
  const definition = resolveProfileTarget(assignment.target);
  const record = definition?.record;
  const index =
    record?.recordId !== undefined
      ? recordIndexById(profile, record.collection, record.recordId)
      : -1;
  const fieldLabel = definition?.label.split(' → ').at(-1) ?? '';
  return {
    handle: {
      page: assignment.page,
      fieldId: assignment.fieldId,
      ...(assignment.identityKey ? { identityKey: assignment.identityKey } : {}),
    },
    site: url.hostname,
    path: url.pathname,
    question: assignment.field.label ?? 'Unlabeled field',
    controlType: assignment.field.type,
    target:
      record && index >= 0
        ? `${PROFILE_RECORD_COLLECTION_DEFINITIONS[record.collection].itemLabel} ${index + 1} · ${fieldLabel}`
        : `${record ? PROFILE_RECORD_COLLECTION_DEFINITIONS[record.collection].itemLabel : 'Record'} · ${fieldLabel}`,
    available: index >= 0,
    kind: assignment.identityKey ? 'identity' : 'legacy',
  };
}

/** "Education 2 → Degree" for a record id target, from the record's current position. */
function assignedTargetLabel(profile: Profile, mapping: FieldMapping): string | undefined {
  if (mapping.source !== 'assigned' || !mapping.profileField) return undefined;
  const definition = resolveProfileTarget(mapping.profileField);
  const record = definition?.record;
  if (!definition || record?.recordId === undefined) return undefined;
  const index = recordIndexById(profile, record.collection, record.recordId);
  const collection: ProfileRecordCollection = record.collection;
  const fieldLabel = definition.label.split(' → ').at(-1) ?? '';
  return `${PROFILE_RECORD_COLLECTION_DEFINITIONS[collection].itemLabel} ${index + 1} → ${fieldLabel}`;
}

/** Record counts for the Teach Once selector; never record values. */
function recordCounts(profile: Profile): ProfileRecordCounts {
  return Object.fromEntries(
    PROFILE_RECORD_COLLECTIONS.map((collection) => [collection, recordCount(profile, collection)]),
  ) as ProfileRecordCounts;
}

/** Mappings for review: saved mappings first, then the matcher; values reduced to hasValue. */
function reviewMappings(
  fields: readonly FormField[],
  context: MappingContext,
  page?: string,
  transient?: ReadonlyMap<string, string>,
): ReviewedMapping[] {
  const { profile } = context;
  return mapWithAssignments(fields, context, page, transient).map((mapping, index) => {
    const targetLabel = assignedTargetLabel(profile, mapping);
    const unsaved = mapping.source === 'assigned' && transient?.has(fields[index]?.id ?? '');
    return {
      ...mapping,
      ...(unsaved ? { transient: true } : {}),
      hasValue:
        mapping.profileField !== undefined &&
        getProfileValue(profile, mapping.profileField) !== undefined,
      ...(targetLabel ? { targetLabel } : {}),
    };
  });
}

/**
 * Turns approvals into fill instructions, sends only those to the page, and returns one
 * result per approval, in order. Approvals that fail a check here never reach the page:
 *
 * 1. the approval against the current saved mappings, assignments, and profile
 *    (prepareInstruction: a deleted or changed mapping or assignment is refused, and the
 *    value is looked up now, never cached from Analyze);
 * 2. the field against a fresh scan of the page: it must still exist with the identity it had
 *    at Analyze (same question, section, form, name, type…). This is where fingerprints are
 *    compared, so they never travel to the page;
 * 3. then the page re-checks name, id, question, type, record, repetition, and state itself
 *    right before filling.
 */
async function fillApproved(
  tabId: number,
  approvals: readonly FieldApproval[],
  context: MappingContext,
  { fillInTab, scanTab }: { fillInTab: FillInTab; scanTab: ScanTab },
  page?: string,
): Promise<FillResult[]> {
  const results: FillResult[] = [];
  const prepared: { index: number; field: FormField; instruction: FillInstruction }[] = [];

  approvals.forEach((approval, index) => {
    const outcome = prepareInstruction(approval, context, page);
    if ('status' in outcome) results[index] = outcome;
    else prepared.push({ index, field: approval.field, instruction: outcome });
  });

  const instructions: FillInstruction[] = [];
  const instructionSlots: number[] = [];
  if (prepared.length > 0) {
    const current = await scanTab(tabId);
    const byId = Array.isArray(current) ? new Map(current.map((f) => [f.id, f])) : undefined;
    for (const { index, field, instruction } of prepared) {
      const now = byId?.get(field.id);
      if (current === undefined) results[index] = pageDidNotRespond(field.id);
      else if (current === 'unreadable') {
        results[index] = {
          fieldId: field.id,
          status: 'unsupported',
          message: 'ApplyOnce cannot read this page safely now. Analyze it again.',
        };
      } else if (!now) {
        results[index] = {
          fieldId: field.id,
          status: 'not-found',
          message: 'The field is no longer on the page.',
        };
      } else if (!sameIdentity(field, now)) {
        results[index] = {
          fieldId: field.id,
          status: 'skipped',
          message: 'This field changed since Analyze. Analyze the page again.',
        };
      } else {
        instructions.push(instruction);
        instructionSlots.push(index);
      }
    }
  }

  if (instructions.length > 0) {
    const pageResults = await fillInTab(tabId, instructions);
    instructions.forEach((instruction, i) => {
      const pageResult = pageResults?.[i];
      results[instructionSlots[i] ?? i] =
        pageResult?.fieldId === instruction.fieldId && isPlausibleResult(pageResult)
          ? { fieldId: pageResult.fieldId, status: pageResult.status, message: pageResult.message }
          : pageDidNotRespond(instruction.fieldId);
    });
  }
  return results;
}

const FILL_STATUSES: ReadonlySet<string> = new Set([
  'filled',
  'skipped',
  'failed',
  'not-found',
  'unsupported',
]);

/**
 * A result from the page's process is shown to the user only if it is a known status with a
 * short message (the engines' messages are one or two sentences); anything else is treated
 * as no answer, so a compromised content script cannot put arbitrary text in the popup.
 */
function isPlausibleResult(result: FillResult): boolean {
  return (
    FILL_STATUSES.has(result.status) &&
    typeof result.message === 'string' &&
    result.message.length <= 300
  );
}

const pageDidNotRespond = (fieldId: string): FillResult => ({
  fieldId,
  status: 'failed',
  message: 'The page did not respond. Analyze it again.',
});

/** The field on the page now is the one approved: same fingerprint, same uniqueness. */
function sameIdentity(approved: FormField, current: FormField): boolean {
  return (
    approved.identity?.key === current.identity?.key &&
    approved.identity?.unique === current.identity?.unique
  );
}

/**
 * Re-checks an approval against the current mapping (saved mappings first, then the
 * deterministic matcher), so only fields mapped as mapped, review, or taught can be
 * filled, and only from that profile field.
 */
function prepareInstruction(
  { field, profileField, transient }: FieldApproval,
  context: MappingContext,
  page: string | undefined,
): FillInstruction | FillResult {
  const { profile } = context;
  const fieldId = field.id;
  const target = resolveProfileTarget(profileField);
  if (!target) {
    return {
      fieldId,
      status: 'failed',
      message: 'This field can no longer be filled from your profile. Analyze the page again.',
    };
  }
  if (!target.fieldTypes.includes(field.type)) {
    return { fieldId, status: 'unsupported', message: 'This field cannot hold that value.' };
  }
  // An unsaved assignment (identical copies) travels with its approval and is re-checked here.
  const unsaved =
    transient === true &&
    field.identity?.unique !== true &&
    isValidAssignment(field, profileField, context)
      ? new Map([[field.id, profileField]])
      : undefined;
  const [mapping] = mapWithAssignments([field], context, page, unsaved);
  const approvable =
    mapping?.status === 'mapped' ||
    mapping?.status === 'review' ||
    mapping?.status === 'taught' ||
    mapping?.status === 'assigned';
  if (!approvable || mapping.profileField !== target.target) {
    return {
      fieldId,
      status: 'failed',
      message: 'The match for this field changed since Analyze. Analyze the page again.',
    };
  }
  const value = getProfileValue(profile, target.target);
  if (value === undefined) {
    return { fieldId, status: 'skipped', message: 'Your profile has no value for this field.' };
  }
  const { name, htmlId, label } = field.signals;
  const record = field.record && { collection: field.record.collection, index: field.record.index };
  // An assigned repeated field carries only its repeat count to the page (never the record
  // or the fingerprint), and the page refuses the fill if it changed.
  const assigned = mapping.status === 'assigned';
  const repeatedCount = assigned ? field.repeatedCount : undefined;
  return {
    fieldId,
    value,
    expected: {
      type: field.type,
      name,
      htmlId,
      label,
      ...(record ? { record } : {}),
      ...(repeatedCount ? { repeatedCount } : {}),
    },
  };
}
