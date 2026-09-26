/**
 * Content script: inspects the page on request. Injected on demand by the popup
 * (activeTab + scripting) only after the user clicks "Analyze this page"; never declared
 * in the manifest.
 *
 * It keeps no state between messages and never observes DOM changes. It never receives
 * the profile: only the profile status, and, when the user clicks Fill, the approved
 * field/value pairs. It changes the page only by filling those fields, and never submits.
 */
import { genericAdapter } from '@applyonce/adapter-generic';
import { greenhouseAdapter } from '@applyonce/adapter-greenhouse';
import { workdayAdapter } from '@applyonce/adapter-workday';
import { selectAdapter } from '@applyonce/core';
import { logFailure } from '../log-failure';
import { fail, MessageType, ok, parseMessage, type PageScan } from '../messaging/protocol';
import { sendToServiceWorker } from '../messaging/send';

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];

const SITE_ADAPTERS = [workdayAdapter, greenhouseAdapter];

// TODO(phase-4/5): use the site adapter once Workday/Greenhouse extraction and filling
// exist. Until then the generic adapter scans and fills on every page.
const pageContext = () => ({ url: window.location.href, root: document });

async function scanPage(): Promise<PageScan> {
  const context = pageContext();
  const platform = selectAdapter(SITE_ADAPTERS, genericAdapter, context).id;
  const fields = genericAdapter.getFields(context);
  const status = await sendToServiceWorker(MessageType.GetProfileStatus);
  return {
    title: document.title,
    platform,
    fields,
    profileStatus: status.ok ? status.data : null,
  };
}

const listener: Listener = (rawMessage: unknown, _sender, sendResponse) => {
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
      scanPage().then(
        (scan) => sendResponse(ok(scan)),
        (error: unknown) => {
          logFailure('page scan', error);
          sendResponse(fail('internal-error'));
        },
      );
      return true; // Async response.
    case MessageType.FillFields:
      sendResponse(
        ok({ results: genericAdapter.fillFields(pageContext(), message.payload.instructions) }),
      );
      return false;
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
