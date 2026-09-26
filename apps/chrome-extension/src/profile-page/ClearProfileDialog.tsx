import { useEffect, useId, useRef } from 'react';

interface ClearProfileDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ClearProfileDialog({ open, onCancel, onConfirm }: ClearProfileDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // `onClose` also covers the Escape key.
    <dialog ref={dialogRef} aria-labelledby={titleId} onClose={onCancel}>
      <h2 id={titleId}>Clear your saved profile?</h2>
      <p>This permanently removes your profile from this browser.</p>
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button type="button" className="danger" onClick={onConfirm}>
          Clear Profile
        </button>
      </div>
    </dialog>
  );
}
