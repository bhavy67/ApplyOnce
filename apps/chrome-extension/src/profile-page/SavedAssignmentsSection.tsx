import { useEffect, useState } from 'react';
import { MessageType, type AssignmentView } from '../messaging/protocol';
import { sendToServiceWorker } from '../messaging/send';
import { ConfirmDialog } from './ConfirmDialog';

type ListState =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; assignments: AssignmentView[] };

/**
 * Transparency and control over explicit record assignments: which repeated field on which
 * page is assigned to which record, and a way to remove them. Shows labels only (site,
 * question, record position and field), never record contents, field ids, or record ids.
 * Separate from saved field mappings; removing assignments never changes the profile.
 */
export function SavedAssignmentsSection() {
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [message, setMessage] = useState<string>();
  const [confirmingClear, setConfirmingClear] = useState(false);

  useEffect(() => {
    let active = true;
    const reload = () => {
      void fetchAssignments().then((next) => {
        if (active) setList(next);
      });
    };
    reload();
    // Assignments are made from the popup, and records change on this page: refresh on focus.
    window.addEventListener('focus', reload);
    return () => {
      active = false;
      window.removeEventListener('focus', reload);
    };
  }, []);

  async function remove(assignment: AssignmentView) {
    const response = await sendToServiceWorker(MessageType.RemoveAssignment, {
      handle: assignment.handle,
    });
    setMessage(response.ok ? 'Assignment removed.' : 'Could not remove the assignment.');
    setList(await fetchAssignments());
  }

  async function clearAll() {
    setConfirmingClear(false);
    const response = await sendToServiceWorker(MessageType.ClearAssignments);
    setMessage(
      response.ok ? 'All saved assignments removed.' : 'Could not remove the assignments.',
    );
    setList(await fetchAssignments());
  }

  const count = list.status === 'ready' ? list.assignments.length : undefined;

  return (
    <section id="saved-assignments" className="profile-section saved-assignments">
      <h2>Saved assignments{count !== undefined && <span className="count"> ({count})</span>}</h2>
      <p className="muted">
        Repeated questions you assigned to a specific record with Assign record. Each applies only
        to that question on that page, and follows the record even if you reorder your records.
        Removing an assignment does not change your profile or your saved field mappings.
      </p>

      {list.status === 'loading' && <p className="muted">Loading…</p>}
      {list.status === 'failed' && (
        <p className="status status-error">Saved assignments could not be loaded.</p>
      )}
      {list.status === 'ready' && list.assignments.length === 0 && (
        <p className="muted">No saved assignments.</p>
      )}
      {list.status === 'ready' && list.assignments.length > 0 && (
        <>
          <ul className="mapping-list assignment-list">
            {list.assignments.map((assignment) => (
              <li
                key={`${assignment.handle.page}|${assignment.handle.fieldId}|${assignment.handle.identityKey ?? ''}`}
              >
                <div className="mapping-details">
                  <span className="mapping-field">“{assignment.question}”</span>
                  <span className="mapping-target">
                    → {assignment.target}
                    {!assignment.available && (
                      <span className="unavailable"> · Unavailable (record deleted)</span>
                    )}
                  </span>
                  <span className="muted small">
                    {assignment.controlType} field · {assignment.site}
                    {assignment.path !== '/' && assignment.path}
                    {assignment.kind === 'legacy' && ' · saved by an earlier version'}
                  </span>
                </div>
                <button type="button" className="danger" onClick={() => void remove(assignment)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="danger" onClick={() => setConfirmingClear(true)}>
            Clear all assignments…
          </button>
        </>
      )}
      {message && (
        <p role="status" className="status muted">
          {message}
        </p>
      )}

      <ConfirmDialog
        open={confirmingClear}
        title="Clear all saved assignments?"
        body="Repeated fields will need to be assigned again. Your profile and saved field mappings are not changed."
        confirmLabel="Clear all assignments"
        onCancel={() => setConfirmingClear(false)}
        onConfirm={() => void clearAll()}
      />
    </section>
  );
}

async function fetchAssignments(): Promise<ListState> {
  const response = await sendToServiceWorker(MessageType.ListAssignments);
  return response.ok
    ? { status: 'ready', assignments: response.data.assignments }
    : { status: 'failed' };
}
