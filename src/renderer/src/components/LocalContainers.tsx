import { useState } from 'react';
import { LOCAL_CONTAINER_HOST } from '../../../shared/containers';
import { useT } from '../i18n';
import type { ContainerTreeProps } from '../container-tree';
import { hasUsableLocalRuntime } from '../container-tree';
import { ContainerChildren } from './ContainerChildren';
import { ContextMenu } from './ContextMenu';

/** "Dieser Computer": shown when the docker or podman CLI is installed. */
export function LocalContainers({ containers, disabled, onOpenView }: { containers: ContainerTreeProps; disabled: boolean; onOpenView?: (hostId: string) => void }) {
  const { t } = useT();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const discovery = containers.state[LOCAL_CONTAINER_HOST];
  if (discovery?.status !== 'ready' || !hasUsableLocalRuntime(discovery.result)) return null;
  return <section className="local-containers" aria-label={t('containers:local.aria')}>
    <div className="container-group" onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY }); }}>{t('common:thisComputer')}</div>
    {menu && <ContextMenu x={menu.x} y={menu.y} label={t('containers:tree.actionsFor', { name: t('common:thisComputer') })} onClose={() => setMenu(null)}
      entries={[{ kind: 'item', label: t('containers:local.openView'), disabled: disabled || !onOpenView, onSelect: () => onOpenView?.(LOCAL_CONTAINER_HOST) }]} />}
    <ContainerChildren hostId={LOCAL_CONTAINER_HOST} hostName={t('common:thisComputer')} discovery={discovery} depth={0} disabled={disabled}
      onOpen={containers.onOpen} onOpenView={containers.onOpenView} onAction={containers.onAction} onRefresh={() => containers.onExpand(LOCAL_CONTAINER_HOST)} />
  </section>;
}
