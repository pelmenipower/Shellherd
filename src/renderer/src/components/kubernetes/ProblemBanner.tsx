import { useState } from 'react';
import { KIND_INFO, type KubeProblem, type KubeRef } from '../../../../shared/kubernetes';
import { errorText } from '../../error-text';
import { useT } from '../../i18n';
import { menuHandlers, type MenuOpener } from '../../kube-menu-trigger';

type OnMenu = MenuOpener;

interface ProblemBannerProps {
  problems: KubeProblem[];
  onJump: (ref: KubeRef) => void;
  onMenu?: OnMenu;
  /** Pod problems: hands the problem to the assistant ("Mit KI analysieren"); absent while the cluster is not connected. */
  onAnalyze?: (problem: KubeProblem) => void;
}

/** One line that lists the cluster problems; a single problem is shown directly. */
export function ProblemBanner({ problems, onJump, onMenu, onAnalyze }: ProblemBannerProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  if (problems.length === 0) return null;
  const [first] = problems;
  const analyze = (problem: KubeProblem) => onAnalyze && problem.kind !== 'node'
    ? <button type="button" className="kube-link kube-banner-analyze" title={t('kubeActions:menu.analyze')} onClick={() => onAnalyze(problem)}>{t('kubeActions:menu.analyzeShort')}</button>
    : null;
  if (problems.length === 1) {
    return (
      <div className="kube-banner" role="status">
        <span className="kube-tone-bad">{t('kubernetes:problems.single')}</span>{' '}
        <button type="button" className="kube-link" onClick={() => onJump(first.ref)} {...menuHandlers(onMenu, { type: 'problem', problem: first })}>{errorText(first.error)}</button>
        {analyze(first)}
      </div>
    );
  }
  return (
    <div className="kube-banner" role="status">
      <button type="button" className="kube-link kube-tone-bad" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('kubernetes:problems.count', { count: problems.length })} <svg className={`chevron${open ? ' is-up' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 9 7 7 7-7" /></svg>
      </button>
      {open && (
        <ul className="kube-banner-list">
          {problems.map(problem => (
            <li key={problem.id}>
              <button type="button" className="kube-link" onClick={() => onJump(problem.ref)} {...menuHandlers(onMenu, { type: 'problem', problem })}>
                <span className="kube-muted">{KIND_INFO[problem.ref.kind].kind} {problem.ref.name}</span> {errorText(problem.error)}
              </button>
              {analyze(problem)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
