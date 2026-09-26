import { PROFILE_FIELDS, type FillInstruction, type FillResult } from '@applyonce/core';
import { createAliasMatcher, mapFields } from '@applyonce/field-mapper';
import {
  countProfileValues,
  getProfileValue,
  isProfileFieldKey,
  type Profile,
} from '@applyonce/profile';
import { logFailure } from '../log-failure';
import {
  fail,
  MessageType,
  ok,
  parseMessage,
  type FieldApproval,
  type MessageResult,
  type ReviewedMapping,
} from '../messaging/protocol';
import type { ProfileRepository } from '../storage';

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
  /** e.g. "chrome-extension://<id>/", from chrome.runtime.getURL(''). */
  extensionOrigin: string;
  fillInTab: FillInTab;
}

const matcher = createAliasMatcher();

/**
 * Handles messages addressed to the service worker, the only context that reads the
 * profile for other contexts. Never throws: every outcome is a MessageResult.
 */
export function createServiceWorkerMessageHandler({
  repository,
  extensionOrigin,
  fillInTab,
}: ServiceWorkerMessageHandlerOptions) {
  // Content scripts share a process with the web page; they get the status only.
  const isExtensionPage = (sender: Sender) => sender.url?.startsWith(extensionOrigin) === true;

  return async function handleMessage(
    rawMessage: unknown,
    sender: Sender,
  ): Promise<MessageResult<unknown>> {
    const parsed = parseMessage(rawMessage);
    if (!parsed.ok) return parsed;
    const message = parsed.data;

    try {
      switch (message.type) {
        case MessageType.GetProfile:
          if (!isExtensionPage(sender)) return fail('forbidden');
          return ok(await repository.load());

        case MessageType.GetProfileStatus: {
          const valueCount = countProfileValues(await repository.load());
          return ok({ hasData: valueCount > 0, valueCount });
        }

        case MessageType.MapFields: {
          if (!isExtensionPage(sender)) return fail('forbidden');
          const profile = await repository.load();
          const mappings: ReviewedMapping[] = mapFields(
            message.payload.fields,
            matcher,
          ).mappings.map((mapping) => ({
            ...mapping,
            hasValue:
              mapping.profileField !== undefined &&
              getProfileValue(profile, mapping.profileField) !== undefined,
          }));
          return ok({ mappings });
        }

        case MessageType.FillPage: {
          if (!isExtensionPage(sender)) return fail('forbidden');
          const { tabId, approvals } = message.payload;
          const results = await fillApproved(tabId, approvals, await repository.load(), fillInTab);
          return ok({ results });
        }

        default:
          return fail('unknown-message');
      }
    } catch (error) {
      logFailure(`service worker ${message.type}`, error);
      return fail('profile-unavailable');
    }
  };
}

/**
 * Turns approvals into fill instructions, sends only those to the page, and returns one
 * result per approval, in order. Approvals that fail a check here never reach the page.
 */
async function fillApproved(
  tabId: number,
  approvals: readonly FieldApproval[],
  profile: Profile,
  fillInTab: FillInTab,
): Promise<FillResult[]> {
  const results: FillResult[] = [];
  const instructions: FillInstruction[] = [];
  const instructionSlots: number[] = [];

  approvals.forEach((approval, index) => {
    const prepared = prepareInstruction(approval, profile);
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
 * Re-checks an approval against the deterministic mapper, so only fields it matched (as
 * mapped or review) can be filled, and only from that profile field.
 */
function prepareInstruction(
  { field, profileField }: FieldApproval,
  profile: Profile,
): FillInstruction | FillResult {
  const fieldId = field.id;
  if (!isProfileFieldKey(profileField)) {
    return { fieldId, status: 'failed', message: 'Invalid mapping.' };
  }
  if (!PROFILE_FIELDS[profileField].fieldTypes.includes(field.type)) {
    return { fieldId, status: 'unsupported', message: 'This field cannot hold that value.' };
  }
  const [mapping] = mapFields([field], matcher).mappings;
  const approvable = mapping?.status === 'mapped' || mapping?.status === 'review';
  if (!approvable || mapping.profileField !== profileField) {
    return { fieldId, status: 'failed', message: 'This field does not match that profile field.' };
  }
  const value = getProfileValue(profile, profileField);
  if (value === undefined) {
    return { fieldId, status: 'skipped', message: 'Your profile has no value for this field.' };
  }
  const { name, htmlId, label } = field.signals;
  return { fieldId, value, expected: { type: field.type, name, htmlId, label } };
}
