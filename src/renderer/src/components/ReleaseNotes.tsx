import { useEffect, useId, useRef, useState } from 'react';
import { inlineCode, notesSince } from '../../../shared/version';
import type { ReleaseNotes as Notes } from '../../../shared/version';
import { markVersionSeen, releases, seenVersion } from '../release-notes';
import { useNativeSurfaceBlock } from '../native-surface';

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' });
const formatDate = (date: string): string => dateFormat.format(new Date(`${date}T12:00:00`));

/** A changelog item with `backtick` spans as <code>. */
function NoteText({ text }: { text: string }) {
  return <>{inlineCode(text).map((part, index) => part.code ? <code key={index}>{part.text}</code> : part.text)}</>;
}

/** "What's new" after an update; dismissed once per version on this computer. */
export function WhatsNew({ version, onShowAll }: { version: string; onShowAll: () => void }) {
  const [notes, setNotes] = useState<Notes[]>(() => notesSince(releases, version, seenVersion()));
  if (!notes.length) return null;
  const items = notes.flatMap(release => release.items);
  return (
    <section className="whats-new" aria-labelledby="whats-new-title">
      <h2 id="whats-new-title">Neu in Version {version}</h2>
      <ul>{items.slice(0, 5).map(item => <li key={item}><NoteText text={item} /></li>)}</ul>
      <div className="whats-new-actions">
        {items.length > 5 && <button type="button" className="secondary-button" onClick={onShowAll}>Alle {items.length} Neuerungen</button>}
        <button type="button" className="secondary-button" onClick={() => { markVersionSeen(version); setNotes([]); }}>Ausblenden</button>
      </div>
    </section>
  );
}

/** Full changelog, newest version first. */
export function ReleaseNotesDialog({ version, onClose }: { version: string; onClose: () => void }) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useNativeSurfaceBlock(true);
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  return (
    <dialog ref={dialogRef} className="confirm-dialog release-notes-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); onClose(); }}>
      <h2 id={`${id}-title`}>Shellherd {version}</h2>
      <div className="release-notes-list">
        {releases.map(release => <section key={release.version}>
          <h3>Version {release.version} <small>{formatDate(release.date)}</small></h3>
          <ul>{release.items.map(item => <li key={item}><NoteText text={item} /></li>)}</ul>
        </section>)}
      </div>
      <div className="form-actions"><button type="button" className="primary-button" autoFocus onClick={() => { markVersionSeen(version); onClose(); }}>Schließen</button></div>
    </dialog>
  );
}
