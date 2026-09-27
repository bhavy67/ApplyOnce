import { resolveProfileTarget, type MappingKeyParts, type SavedMapping } from '@applyonce/core';
import { useEffect, useState } from 'react';
import { MessageType } from '../messaging/protocol';
import { sendToServiceWorker } from '../messaging/send';
import { ConfirmDialog } from './ConfirmDialog';

type ListState =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; mappings: SavedMapping[] };

/**
 * Transparency and control over Teach Once: what was taught, and a way to remove it.
 * Talks to the service worker, the single writer of saved mappings.
 */
export function SavedMappingsSection() {
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [message, setMessage] = useState<string>();
  const [confirmingClear, setConfirmingClear] = useState(false);

  useEffect(() => {
    let active = true;
    const reload = () => {
      void fetchMappings().then((next) => {
        if (active) setList(next);
      });
    };
    reload();
    // Mappings are usually taught from the popup while this page is open elsewhere.
    window.addEventListener('focus', reload);
    return () => {
      active = false;
      window.removeEventListener('focus', reload);
    };
  }, []);

  useEffect(() => {
    if (list.status === 'ready' && window.location.hash === '#saved-mappings') {
      document.getElementById('saved-mappings')?.scrollIntoView();
    }
  }, [list.status]);

  async function remove(key: string) {
    const response = await sendToServiceWorker(MessageType.DeleteMapping, { key });
    setMessage(response.ok ? 'Mapping deleted.' : 'Could not delete the mapping.');
    setList(await fetchMappings());
  }

  async function clearAll() {
    setConfirmingClear(false);
    const response = await sendToServiceWorker(MessageType.ClearMappings);
    setMessage(response.ok ? 'All saved mappings deleted.' : 'Could not delete the mappings.');
    setList(await fetchMappings());
  }

  return (
    <section id="saved-mappings" className="profile-section saved-mappings">
      <h2>Saved field mappings</h2>
      <p className="muted">
        Fields you taught ApplyOnce with Teach or Change. They are reused wherever the same question
        appears. Only the field description and the profile field are stored, never values. Deleting
        a mapping does not change your profile.
      </p>

      {list.status === 'loading' && <p className="muted">Loading…</p>}
      {list.status === 'failed' && (
        <p className="status status-error">Saved mappings could not be loaded.</p>
      )}
      {list.status === 'ready' && list.mappings.length === 0 && (
        <p className="muted">No saved mappings yet.</p>
      )}
      {list.status === 'ready' && list.mappings.length > 0 && (
        <>
          <ul className="mapping-list">
            {list.mappings.map((mapping) => (
              <li key={mapping.key}>
                <div className="mapping-details">
                  <span className="mapping-field">{describeParts(mapping.parts)}</span>
                  <span className="mapping-target">→ {describeTarget(mapping.profileField)}</span>
                  <span className="muted small">
                    {mapping.parts.fieldType} field
                    {mapping.site && ` · taught on ${mapping.site}`} · updated{' '}
                    {new Date(mapping.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                <button type="button" className="danger" onClick={() => void remove(mapping.key)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="danger" onClick={() => setConfirmingClear(true)}>
            Delete all mappings…
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
        title="Delete all saved mappings?"
        body="ApplyOnce will go back to automatic mapping for these fields. Your profile is not changed."
        confirmLabel="Delete all"
        onCancel={() => setConfirmingClear(false)}
        onConfirm={() => void clearAll()}
      />
    </section>
  );
}

async function fetchMappings(): Promise<ListState> {
  const response = await sendToServiceWorker(MessageType.ListMappings);
  return response.ok ? { status: 'ready', mappings: response.data.mappings } : { status: 'failed' };
}

/** A mapping may point to a field this version no longer has; it is then never applied. */
function describeTarget(profileField: string): string {
  const target = resolveProfileTarget(profileField);
  return target ? `${target.label} (${target.path})` : 'Unknown profile field (not used)';
}

function describeParts(parts: MappingKeyParts): string {
  if (parts.question) {
    return parts.context ? `“${parts.question}” (in “${parts.context}”)` : `“${parts.question}”`;
  }
  return `Field named “${parts.identifier ?? ''}”`;
}
