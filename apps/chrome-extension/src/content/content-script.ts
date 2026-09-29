/**
 * Content script: inspects the page on request. Injected on demand by the popup
 * (activeTab + scripting) only after the user clicks "Analyze this page"; never declared
 * in the manifest.
 *
 * It keeps no state between messages and never observes DOM changes. It never receives
 * the profile and never asks the service worker for anything: it only answers scan requests
 * (from the popup, and from the service worker right before filling) and, when the user
 * clicks Fill, fills the approved field/value pairs. It changes the page only by filling
 * those fields, and never submits.
 */
import { logFailure } from '../log-failure';
import { fail, MessageType, ok, parseMessage, type PageScan } from '../messaging/protocol';
import { resolvePageAdapter } from './adapters';

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];

const pageContext = () => ({ url: window.location.href, root: document });

/**
 * Resolved again for every message, so Analyze and Fill use the same rules on the page as
 * it is now.
 */
const resolveAdapter = (context: ReturnType<typeof pageContext>) =>
  resolvePageAdapter(context).adapter;

function scanPage(): PageScan {
  const context = pageContext();
  const adapter = resolveAdapter(context);
  let fields: PageScan['fields'] = [];
  let unsupported = false;
  try {
    fields = adapter.getFields(context);
  } catch (error) {
    // The selected adapter cannot read this page safely. It is reported as unsupported,
    // never re-read with another adapter (which could produce conflicting fields).
    logFailure(`${adapter.id} scan`, error);
    unsupported = true;
  }
  return {
    title: document.title,
    platform: adapter.id,
    fields,
    ...(unsupported ? { unsupported: true } : {}),
  };
}

const listener: Listener = (rawMessage: unknown, sender, sendResponse) => {
  // Only this extension (popup, service worker) talks to the content script.
  if (sender.id !== chrome.runtime.id) {
    sendResponse(fail('forbidden'));
    return false;
  }
  const parsed = parseMessage(rawMessage);
  if (!parsed.ok) {
    sendResponse(parsed);
    return false;
  }
  const message = parsed.data;
  switch (message.type) {
    case MessageType.Ping:
      sendResponse(ok({ ready: true }));
      return false;
    case MessageType.ScanPage:
      try {
        sendResponse(ok(scanPage()));
      } catch (error) {
        logFailure('page scan', error);
        sendResponse(fail('internal-error'));
      }
      return false;
    case MessageType.FillFields:
      resolveAdapter(pageContext())
        .fillFields(pageContext(), message.payload.instructions)
        .then(
          (results) => sendResponse(ok({ results })),
          (error: unknown) => {
            logFailure('page fill', error);
            sendResponse(fail('internal-error'));
          },
        );
      return true; // Async response: custom dropdowns are filled step by step.
    default:
      sendResponse(fail('unknown-message'));
      return false;
  }
};

// Injection is idempotent: running this script again replaces the listener instead of
// adding a second one. The registry lives in the extension's isolated world, invisible to
// the page.
const registry = globalThis as typeof globalThis & { __applyOnceListener?: Listener };
if (registry.__applyOnceListener) {
  try {
    chrome.runtime.onMessage.removeListener(registry.__applyOnceListener);
  } catch {
    // The previous listener belongs to an invalidated context (extension reloaded).
  }
}
chrome.runtime.onMessage.addListener(listener);
registry.__applyOnceListener = listener;
