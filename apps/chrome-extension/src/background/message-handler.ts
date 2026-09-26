import { countProfileValues } from '@applyonce/profile';
import { logFailure } from '../log-failure';
import { fail, MessageType, ok, parseMessage, type MessageResult } from '../messaging/protocol';
import type { ProfileRepository } from '../storage';

/** The parts of chrome.runtime.MessageSender the handler relies on. */
export interface Sender {
  url?: string;
}

export interface ServiceWorkerMessageHandlerOptions {
  repository: ProfileRepository;
  /** e.g. "chrome-extension://<id>/", from chrome.runtime.getURL(''). */
  extensionOrigin: string;
}

/**
 * Handles messages addressed to the service worker, the only context that reads the
 * profile for other contexts. Never throws: every outcome is a MessageResult.
 */
export function createServiceWorkerMessageHandler({
  repository,
  extensionOrigin,
}: ServiceWorkerMessageHandlerOptions) {
  return async function handleMessage(
    message: unknown,
    sender: Sender,
  ): Promise<MessageResult<unknown>> {
    const parsed = parseMessage(message);
    if (!parsed.ok) return parsed;

    try {
      switch (parsed.data.type) {
        case MessageType.GetProfile:
          // Content scripts share a process with the web page; they only get the status.
          if (!sender.url?.startsWith(extensionOrigin)) return fail('forbidden');
          return ok(await repository.load());

        case MessageType.GetProfileStatus: {
          const valueCount = countProfileValues(await repository.load());
          return ok({ hasData: valueCount > 0, valueCount });
        }

        default:
          return fail('unknown-message');
      }
    } catch (error) {
      logFailure(`service worker ${parsed.data.type}`, error);
      return fail('profile-unavailable');
    }
  };
}
