import type { AdapterContext, DetectionStrength, PlatformDetection } from '@applyonce/core';
import { isOneOfHosts, pageHostname, visibleElements } from '@applyonce/adapter-generic';
import {
  APPLICATION_FORM,
  CUSTOM_QUESTION_ID,
  GREENHOUSE_HOSTS,
  QUESTIONS_SECTION,
  REACT_SELECT,
} from './selectors';

export interface GreenhouseDetection extends PlatformDetection {
  /** "greenhouse" for host or structure evidence; weak evidence stays generic. */
  platform: 'greenhouse' | 'generic';
}

/**
 * Deterministic Greenhouse detection.
 *
 * - host: exactly a Greenhouse job-board hostname (not any *.greenhouse.io page, such as the
 *   company's marketing site, and never a look-alike).
 * - structure: exactly one rendered `form#application-form` holding a rendered question
 *   section and at least one rendered Greenhouse question control (a "question_<n>" id or
 *   a react-select input).
 * - weak: a partial or duplicated structure (e.g. the form id without Greenhouse questions,
 *   or two application forms).
 *
 * The word "Greenhouse" in page text, a lone class name, and hidden markup are never
 * evidence; anything below structure stays with the generic adapter.
 */
export function detectGreenhouse({ url, root }: AdapterContext<ParentNode>): GreenhouseDetection {
  const evidence: string[] = [];
  let strength: DetectionStrength = 'none';

  const hostname = pageHostname(url);
  if (isOneOfHosts(hostname, GREENHOUSE_HOSTS)) {
    evidence.push(`Greenhouse host ${hostname}`);
    strength = 'host';
  }

  const forms = visibleElements(root, APPLICATION_FORM).filter(isGreenhouseForm);
  if (forms.length === 1) {
    evidence.push('Greenhouse application form');
    if (strength !== 'host') strength = 'structure';
  } else if (forms.length > 1) {
    evidence.push('several Greenhouse application forms');
    if (strength === 'none') strength = 'weak';
  } else if (visibleElements(root, APPLICATION_FORM).length > 0 && strength === 'none') {
    evidence.push('application form without Greenhouse questions');
    strength = 'weak';
  }
  const platform = strength === 'host' || strength === 'structure' ? 'greenhouse' : 'generic';
  return { platform, strength, evidence };
}

function isGreenhouseForm(form: Element): boolean {
  if (visibleElements(form, QUESTIONS_SECTION).length === 0) return false;
  const questionIds = visibleElements(form, '[id]').some((el) => CUSTOM_QUESTION_ID.test(el.id));
  return questionIds || visibleElements(form, REACT_SELECT.input).length > 0;
}
