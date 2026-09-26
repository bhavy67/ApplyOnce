export function Popup() {
  return (
    <main className="popup">
      <h1>ApplyOnce</h1>
      <p className="tagline">Your information. Once.</p>
      <button type="button" onClick={() => void chrome.runtime.openOptionsPage()}>
        Manage Profile
      </button>
      <p className="note">Autofill is not available yet.</p>
    </main>
  );
}
