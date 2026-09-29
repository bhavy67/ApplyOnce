export {
  arrowDown,
  clickSequence,
  closePopup,
  DEFAULT_CUSTOM_CONTROL_TIMING,
  fillCustomSelect,
  findListbox,
  isNavigationAction,
  isSubmitter,
  readOptions,
  sameText,
  waitUntil,
  type CustomControlTiming,
  type CustomOption,
  type CustomSelectOptions,
} from './custom-select';
export * from './fill-outcome';
export {
  fillFields,
  findMatchingOption,
  setValueWithNativeSetter,
  toBoolean,
  type CustomFiller,
  type FillOptions,
} from './fill-fields';
export { isGeneratedId, markFieldIdentity } from './field-identity';
export { genericAdapter } from './generic-adapter';
export { scanControls, scanFields, type ScannedField, type ScanOptions } from './scan-fields';
export {
  isOneOfHosts,
  isSubdomainOf,
  pageHostname,
  PlatformScanError,
  singleScope,
  visibleElements,
} from './platform-evidence';
