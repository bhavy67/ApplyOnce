import {
  PROFILE_RECORD_COLLECTIONS,
  resolveProfileTarget,
  type FillInstruction,
  type FillResult,
  type FormField,
} from '@applyonce/core';
import {
  createAliasMatcher,
  createMappingKeyParts,
  mapFields,
  type SavedMappingLookup,
} from '@applyonce/field-mapper';
import { countProfileValues, getProfileValue, recordCount, type Profile } from '@applyonce/profile';
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
  type ReviewedMapping,
} from '../messaging/protocol';
import type { ProfileRepository, SavedMappingRepository } from '../storage';

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
]);

interface MappingContext {
  profile: Profile;
  lookup: SavedMappingLookup;
}

/**
 * Handles messages addressed to the service worker: the only context that reads the
 * profile for other contexts, and the only writer of saved mappings. Never throws: every
 * outcome is a MessageResult.
 */
export function createServiceWorkerMessageHandler({
  repository,
  mappings: savedMappings,
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
    try {
      const saved = await savedMappings.list();
      return { profile, lookup: new Map(saved.map((mapping) => [mapping.key, mapping])) };
    } catch (error) {
      logFailure('saved mappings load', error);
      return { profile, lookup: new Map() };
    }
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
          const context = await loadContext();
          return ok({
            mappings: reviewMappings(message.payload.fields, context),
            records: recordCounts(context.profile),
          });
        }

        case MessageType.FillPage: {
          const { tabId, approvals } = message.payload;
          return ok({
            results: await fillApproved(tabId, approvals, await loadContext(), fillInTab),
          });
        }

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
  ...MAPPING_MESSAGES,
]);

/** Record counts for the Teach Once selector; never record values. */
function recordCounts(profile: Profile): ProfileRecordCounts {
  return Object.fromEntries(
    PROFILE_RECORD_COLLECTIONS.map((collection) => [collection, recordCount(profile, collection)]),
  ) as ProfileRecordCounts;
}

/** Mappings for review: saved mappings first, then the matcher; values reduced to hasValue. */
function reviewMappings(
  fields: readonly FormField[],
  { profile, lookup }: MappingContext,
): ReviewedMapping[] {
  return mapFields(fields, matcher, lookup).mappings.map((mapping) => ({
    ...mapping,
    hasValue:
      mapping.profileField !== undefined &&
      getProfileValue(profile, mapping.profileField) !== undefined,
  }));
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
): Promise<FillResult[]> {
  const results: FillResult[] = [];
  const instructions: FillInstruction[] = [];
  const instructionSlots: number[] = [];

  approvals.forEach((approval, index) => {
    const prepared = prepareInstruction(approval, context);
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
  { profile, lookup }: MappingContext,
): FillInstruction | FillResult {
  const fieldId = field.id;
  const target = resolveProfileTarget(profileField);
  if (!target) {
    return { fieldId, status: 'failed', message: 'Invalid mapping.' };
  }
  if (!target.fieldTypes.includes(field.type)) {
    return { fieldId, status: 'unsupported', message: 'This field cannot hold that value.' };
  }
  const [mapping] = mapFields([field], matcher, lookup).mappings;
  const approvable =
    mapping?.status === 'mapped' || mapping?.status === 'review' || mapping?.status === 'taught';
  if (!approvable || mapping.profileField !== target.target) {
    return { fieldId, status: 'failed', message: 'This field does not match that profile field.' };
  }
  const value = getProfileValue(profile, target.target);
  if (value === undefined) {
    return { fieldId, status: 'skipped', message: 'Your profile has no value for this field.' };
  }
  const { name, htmlId, label } = field.signals;
  return { fieldId, value, expected: { type: field.type, name, htmlId, label } };
}
