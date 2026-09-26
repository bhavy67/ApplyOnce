/**
 * Background service worker: owns profile access for contexts that cannot open the
 * extension's IndexedDB themselves (content scripts). MV3 can stop it at any time, so it
 * keeps no state in memory beyond the lazily opened database connection.
 */
import { createBrowserProfileRepository } from '../storage';
import { createServiceWorkerMessageHandler } from './message-handler';

const handleMessage = createServiceWorkerMessageHandler({
  repository: createBrowserProfileRepository(),
  extensionOrigin: chrome.runtime.getURL(''),
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse);
  return true; // Keeps the channel open for the async response.
});
