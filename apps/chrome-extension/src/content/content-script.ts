/**
 * Content script: runs in the page and talks to site adapters.
 *
 * It is not declared in the manifest. The plan is on-demand injection from the popup
 * (activeTab + scripting permissions, added in Phase 2), so ApplyOnce only touches a
 * page when the user asks it to, and needs no broad host permissions.
 */
import { genericAdapter } from '@applyonce/adapter-generic';
import { greenhouseAdapter } from '@applyonce/adapter-greenhouse';
import { workdayAdapter } from '@applyonce/adapter-workday';
import { selectAdapter } from '@applyonce/core';
import { isDetectAdapterMessage, type DetectAdapterResponse } from '../messages';

const SITE_ADAPTERS = [workdayAdapter, greenhouseAdapter];

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isDetectAdapterMessage(message)) return;

  const adapter = selectAdapter(SITE_ADAPTERS, genericAdapter, {
    url: window.location.href,
    root: document,
  });
  const response: DetectAdapterResponse = { adapterId: adapter.id };
  sendResponse(response);

  // TODO(phase-2): adapter.getFields → mapFields → review in popup → fill (never submit).
});
