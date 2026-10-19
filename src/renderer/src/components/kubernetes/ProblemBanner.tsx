import { useState } from 'react';
import { KIND_INFO, type KubeProblem, type KubeRef } from '../../../../shared/kubernetes';
import { errorText } from '../../error-text';
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
        <button type="button" className="kube-link" onClick={() => onJump(first.ref)} {...menuHandlers(onMenu, { type: 'problem', problem: first })}>{errorText(first.error)}</button>
      </div>
    );
  }
  return (
    <div className="kube-banner" role="status">
      <button type="button" className="kube-link kube-tone-bad" aria-expanded={open} onClick={() => setOpen(!open)}>
        {problems.length} Probleme {open ? '▴' : '▾'}
      </button>
      {open && (
        <ul className="kube-banner-list">
          {problems.map(problem => (
            <li key={problem.id}>
              <button type="button" className="kube-link" onClick={() => onJump(problem.ref)} {...menuHandlers(onMenu, { type: 'problem', problem })}>
                <span className="kube-muted">{KIND_INFO[problem.ref.kind].kind} {problem.ref.name}</span> {errorText(problem.error)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
