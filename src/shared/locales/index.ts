import commonDe from './de-DE/common.json';
import appDe from './de-DE/app.json';
import vaultDe from './de-DE/vault.json';
import connectionDe from './de-DE/connection.json';
import terminalDe from './de-DE/terminal.json';
import kubernetesDe from './de-DE/kubernetes.json';
import kubeActionsDe from './de-DE/kubeActions.json';
import containersDe from './de-DE/containers.json';
import filesDe from './de-DE/files.json';
import assistantDe from './de-DE/assistant.json';
import workflowsDe from './de-DE/workflows.json';
import mainDe from './de-DE/main.json';
import errorsSshDe from './de-DE/errors/ssh.json';
import errorsContainersDe from './de-DE/errors/containers.json';
import errorsKubernetesDe from './de-DE/errors/kubernetes.json';
import errorsFilesDe from './de-DE/errors/files.json';
import errorsAiDe from './de-DE/errors/ai.json';
import errorsCoreDe from './de-DE/errors/core.json';
import commonEn from './en-US/common.json';
import appEn from './en-US/app.json';
import vaultEn from './en-US/vault.json';
import connectionEn from './en-US/connection.json';
import terminalEn from './en-US/terminal.json';
import kubernetesEn from './en-US/kubernetes.json';
import kubeActionsEn from './en-US/kubeActions.json';
import containersEn from './en-US/containers.json';
import filesEn from './en-US/files.json';
import assistantEn from './en-US/assistant.json';
import workflowsEn from './en-US/workflows.json';
import mainEn from './en-US/main.json';
import errorsSshEn from './en-US/errors/ssh.json';
import errorsContainersEn from './en-US/errors/containers.json';
import errorsKubernetesEn from './en-US/errors/kubernetes.json';
import errorsFilesEn from './en-US/errors/files.json';
import errorsAiEn from './en-US/errors/ai.json';
import errorsCoreEn from './en-US/errors/core.json';

export const NAMESPACES = ['common', 'app', 'vault', 'connection', 'terminal', 'kubernetes', 'kubeActions',
  'containers', 'files', 'assistant', 'workflows', 'errors', 'main'] as const;
export type Namespace = typeof NAMESPACES[number];

export const resources = {
  'de-DE': {
    common: commonDe, app: appDe, vault: vaultDe, connection: connectionDe, terminal: terminalDe,
    kubernetes: kubernetesDe, kubeActions: kubeActionsDe, containers: containersDe, files: filesDe, assistant: assistantDe, workflows: workflowsDe,
    errors: { ...errorsSshDe, ...errorsContainersDe, ...errorsKubernetesDe, ...errorsFilesDe, ...errorsAiDe, ...errorsCoreDe },
    main: mainDe,
  },
  'en-US': {
    common: commonEn, app: appEn, vault: vaultEn, connection: connectionEn, terminal: terminalEn,
    kubernetes: kubernetesEn, kubeActions: kubeActionsEn, containers: containersEn, files: filesEn, assistant: assistantEn, workflows: workflowsEn,
    errors: { ...errorsSshEn, ...errorsContainersEn, ...errorsKubernetesEn, ...errorsFilesEn, ...errorsAiEn, ...errorsCoreEn },
    main: mainEn,
  },
} as const;
