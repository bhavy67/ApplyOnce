import { useEffect, useState } from 'react';
import type { ProfileRepository } from '../storage';
import { ConfirmDialog } from './ConfirmDialog';
import { ProfileForm } from './ProfileForm';
import { SavedMappingsSection } from './SavedMappingsSection';
import { useProfileEditor } from './use-profile-editor';

export function ProfilePage({ repository }: { repository: ProfileRepository }) {
  const editor = useProfileEditor(repository);
  const [confirmingClear, setConfirmingClear] = useState(false);
  useUnsavedChangesWarning(editor.dirty);

  if (editor.loadState === 'loading') {
    return (
      <main className="profile-page">
        <p className="muted">Loading profile…</p>
      </main>
    );
  }

  if (editor.loadState === 'failed') {
    return (
      <main className="profile-page">
        <h1>Your profile</h1>
        <p className="status status-error">
          Your saved profile could not be loaded. Nothing has been changed.
        </p>
      </main>
    );
  }

  const statusText = editor.status?.text ?? (editor.dirty ? 'Unsaved changes' : '');

  return (
    <main className="profile-page">
      <header className="page-header">
        <h1>Your profile</h1>
        <p className="muted">
          Stored only in this browser. Every field is optional; fill in what you use.
        </p>
      </header>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void editor.save();
        }}
      >
        <fieldset className="form-body" disabled={editor.busy}>
          <ProfileForm profile={editor.profile} errors={editor.errors} update={editor.update} />
        </fieldset>

        <div className="save-bar">
          <button type="submit" className="primary" disabled={editor.busy}>
            Save profile
          </button>
          <p
            role="status"
            className={`status ${editor.status ? `status-${editor.status.kind}` : 'muted'}`}
          >
            {statusText}
          </p>
          <button
            type="button"
            className="danger"
            disabled={editor.busy}
            onClick={() => setConfirmingClear(true)}
          >
            Clear profile…
          </button>
        </div>
      </form>

      <ConfirmDialog
        title="Clear your saved profile?"
        body="This permanently removes your profile from this browser. Saved field mappings are kept."
        confirmLabel="Clear Profile"
        open={confirmingClear}
        onCancel={() => setConfirmingClear(false)}
        onConfirm={() => {
          setConfirmingClear(false);
          void editor.clear();
        }}
      />
      <SavedMappingsSection />
    </main>
  );
}

/** Ask before leaving the page with unsaved edits. */
function useUnsavedChangesWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}
