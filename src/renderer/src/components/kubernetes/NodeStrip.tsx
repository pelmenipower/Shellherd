import type { NodeTile } from '../../../../shared/kubernetes';
import { useT } from '../../i18n';
import { menuHandlers, type MenuOpener } from '../../kube-menu-trigger';

type OnMenu = MenuOpener;

interface NodeStripProps {
  nodes: NodeTile[];
  onJump: (name: string) => void;
  onMenu?: OnMenu;
}

/** Names without the prefix all nodes share, e.g. `cp1` for `k8s-cp1`; the full name when that would leave one empty. */
export function shortNodeNames(names: string[]): string[] {
  if (names.length < 2) return names;
  let prefix = names[0];
  for (const name of names) while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  const cut = prefix.lastIndexOf('-') + 1;
  const stripped = names.map(name => name.slice(cut));
  return stripped.every(name => name.length > 0) ? stripped : names;
}

function dotTone(node: NodeTile): 'ok' | 'warn' | 'bad' {
  if (!node.ready) return 'bad';
  if (node.pressure.length > 0 || node.unschedulable) return 'warn';
  return 'ok';
}

export function NodeStrip({ nodes, onJump, onMenu }: NodeStripProps) {
  const { t } = useT();
  if (nodes.length === 0) return null;
  const labels = shortNodeNames(nodes.map(node => node.name));
  const withoutMetrics = nodes.every(node => node.cpu === undefined && node.memory === undefined);
  return (
    <div className="kube-nodes" role="list" aria-label={t('kubernetes:nodes.label')}>
      {nodes.map((node, index) => {
        const tone = dotTone(node);
        const title = [node.name, node.ready ? t('kubernetes:nodes.ready') : t('kubernetes:nodes.notReady'), ...node.pressure, node.unschedulable ? t('kubernetes:nodes.cordoned') : ''].filter(Boolean).join(', ');
        return (
          <button key={node.name} type="button" role="listitem" className={`kube-node kube-node-${tone}`} title={title}
            onClick={() => onJump(node.name)} {...menuHandlers(onMenu, { type: 'node', tile: node })}>
            <span className="kube-node-name"><span className={`kube-dot kube-tone-${tone}`} aria-hidden="true">●</span> {labels[index]}</span>
            {node.cpu !== undefined && <Meter label="CPU" value={node.cpu} />}
            {node.memory !== undefined && <Meter label="RAM" value={node.memory} />}
          </button>
        );
      })}
      {withoutMetrics && <span className="kube-node-hint">{t('kubernetes:nodes.noMetrics')}</span>}
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span className="kube-meter" title={`${label} ${percent} %`}>
      <span className="kube-meter-bar" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
      <span className="kube-meter-value">{label} {percent} %</span>
    </span>
  );
}
