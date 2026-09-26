/**
 * Messages between extension contexts (popup, service worker, content script).
 * Messages stay inside the extension; nothing is sent to external services.
 */
export interface DetectAdapterMessage {
  type: 'applyonce/detect-adapter';
}

export interface DetectAdapterResponse {
  adapterId: string;
}

export function isDetectAdapterMessage(value: unknown): value is DetectAdapterMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'applyonce/detect-adapter'
  );
}
