import type { FillResult, FormField } from '@applyonce/core';
import { useState } from 'react';
import type {
  PageScan,
  ProfileRecordCounts,
  ProfileStatus,
  ReviewedMapping,
} from '../messaging/protocol';
import {
  analyzeActiveTab,
  assignRecord,
  removeRecordAssignment,
  FAILURE_MESSAGES,
  fillApprovedFields,
  summarizeFields,
  teachMapping,
} from './analyze-page';
import { initialSelection, plural, summarizeFillResults, summarizeReview } from './review';
import { ReviewList } from './ReviewList';

interface Analysis {
  tabId: number;
  site?: string;
  page?: string;
  scan: PageScan;
  mappings: ReviewedMapping[];
  records: ProfileRecordCounts;
}

type PopupState =
  | { status: 'idle' }
  | { status: 'analyzing' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; analysis: Analysis };

const PLATFORM_NOTES: Readonly<Record<string, string>> = {
  workday:
    'Workday page: ApplyOnce fills the current step only. Move to the next step yourself, then analyze again.',
  greenhouse:
    'Greenhouse page: ApplyOnce fills this form only. Voluntary self-identification questions are never filled.',
};

const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  workday: 'Workday',
  greenhouse: 'Greenhouse',
};

export function Popup() {
  const [state, setState] = useState<PopupState>({ status: 'idle' });
  const [analysisCount, setAnalysisCount] = useState(0);

  async function analyze() {
    setState({ status: 'analyzing' });
    setAnalysisCount((count) => count + 1);
    try {
      const result = await analyzeActiveTab();
      setState(
        result.ok
          ? { status: 'ready', analysis: result }
          : { status: 'failed', message: FAILURE_MESSAGES[result.reason] },
      );
    } catch {
      setState({ status: 'failed', message: FAILURE_MESSAGES['scan-failed'] });
    }
  }

  return (
    <main className="popup">
      <h1>ApplyOnce</h1>
      <p className="tagline">Your information. Once.</p>

      <button
        type="button"
        className={state.status === 'ready' ? 'secondary' : 'primary'}
        disabled={state.status === 'analyzing'}
        onClick={() => void analyze()}
      >
        {state.status === 'analyzing'
          ? 'Analyzing…'
          : state.status === 'ready'
            ? 'Analyze again'
            : 'Analyze this page'}
      </button>

      {state.status === 'failed' && (
        <p className="message error" role="alert">
          {state.message}
        </p>
      )}
      {/* Keyed so a new analysis starts with a fresh review. */}
      {state.status === 'ready' && <AnalysisReview key={analysisCount} analysis={state.analysis} />}

      <p className="note">ApplyOnce never submits forms. Check the page before you submit.</p>
      <div className="footer-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => void chrome.runtime.openOptionsPage()}
        >
          Manage Profile
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void chrome.tabs.create({ url: chrome.runtime.getURL('profile.html#saved-mappings') })
          }
        >
          Saved mappings
        </button>
      </div>
    </main>
  );
}

function AnalysisReview({ analysis }: { analysis: Analysis }) {
  const { tabId, site, page, scan, records } = analysis;
  const [mappings, setMappings] = useState(analysis.mappings);
  const [selected, setSelected] = useState(() => initialSelection(analysis.mappings));
  const [filling, setFilling] = useState(false);
  const [results, setResults] = useState<FillResult[]>();
  const [fillError, setFillError] = useState<string>();

  const mappingsById = new Map(mappings.map((m) => [m.fieldId, m]));
  const resultsById = new Map((results ?? []).map((r) => [r.fieldId, r]));
  const detected = summarizeFields(scan.fields).detected;
  const review = summarizeReview(mappings, selected);
  const platform = PLATFORM_NAMES[scan.platform];

  function toggle(fieldId: string, isSelected: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (isSelected) next.add(fieldId);
      else next.delete(fieldId);
      return next;
    });
  }

  /** Replaces one field's mapping; a changed mapping must be approved again before filling. */
  function replaceMapping(field: FormField, updated: ReviewedMapping) {
    setMappings((current) => current.map((m) => (m.fieldId === field.id ? updated : m)));
    toggle(field.id, false);
    setResults((current) => current?.filter((r) => r.fieldId !== field.id));
  }

  /** Saves the taught mapping and updates this field's review. Never fills. */
  async function teach(field: FormField, profileField: string): Promise<string | undefined> {
    const updated = await teachMapping(field, profileField, site).catch(() => undefined);
    if (!updated) return 'Could not save this mapping.';
    replaceMapping(field, updated);
    return undefined;
  }

  /** Saves an explicit record assignment for a repeated field. Never fills. */
  async function assign(field: FormField, target: string): Promise<string | undefined> {
    if (!page) return 'Record assignment is not available on this page.';
    const updated = await assignRecord(page, field, target).catch(() => undefined);
    if (!updated) return 'Could not save this assignment.';
    replaceMapping(field, updated);
    return undefined;
  }

  async function unassign(field: FormField): Promise<string | undefined> {
    if (!page) return undefined;
    const updated = await removeRecordAssignment(page, field).catch(() => undefined);
    if (!updated) return 'Could not remove this assignment.';
    replaceMapping(field, updated);
    return undefined;
  }

  async function fill() {
    const approvals = scan.fields.flatMap((field) => {
      const mapping = mappingsById.get(field.id);
      const profileField = mapping?.profileField;
      if (!selected.has(field.id) || !profileField) return [];
      // An unsaved assignment (identical copies) is sent with its approval and re-checked.
      return [{ field, profileField, ...(mapping.transient ? { transient: true } : {}) }];
    });
    setFilling(true);
    setFillError(undefined);
    try {
      const filled = await fillApprovedFields(tabId, approvals, page);
      if (filled) setResults(filled);
      else setFillError('Filling failed. Analyze the page again and retry.');
    } catch {
      setFillError('Filling failed. Analyze the page again and retry.');
    } finally {
      setFilling(false);
    }
  }

  const fillSummary = results && summarizeFillResults(results);

  return (
    <section className="analysis" aria-live="polite">
      {scan.title && <p className="page-title">{scan.title}</p>}
      <p className="count">{plural(detected, 'field')} detected</p>

      {fillSummary ? (
        <p className="fill-summary" role="status">
          {plural(fillSummary.filled, 'field')} filled
          {fillSummary.skipped > 0 && ` · ${fillSummary.skipped} skipped`}
          {fillSummary.failed > 0 && ` · ${fillSummary.failed} failed`}
          {review.needsReview > 0 && ` · ${review.needsReview} need review`}
        </p>
      ) : (
        <dl className="stats">
          <dt>Ready to fill</dt>
          <dd>{review.ready}</dd>
          <dt>Needs review</dt>
          <dd>{review.needsReview}</dd>
          <dt>No value in profile</dt>
          <dd>{review.missingValue}</dd>
          <dt>Not recognized</dt>
          <dd>{review.unknown}</dd>
        </dl>
      )}
      {fillError && (
        <p className="message error" role="alert">
          {fillError}
        </p>
      )}

      {platform && <p className="note">{PLATFORM_NOTES[scan.platform]}</p>}
      <p className="profile-status">{describeProfile(scan.profileStatus)}</p>

      <button
        type="button"
        className="primary"
        disabled={filling || selected.size === 0}
        onClick={() => void fill()}
      >
        {filling ? 'Filling…' : `Fill ${plural(selected.size, 'selected field')}`}
      </button>

      {scan.fields.length > 0 && (
        <ReviewList
          fields={scan.fields}
          mappings={mappingsById}
          selected={selected}
          results={resultsById}
          records={records}
          disabled={filling}
          onToggle={toggle}
          onTeach={teach}
          onAssign={page ? assign : undefined}
          onUnassign={unassign}
        />
      )}
    </section>
  );
}

function describeProfile(status: ProfileStatus | null): string {
  if (!status) return 'Your profile could not be loaded.';
  if (!status.hasData) return 'No profile saved yet. Add your details under Manage Profile.';
  return `Profile ready: ${plural(status.valueCount, 'saved value')}.`;
}
