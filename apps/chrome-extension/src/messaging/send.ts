import {
  createMessage,
  fail,
  isMessageResult,
  type MessageType,
  type PayloadArgs,
  type ResponseFor,
} from './protocol';

/** Sends a message to the service worker (and any open extension pages). */
export async function sendToServiceWorker<T extends MessageType>(
  type: T,
  ...payload: PayloadArgs<T>
): Promise<ResponseFor<T>> {
  return deliver<T>(() => chrome.runtime.sendMessage(createMessage(type, ...payload)));
}

/** Sends a message to the content script in the tab's top frame. */
export async function sendToTab<T extends MessageType>(
  tabId: number,
  type: T,
  ...payload: PayloadArgs<T>
): Promise<ResponseFor<T>> {
  return deliver<T>(() =>
    chrome.tabs.sendMessage(tabId, createMessage(type, ...payload), { frameId: 0 }),
  );
}

async function deliver<T extends MessageType>(
  send: () => Promise<unknown>,
): Promise<ResponseFor<T>> {
  let response: unknown;
  try {
    response = await send();
  } catch {
    // Chrome rejects when no listener exists in the target context.
    return fail('no-receiver');
  }
  // Payload types are trusted once the envelope is valid: both ends are this extension.
  return isMessageResult(response) ? (response as ResponseFor<T>) : fail('malformed-response');
}
