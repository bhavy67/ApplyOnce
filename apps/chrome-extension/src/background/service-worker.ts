/**
 * Background service worker: the only context that reads the profile for others (content
 * scripts cannot open the extension's IndexedDB). MV3 can stop it at any time, so it
 * keeps no state in memory beyond the lazily opened database connection.
 */
import { isFillResultList, MessageType } from '../messaging/protocol';
import { sendToTab } from '../messaging/send';
import { createBrowserProfileRepository, createBrowserSavedMappingRepository } from '../storage';
import { createServiceWorkerMessageHandler } from './message-handler';

const handleMessage = createServiceWorkerMessageHandler({
  repository: createBrowserProfileRepository(),
  mappings: createBrowserSavedMappingRepository(),
  extensionOrigin: chrome.runtime.getURL(''),
  fillInTab: async (tabId, instructions) => {
    const response = await sendToTab(tabId, MessageType.FillFields, { instructions });
    return response.ok && isFillResultList(response.data.results)
      ? response.data.results
      : undefined;
  },
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse);
  return true; // Keeps the channel open for the async response.
});
