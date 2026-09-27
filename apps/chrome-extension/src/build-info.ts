/** Replaced at build time by vite.config.ts; absent in tests and type checks. */
declare const __APPLYONCE_BUILD_ID__: string | undefined;

/**
 * Identifies one build of the extension. The popup and the service worker are compiled in
 * the same build, so they share this value; if they differ, Chrome is running a service
 * worker from an older build (it can keep one until the extension is reloaded).
 */
export const BUILD_ID: string =
  typeof __APPLYONCE_BUILD_ID__ === 'string' ? __APPLYONCE_BUILD_ID__ : 'development';
