import {
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

export interface ServiceWorkerMessageHandlerOptions {
  repository: ProfileRepository;
  mappings: SavedMappingRepository;
  /** Explicit record assignments for repeated fields. */
  assignments: RecordAssignmentRepository;
  /** e.g. "chrome-extension://<id>/", from chrome.runtime.getURL(''). */
  extensionOrigin: string;
  fillInTab: FillInTab;
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
}: ServiceWorkerMessageHandlerOptions) {
  // Content scripts share a process with the web page. They may only ask for the profile
  // status; everything else about the profile or saved mappings is extension-only.
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

    if (message.type !== MessageType.GetProfileStatus && !isExtensionPage(sender)) {
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
            results: await fillApproved(tabId, approvals, await loadContext(), fillInTab, page),
          });
        }

        case MessageType.SaveAssignment: {
          const { page, field, target } = message.payload;
          const context = await loadContext();
          const [mapping] = mapFields([field], matcher, context.lookup).mappings;
          const definition = resolveProfileTarget(target);
          const record = definition?.record;
          const recordExists =
            record?.recordId !== undefined &&
            recordIndexById(context.profile, record.collection, record.recordId) >= 0;
          if (!mapping || !isAssignableField(field, mapping) || !recordExists) {
            return fail('invalid-mapping');
          }
          const saved = await recordAssignments.save({ page, field, target });
          if (!saved.ok) return fail('invalid-mapping');
          // Assigning never fills: the updated mapping goes back for review only.
          const [reviewed] = reviewMappings([field], await loadContext(), page);
          return reviewed ? ok({ mapping: reviewed }) : fail('internal-error');
        }

        case MessageType.DeleteAssignment: {
          const { page, field } = message.payload;
          await recordAssignments.delete(page, field.id);
          const [reviewed] = reviewMappings([field], await loadContext(), page);
          return reviewed ? ok({ mapping: reviewed }) : fail('internal-error');
        }

        case MessageType.GetRecordChoices:
          return ok({ records: recordChoicesView(await repository.load()) });

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
): FieldMapping[] {
  const mappings = mapFields(fields, matcher, lookup).mappings;
  if (!page) return mappings;
  return applyRecordAssignments(fields, mappings, (field) => {
    const assignment = assignments.find(
      (a) => a.page === page && a.fieldId === field.id && isSameAssignedField(a.field, field),
    );
    if (!assignment) return undefined;
    const record = resolveProfileTarget(assignment.target)?.record;
    if (record?.recordId === undefined) return 'unavailable';
    return recordIndexById(profile, record.collection, record.recordId) >= 0
      ? assignment.target
      : 'unavailable';
  });
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
): ReviewedMapping[] {
  const { profile } = context;
  return mapWithAssignments(fields, context, page).map((mapping) => {
    const targetLabel = assignedTargetLabel(profile, mapping);
    return {
      ...mapping,
      hasValue:
        mapping.profileField !== undefined &&
        getProfileValue(profile, mapping.profileField) !== undefined,
      ...(targetLabel ? { targetLabel } : {}),
    };
  });
}

/**
 * Turns approvals into fill instructions, sends only those to the page, and returns one
 * result per approval, in order. Approvals that fail a check here never reach the page.
 */
async function fillApproved(
  tabId: number,
  approvals: readonly FieldApproval[],
  context: MappingContext,
  fillInTab: FillInTab,
  page?: string,
): Promise<FillResult[]> {
  const results: FillResult[] = [];
  const instructions: FillInstruction[] = [];
  const instructionSlots: number[] = [];

  approvals.forEach((approval, index) => {
    const prepared = prepareInstruction(approval, context, page);
    if ('status' in prepared) {
      results[index] = prepared;
    } else {
      instructions.push(prepared);
      instructionSlots.push(index);
    }
  });

  if (instructions.length > 0) {
    const pageResults = await fillInTab(tabId, instructions);
    instructions.forEach((instruction, i) => {
      const pageResult = pageResults?.[i];
      results[instructionSlots[i] ?? i] =
        pageResult?.fieldId === instruction.fieldId
          ? pageResult
          : {
              fieldId: instruction.fieldId,
              status: 'failed',
              message: 'The page did not respond. Analyze it again.',
            };
    });
  }
  return results;
}

/**
 * Re-checks an approval against the current mapping (saved mappings first, then the
 * deterministic matcher), so only fields mapped as mapped, review, or taught can be
 * filled, and only from that profile field.
 */
function prepareInstruction(
  { field, profileField }: FieldApproval,
  context: MappingContext,
  page: string | undefined,
): FillInstruction | FillResult {
  const { profile } = context;
  const fieldId = field.id;
  const target = resolveProfileTarget(profileField);
  if (!target) {
    return { fieldId, status: 'failed', message: 'Invalid mapping.' };
  }
  if (!target.fieldTypes.includes(field.type)) {
    return { fieldId, status: 'unsupported', message: 'This field cannot hold that value.' };
  }
  const [mapping] = mapWithAssignments([field], context, page);
  const approvable =
    mapping?.status === 'mapped' ||
    mapping?.status === 'review' ||
    mapping?.status === 'taught' ||
    mapping?.status === 'assigned';
  if (!approvable || mapping.profileField !== target.target) {
    return { fieldId, status: 'failed', message: 'This field does not match that profile field.' };
  }
  const value = getProfileValue(profile, target.target);
  if (value === undefined) {
    return { fieldId, status: 'skipped', message: 'Your profile has no value for this field.' };
  }
  const { name, htmlId, label } = field.signals;
  const record = field.record && { collection: field.record.collection, index: field.record.index };
  // An assigned repeated field carries only its repeat count to the page (never the record).
  const repeatedCount = mapping.status === 'assigned' ? field.repeatedCount : undefined;
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
