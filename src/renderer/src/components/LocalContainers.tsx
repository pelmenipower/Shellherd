import { useState } from 'react';
import { LOCAL_CONTAINER_HOST } from '../../../shared/containers';
import type { ContainerTreeProps } from '../container-tree';
import { hasUsableLocalRuntime } from '../container-tree';
import { ContainerChildren } from './ContainerChildren';
import { ContextMenu } from './ContextMenu';

/** "Dieser Computer": only shown when Docker or Podman answered locally. */
export function LocalContainers({ containers, disabled, onOpenView }: { containers: ContainerTreeProps; disabled: boolean; onOpenView?: (hostId: string) => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const discovery = containers.state[LOCAL_CONTAINER_HOST];
  if (discovery?.status !== 'ready' || !hasUsableLocalRuntime(discovery.result)) return null;
  return <section className="local-containers" aria-label="Container auf diesem Computer">
    <div className="container-group" onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY }); }}>Dieser Computer</div>
    {menu && <ContextMenu x={menu.x} y={menu.y} label="Aktionen für Dieser Computer" onClose={() => setMenu(null)}
      entries={[{ kind: 'item', label: 'Lokale Container-Ansicht öffnen', disabled: disabled || !onOpenView, onSelect: () => onOpenView?.(LOCAL_CONTAINER_HOST) }]} />}
    <ContainerChildren hostId={LOCAL_CONTAINER_HOST} discovery={discovery} depth={0} disabled={disabled}
      onOpen={containers.onOpen} onAction={containers.onAction} onRefresh={() => containers.onExpand(LOCAL_CONTAINER_HOST)} />
  </section>;
}
