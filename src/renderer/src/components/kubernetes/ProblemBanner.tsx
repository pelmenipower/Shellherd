import { useState } from 'react';
import { KIND_INFO, type KubeProblem, type KubeRef } from '../../../../shared/kubernetes';
import { menuHandlers, type MenuOpener } from '../../kube-menu-trigger';

type OnMenu = MenuOpener;

interface ProblemBannerProps {
  problems: KubeProblem[];
  onJump: (ref: KubeRef) => void;
  onMenu?: OnMenu;
}

/** One line that lists the cluster problems; a single problem is shown directly. */
export function ProblemBanner({ problems, onJump, onMenu }: ProblemBannerProps) {
  const [open, setOpen] = useState(false);
  if (problems.length === 0) return null;
  const [first] = problems;
  if (problems.length === 1) {
    return (
      <div className="kube-banner" role="status">
        <span className="kube-tone-bad">1 Problem:</span>{' '}
        <button type="button" className="kube-link" onClick={() => onJump(first.ref)} {...menuHandlers(onMenu, { type: 'problem', problem: first })}>{first.message}</button>
      </div>
    );
  }
  return (
    <div className="kube-banner" role="status">
      <button type="button" className="kube-link kube-tone-bad" aria-expanded={open} onClick={() => setOpen(!open)}>
        {problems.length} Probleme <svg className={`chevron${open ? ' is-up' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 9 7 7 7-7" /></svg>
      </button>
      {open && (
        <ul className="kube-banner-list">
          {problems.map(problem => (
            <li key={problem.id}>
              <button type="button" className="kube-link" onClick={() => onJump(problem.ref)} {...menuHandlers(onMenu, { type: 'problem', problem })}>
                <span className="kube-muted">{KIND_INFO[problem.ref.kind].kind} {problem.ref.name}</span> {problem.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
