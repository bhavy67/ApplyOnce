/**
 * Background service worker: the only context that reads the profile for others (content
 * scripts cannot open the extension's IndexedDB). MV3 can stop it at any time, so it
 * keeps no state in memory beyond the lazily opened database connection.
 */
import { isFillResultList, isPageScan, MessageType } from '../messaging/protocol';
import { isBoundedArray, isFormField } from '../messaging/validate';
import { sendToTab } from '../messaging/send';
import {
  createBrowserProfileRepository,
  createBrowserRecordAssignmentRepository,
  createBrowserSavedMappingRepository,
} from '../storage';
import { createServiceWorkerMessageHandler } from './message-handler';

const handleMessage = createServiceWorkerMessageHandler({
  repository: createBrowserProfileRepository(),
  mappings: createBrowserSavedMappingRepository(),
  assignments: createBrowserRecordAssignmentRepository(),
  extensionOrigin: chrome.runtime.getURL(''),
  fillInTab: async (tabId, instructions) => {
    const response = await sendToTab(tabId, MessageType.FillFields, { instructions });
    return response.ok && isFillResultList(response.data.results)
      ? response.data.results
      : undefined;
  },
  // The same scan as Analyze, run right before filling so the approved fields can be
  // checked against the page as it is now. The answer comes from the page's process, so it
  // is validated like any other message.
  scanTab: async (tabId) => {
    const response = await sendToTab(tabId, MessageType.ScanPage);
    if (!response.ok || !isPageScan(response.data)) return undefined;
    if (response.data.unsupported) return 'unreadable';
    const { fields } = response.data;
    return isBoundedArray(fields) && fields.every(isFormField) ? fields : undefined;
  },
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse);
  return true; // Keeps the channel open for the async response.
});
