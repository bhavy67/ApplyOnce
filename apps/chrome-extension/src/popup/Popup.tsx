import { useState } from 'react';
import type { PageScan, ProfileStatus } from '../messaging/protocol';
import { analyzeActiveTab, FAILURE_MESSAGES, summarizeFields } from './analyze-page';
import { FieldList } from './FieldList';

type AnalysisState =
  | { status: 'idle' }
  | { status: 'analyzing' }
  | { status: 'done'; scan: PageScan }
  | { status: 'failed'; message: string };

const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  workday: 'Workday',
  greenhouse: 'Greenhouse',
};

export function Popup() {
  const [state, setState] = useState<AnalysisState>({ status: 'idle' });

  async function analyze() {
    setState({ status: 'analyzing' });
    try {
      const result = await analyzeActiveTab();
      setState(
        result.ok
          ? { status: 'done', scan: result.scan }
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
        className="primary"
        disabled={state.status === 'analyzing'}
        onClick={() => void analyze()}
      >
        {state.status === 'analyzing' ? 'Analyzing…' : 'Analyze this page'}
      </button>

      {state.status === 'failed' && (
        <p className="message error" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'done' && <AnalysisSummary scan={state.scan} />}

      <p className="note">Autofill is coming in a later phase.</p>
      <button
        type="button"
        className="secondary"
        onClick={() => void chrome.runtime.openOptionsPage()}
      >
        Manage Profile
      </button>
    </main>
  );
}

function AnalysisSummary({ scan }: { scan: PageScan }) {
  const [showFields, setShowFields] = useState(false);
  const summary = summarizeFields(scan.fields);
  const platform = PLATFORM_NAMES[scan.platform];

  return (
    <section className="analysis" aria-live="polite">
      {scan.title && <p className="page-title">{scan.title}</p>}
      <p className="count">
        {summary.detected} {summary.detected === 1 ? 'field' : 'fields'} detected
      </p>
      <dl className="stats">
        <dt>Labeled</dt>
        <dd>{summary.labeled}</dd>
        <dt>Needs review</dt>
        <dd>{summary.needsReview}</dd>
        {summary.inactive > 0 && (
          <>
            <dt>Hidden or disabled</dt>
            <dd>{summary.inactive}</dd>
          </>
        )}
      </dl>
      {platform && (
        <p className="note">{platform} page detected. Site-specific support comes later.</p>
      )}
      <p className="profile-status">{describeProfile(scan.profileStatus)}</p>
      {scan.fields.length > 0 && (
        <>
          <button type="button" className="link" onClick={() => setShowFields((s) => !s)}>
            {showFields ? 'Hide fields' : 'View fields'}
          </button>
          {showFields && <FieldList fields={scan.fields} />}
        </>
      )}
    </section>
  );
}

function describeProfile(status: ProfileStatus | null): string {
  if (!status) return 'Your profile could not be loaded.';
  if (!status.hasData) return 'No profile saved yet.';
  return `Profile ready: ${status.valueCount} saved ${status.valueCount === 1 ? 'value' : 'values'}.`;
}
