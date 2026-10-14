import { LOCAL_CONTAINER_HOST } from '../../../shared/containers';
import type { ContainerTreeProps } from '../container-tree';
import { hasUsableLocalRuntime } from '../container-tree';
import { ContainerChildren } from './ContainerChildren';

/** "Dieser Computer": only shown when Docker or Podman answered locally. */
export function LocalContainers({ containers, disabled }: { containers: ContainerTreeProps; disabled: boolean }) {
  const discovery = containers.state[LOCAL_CONTAINER_HOST];
  if (discovery?.status !== 'ready' || !hasUsableLocalRuntime(discovery.result)) return null;
  return <section className="local-containers" aria-label="Container auf diesem Computer">
    <div className="container-group">Dieser Computer</div>
    <ContainerChildren hostId={LOCAL_CONTAINER_HOST} discovery={discovery} depth={0} disabled={disabled}
      onOpen={containers.onOpen} onAction={containers.onAction} onRefresh={() => containers.onExpand(LOCAL_CONTAINER_HOST)} />
  </section>;
}
