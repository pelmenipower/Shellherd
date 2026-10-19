import { useEffect, useId, useRef, useState } from 'react';
import { inlineCode, notesSince } from '../../../shared/version';
import type { ReleaseNotes as Notes } from '../../../shared/version';
import { markVersionSeen, releasesFor, seenVersion } from '../release-notes';
import { useNativeSurfaceBlock } from '../native-surface';
import { currentLocale, useT } from '../i18n';
import { formatDateTime } from '../../../shared/format';

const formatDate = (date: string): string => formatDateTime(`${date}T12:00:00`, 'long');

/** A changelog item with `backtick` spans as <code>. */
function NoteText({ text }: { text: string }) {
  return <>{inlineCode(text).map((part, index) => part.code ? <code key={index}>{part.text}</code> : part.text)}</>;
}

/** "What's new" after an update; dismissed once per version on this computer. */
export function WhatsNew({ version, onShowAll }: { version: string; onShowAll: () => void }) {
  const { t } = useT();
  const [hidden, setHidden] = useState(false);
  // Computed per render so a language switch shows the notes in the new language.
  const notes: Notes[] = hidden ? [] : notesSince(releasesFor(currentLocale()), version, seenVersion());
  if (!notes.length) return null;
  const items = notes.flatMap(release => release.items);
  return (
    <section className="whats-new" aria-labelledby="whats-new-title">
      <h2 id="whats-new-title">{t('app:releaseNotes.title', { version })}</h2>
      <ul>{items.slice(0, 5).map(item => <li key={item}><NoteText text={item} /></li>)}</ul>
      <div className="whats-new-actions">
        {items.length > 5 && <button type="button" className="secondary-button" onClick={onShowAll}>{t('app:releaseNotes.showAll', { count: items.length })}</button>}
        <button type="button" className="secondary-button" onClick={() => { markVersionSeen(version); setHidden(true); }}>{t('app:releaseNotes.hide')}</button>
      </div>
    </section>
  );
}

/** Full changelog, newest version first. */
export function ReleaseNotesDialog({ version, onClose }: { version: string; onClose: () => void }) {
  const { t } = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useNativeSurfaceBlock(true);
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  return (
    <dialog ref={dialogRef} className="confirm-dialog release-notes-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); onClose(); }}>
      <h2 id={`${id}-title`}>Shellherd {version}</h2>
      <div className="release-notes-list">
        {releasesFor(currentLocale()).map(release => <section key={release.version}>
          <h3>{t('app:releaseNotes.version', { version: release.version })} <small>{formatDate(release.date)}</small></h3>
          <ul>{release.items.map(item => <li key={item}><NoteText text={item} /></li>)}</ul>
        </section>)}
      </div>
      <div className="form-actions"><button type="button" className="primary-button" autoFocus onClick={() => { markVersionSeen(version); onClose(); }}>{t('common:actions.close')}</button></div>
    </dialog>
  );
}
