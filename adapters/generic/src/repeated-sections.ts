import type { ProfileRecordCollection } from '@applyonce/core';
import { classifySectionHeading } from '@applyonce/field-mapper';
import { ariaLabelledByText, attributeText, textOf } from './field-text';
import type { ScannedField } from './scan-fields';

/** How far up from a control a record section may start. */
const MAX_SECTION_DEPTH = 12;

interface RecordSection {
  element: Element;
  collection: ProfileRecordCollection;
  number?: number;
}

/**
 * Marks fields that sit in one record of a repeated application section with
 * `field.record = { collection, index }` (e.g. the Institution of the second "Education"
 * block → education, 1). Deterministic and conservative:
 *
 * 1. A field's section is its nearest ancestor with a heading (a fieldset legend, an
 *    aria-labelledby/aria-label, or a heading as its first child) that names a record type
 *    ("Education 2", "Work Experience", "Certification 1"). Field order alone never counts.
 * 2. A section that contains another section of the same type is a wrapper, not a record;
 *    its own fields are left as they are.
 * 3. Only a type with at least two record sections is repeated. A single section (even one
 *    headed "Work Experience 1") keeps its fields exactly as before.
 * 4. Records are numbered by document order. If headings carry numbers, they must be exactly
 *    1, 2, 3, … in that order; otherwise the structure is ambiguous and every field in those
 *    sections is marked as a repeated question, so it is never filled.
 */
export function markRepeatedSections(scanned: ScannedField[]): ScannedField[] {
  const sectionOf = new Map<ScannedField, RecordSection>();
  const sectionsByType = new Map<ProfileRecordCollection, RecordSection[]>();
  for (const entry of scanned) {
    const [control] = entry.controls;
    const section = control && recordSectionOf(control);
    if (!section) continue;
    const known = sectionsByType.get(section.collection) ?? [];
    const existing = known.find((s) => s.element === section.element);
    if (!existing) known.push(section);
    sectionsByType.set(section.collection, known);
    sectionOf.set(entry, existing ?? section);
  }

  for (const sections of sectionsByType.values()) {
    const records = sections.filter(
      (outer) =>
        !sections.some((inner) => inner !== outer && outer.element.contains(inner.element)),
    );
    if (records.length < 2) continue;
    const numbers = records.map((s) => s.number);
    const unnumbered = numbers.every((n) => n === undefined);
    const inOrder = numbers.every((n, i) => n === i + 1);
    for (const [entry, section] of sectionOf) {
      const index = records.indexOf(section);
      if (index === -1) continue;
      if (unnumbered || inOrder) entry.field.record = { collection: section.collection, index };
      else entry.field.repeatedCount = records.length;
    }
  }
  return scanned;
}

function recordSectionOf(control: Element): RecordSection | undefined {
  let node = control.parentElement;
  for (let depth = 0; node && depth < MAX_SECTION_DEPTH; depth += 1, node = node.parentElement) {
    const heading = headingOf(node);
    const kind = heading ? classifySectionHeading(heading) : undefined;
    if (kind) return { element: node, ...kind };
  }
  return undefined;
}

/** The text that names a container, from explicit structure only. */
function headingOf(element: Element): string | undefined {
  if (element.tagName === 'FIELDSET') {
    const legend = Array.from(element.children).find((c) => c.tagName === 'LEGEND');
    if (legend) return textOf(legend);
  }
  const named = ariaLabelledByText(element) ?? attributeText(element, 'aria-label');
  if (named) return named;
  const first = element.firstElementChild;
  if (first && (/^H[1-6]$/.test(first.tagName) || first.getAttribute('role') === 'heading')) {
    return textOf(first);
  }
  return undefined;
}
