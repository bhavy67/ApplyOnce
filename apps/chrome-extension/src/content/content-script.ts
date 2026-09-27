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

/** Site adapters that scan and fill; others (the Greenhouse stub) only report the platform. */
const WORKING_ADAPTERS: ReadonlySet<string> = new Set([workdayAdapter.id]);

const pageContext = () => ({ url: window.location.href, root: document });

/**
 * The platform (for display) and the adapter that scans and fills. A detected site
 * adapter is used only once it is implemented; the generic adapter is always the fallback.
 */
function resolveAdapter(context: ReturnType<typeof pageContext>) {
  const detected = selectAdapter(SITE_ADAPTERS, genericAdapter, context);
  return {
    platform: detected.id,
    adapter: WORKING_ADAPTERS.has(detected.id) ? detected : genericAdapter,
  };
}

async function scanPage(): Promise<PageScan> {
  const context = pageContext();
  const { platform, adapter } = resolveAdapter(context);
  const fields = adapter.getFields(context);
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
      resolveAdapter(pageContext())
        .adapter.fillFields(pageContext(), message.payload.instructions)
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
