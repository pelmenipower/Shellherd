import {
  useCallback,
  useEffect,
  useState,
  useRef,
} from 'react';

import type {
  FormEvent,
} from 'react';

import type {
  ConnectionNode,
  ConnectionProtocol,
  FolderNode,
  Vault,
  VaultNode,
} from '../../shared/vault/types';

import { addNode, moveNode, removeNode, removeNodeFromVault, removeWorkspace, updateNode, upsertWorkspace } from '../../shared/vault/mutations';
import type { NodeDropTarget } from '../../shared/vault/mutations';
import { VaultTree } from './components/VaultTree';
import { ContextMenu } from './components/ContextMenu';
import type { ContextMenuEntry } from './components/ContextMenu';
import { FolderEditor } from './components/FolderEditor';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ToastStack } from './components/Toast';
import { clearNotices, notify } from './notice-store';
import { onEditRequest } from './edit-request';
import { ResizableSidebar } from './components/ResizableSidebar';
import { useTerminalTabs } from './hooks/useTerminalTabs';
import { usePersistVault } from './hooks/usePersistVault';
import { containerConnection, containerViewConnection, isRunning, isWelcomeTab, planContainerView, reusableTab, tabLabel, toTerminalConnection, welcomeConnection } from './terminal-tabs';
import type { TerminalConnection, TerminalTab } from './terminal-tabs';
import { newClusterFromSsh } from './cluster-form';
import type { KubeProbeResult, KubeViewSnapshot } from '../../shared/kubernetes';
import type { AutoUploadBinding, KubernetesConnectionNode } from '../../shared/vault/types';
import { connectionsIn, NEW_CONNECTION_KINDS, redactVault } from '../../shared/vault/connections';
import { AppError } from '../../shared/errors';
import type { UnlockVaultResult } from '../../shared/ipc';
import { LockScreen } from './components/LockScreen';
import { connectionAddress, protocolLabel } from './connection-labels';
import { disabledNotice, disabledTitle, sessionLimitNotice, sessionLimitText, skippedNotice } from './vault-notices';
import { LOCAL_CONTAINER_HOST, toTarget } from '../../shared/containers';
import type { ContainerAction, ContainerRuntime, DiscoveredItem, TerminalTargetMode } from '../../shared/containers';
import type { ContainerTreeProps } from './container-tree';
import { useContainerDiscovery } from './hooks/useContainerDiscovery';
import { LocalContainers } from './components/LocalContainers';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { SplitTerminalArea } from './components/SplitTerminalArea';
import { WorkspaceControls } from './components/WorkspaceControls';
import { useTerminalLayout } from './hooks/useTerminalLayout';
import { useTabTransfer } from './hooks/useTabTransfer';
import { useViewControls } from './hooks/useViewControls';
import { fromWorkspaceViews, toWorkspaceViews, workspaceSummary } from './terminal-views';
import { WelcomePage } from './components/WelcomePage';
import { ReleaseNotesDialog } from './components/ReleaseNotes';
import { AssistantPanel } from './components/AssistantPanel';
import { AiSettingsDialog } from './components/AiSettingsDialog';
import { useAssistantToggle } from './hooks/useAssistantToggle';
import { useCtrlShiftShortcut, useCtrlShortcut } from './hooks/useShortcut';
import { WorkflowPalette } from './components/WorkflowPalette';
import { WorkflowsDialog } from './components/WorkflowsDialog';
import type { Workflow } from '../../shared/vault/types';
import { ConnectionForm } from './components/ConnectionForm';
import { keepAutoUpload, parentFolderId } from './connection-form';
import { findNode } from './vault-selection';
import { errorText } from './error-text';
import { useT } from './i18n';
import { SettingsDialog } from './components/SettingsDialog';
import { settingsShortcutAction } from './shortcut-match';
import mark from '../../../resources/mark-64.png';

type Screen = 'home' | 'create' | 'open' | 'vault';
type LockState = { minutes?: number; vaultId: string };
type AppDialog =
  | { kind: 'settings'; instant: boolean; focus: 'close' | 'manageAi' }
  | { kind: 'ai'; backToSettings: boolean };

function createEmptyVault(name: string): Vault {
  const now = new Date().toISOString();

  return {
    format: 'terminus-vault',
    version: 2,

    id: crypto.randomUUID(),
    name: name.trim(),

    createdAt: now,
    updatedAt: now,

    nodes: [],
    workspaces: [],
    settings: {
      theme: 'dark',
      autoLockMinutes: 15,
      confirmBeforeClosingSession: true,
    },
  };
}

const notifySessionLimit = (): void => { const { title, body } = sessionLimitNotice(); notify.info(title, { body }); };
const notifyDisabled = (node: ConnectionNode): void => { notify.info(disabledTitle(), { body: disabledNotice(node) }); };

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
const isVaultFileName = (name: string): boolean => /\.(term|terminus)$/i.test(name);

function countConnections(nodes: VaultNode[]): number {
  return nodes.reduce((count, node) => {
    if (node.type === 'connection') {
      return count + 1;
    }

    return count + countConnections(node.children);
  }, 0);
}

export default function App() {
  const { t } = useT();
  const [version, setVersion] = useState('…');
  const [screen, setScreen] = useState<Screen>('home');
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const assistant = useAssistantToggle();
  const [appDialog, setAppDialog] = useState<AppDialog | null>(null);
  const settingsReturnFocus = useRef<HTMLElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [workflowEditor, setWorkflowEditor] = useState<{ initial?: Partial<Workflow> } | null>(null);
  useCtrlShiftShortcut('Space', () => { if (screenRef.current === 'vault' && !lockedRef.current) setPaletteOpen(open => !open); });

  const [vault, setVault] = useState<Vault | null>(null);
  const [vaultPath, setVaultPath] = useState<string | null>(
    null,
  );

  const [vaultName, setVaultName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] =
    useState('');

  // Start-card errors stay inline; background events go through notify.
  const [formError, setFormError] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [selectedVaultPath, setSelectedVaultPath] = useState('');

  const [showFolderForm, setShowFolderForm] =
    useState(false);

  const [folderName, setFolderName] =
    useState('');
  const terminals = useTerminalTabs();
  // Live view of each open cluster tab, saved with workspaces; a restored tab keeps its saved view on the tab itself.
  const kubeViews = useRef(new Map<string, KubeViewSnapshot>());
  const saveKubeView = useCallback((tabId: string, view: KubeViewSnapshot) => { kubeViews.current.set(tabId, view); }, []);
  // Prefilled cluster that the connection form saves as a new connection.
  const [clusterDraft, setClusterDraft] = useState<KubernetesConnectionNode | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const terminalLayout = useTerminalLayout(terminals.tabs, terminals.activeTabId);
  const transfer = useTabTransfer(terminals, terminalLayout);
  const viewControls = useViewControls(terminalLayout, terminals.select, transfer.transferView);
  // Announce readiness after the transfer listeners above are registered.
  useEffect(() => { void window.desktopApi.windowReady(); }, []);
  const containerDiscovery = useContainerDiscovery();
  // Bumped on every lock; a save that settles under another epoch must not bring the vault back.
  const lockEpoch = useRef(0);
  const getLockEpoch = useCallback(() => lockEpoch.current, []);
  // The lock screen state; the ref is set synchronously so afterLock stays idempotent.
  const [locked, setLockedState] = useState<LockState | null>(null);
  const lockedRef = useRef<LockState | null>(null);
  const setLocked = (value: LockState | null): void => { lockedRef.current = value; setLockedState(value); };
  const lockReturnFocus = useRef<HTMLElement | null>(null);
  // While locked, the redacted vault must never reach the disk.
  const persistVault = usePersistVault(locked ? null : vault, { setVault, setVaultPath, setBusy, setSaved, epoch: getLockEpoch });
  const vaultId = vault?.id;
  const { load: loadContainers } = containerDiscovery;
  // Local discovery once per unlocked vault.
  useEffect(() => { if (vaultId) void loadContainers(LOCAL_CONTAINER_HOST); }, [vaultId, loadContainers]);
  const [pendingSshAction, setPendingSshAction] = useState<
    { type: 'closeTab'; tabId: string } | { type: 'openWorkspace'; workspaceId: string } | { type: 'closeWorkspace' } | null
  >(null);
  const pendingTab = pendingSshAction?.type === 'closeTab' ? terminals.tabs.find(tab => tab.id === pendingSshAction.tabId) : undefined;
  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);
  const closeNewMenu = useCallback(() => setNewMenu(null), []);
  const [newConnectionTarget, setNewConnectionTarget] = useState<{ protocol: ConnectionProtocol; parentId: string | null }>({ protocol: 'ssh', parentId: null });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNode = vault && selectedNodeId
    ? findNode(vault.nodes, selectedNodeId)
    : undefined;
  const canCreateFolder = selectedNodeId === null || selectedNode?.type === 'folder';

  // Vault files opened from Explorer: at start and while Shellherd runs.
  const screenRef = useRef(screen);
  screenRef.current = screen;

  function openSettings(instant: boolean): void {
    settingsReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAppDialog({ kind: 'settings', instant, focus: 'close' });
  }
  function closeDialogs(): void {
    setAppDialog(null);
    const target = settingsReturnFocus.current;
    settingsReturnFocus.current = null;
    if (target) requestAnimationFrame(() => { if (target.isConnected) target.focus(); });
  }
  useCtrlShortcut('Comma', () => {
    const open = [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')].map(item => item.className);
    const action = settingsShortcutAction(appDialog?.kind === 'settings', busy, open);
    if (action === 'open') openSettings(true); else if (action === 'close') closeDialogs();
  });
  // Explorer and drag and drop: an open vault is locked first, after a confirmation.
  const [pendingVaultFile, setPendingVaultFile] = useState<string | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const openVaultFile = (filePath: string): void => {
    if (screenRef.current === 'vault') { setPendingVaultFile(filePath); return; }
    navigateTo('open');
    setSelectedVaultPath(filePath);
  };
  const openVaultFileRef = useRef(openVaultFile);
  openVaultFileRef.current = openVaultFile;
  useEffect(() => {
    const open = (filePath: string): void => openVaultFileRef.current(filePath);
    // A file from Explorer wins; otherwise the start goes straight to the vault opened last.
    void window.desktopApi.vaultLaunchFile().then(async filePath => {
      if (filePath) { open(filePath); return; }
      const last = await window.desktopApi.lastVaultFile();
      if (last && screenRef.current === 'home') open(last);
    }).catch(() => {});
    return window.desktopApi.onVaultOpenFile(open);
  }, []);
  // The open screen preselects the vault opened last; "Andere Vault-Datei auswählen" still changes it.
  useEffect(() => {
    if (screen !== 'open' || selectedVaultPath) return;
    let current = true;
    void window.desktopApi.lastVaultFile().then(filePath => { if (current && filePath) setSelectedVaultPath(previous => previous || filePath); }).catch(() => {});
    return () => { current = false; };
  }, [screen, selectedVaultPath]);
  // Files dropped anywhere the page does not handle them itself (the SFTP server side does).
  useEffect(() => {
    const hasFiles = (event: DragEvent): boolean => Boolean(event.dataTransfer?.types.includes('Files'));
    const over = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      setFileDragActive(true);
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
    };
    const leave = (event: DragEvent): void => { if (!event.relatedTarget) setFileDragActive(false); };
    const drop = (event: DragEvent): void => {
      setFileDragActive(false);
      if (!hasFiles(event) || event.defaultPrevented) return;
      event.preventDefault();
      const file = [...event.dataTransfer!.files].find(item => isVaultFileName(item.name));
      const path = file ? window.desktopApi.pathForFile(file) : '';
      if (path) openVaultFileRef.current(path);
      else notify.info(t('app:notices.notVaultFileTitle'), { body: t('app:errors.onlyVaultFiles') });
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('dragend', leave);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('dragend', leave);
    };
  }, [t]);
  const vaultFileDialog = pendingVaultFile && <ConfirmDialog title={t('app:openVaultFile.title', { name: fileName(pendingVaultFile) })}
    description={t(terminals.hasRunning ? 'app:openVaultFile.descriptionRunning' : 'app:openVaultFile.description')}
    confirmLabel={t('app:openVaultFile.confirm')} destructive={terminals.hasRunning} busy={busy}
    onCancel={() => setPendingVaultFile(null)} onConfirm={() => {
      const filePath = pendingVaultFile;
      setPendingVaultFile(null);
      switchVault(filePath);
    }} />;
  const fileDropHint = fileDragActive && <div className="file-drop-hint" aria-hidden="true">{t('app:fileDrop.hint')}</div>;

  useEffect(() => {
    void window.desktopApi
      .getVersion()
      .then(setVersion)
      .catch(() => setVersion(t('app:version.unknown')));
  }, []);

  function resetForm(): void {
    setEditorOpen(false);
    setEditorDirty(false);
    setPendingNavigation(null);
    setActiveWorkspaceId(null);
    setSaved(false);
    setShowPassword(false);
    setVaultName('');
    setPassword('');
    setPasswordConfirmation('');
    setSelectedVaultPath('');
    setSelectedNodeId(null);
    setFolderName('');
    setShowFolderForm(false);
    setShowConnectionForm(false);
    terminals.reset();
    setDraggedTabId(null);
    terminalLayout.reset();
    setPendingSshAction(null);
    setFormError(null);
    setFolderError(null);
    clearNotices();
  }

  function navigateTo(nextScreen: Screen): void {
    resetForm();
    setScreen(nextScreen);
  }

  async function handleCreateVault(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setFormError(null);

    if (!vaultName.trim()) {
      setFormError(t('app:errors.vaultNameRequired'));
      return;
    }

    if (password.length < 8) {
      setFormError(t('app:errors.passwordTooShort'));
      return;
    }

    if (password !== passwordConfirmation) {
      setFormError(t('app:errors.passwordMismatch'));
      return;
    }

    const newVault = createEmptyVault(vaultName);

    setBusy(true);

    try {
      const result = await window.desktopApi.saveVault({
        vault: newVault,
        password,
        suggestedName: `${vaultName.trim()}.term`,
      });

      if (result.canceled) {
        return;
      }

      setVault(newVault);
      setVaultPath(result.filePath);
      setScreen('vault');
      resetForm();
      terminals.open(welcomeConnection());   // after reset: never reuse a tab of the old state
    } catch (caughtError) {
      setFormError(errorText(caughtError, t('app:errors.vaultFailed')));
    } finally {
      setPassword('');
      setPasswordConfirmation('');
      setBusy(false);
    }
  }

  async function handleOpenVault(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setFormError(null);

    if (!selectedVaultPath) {
      setFormError(t('app:errors.vaultFileRequired'));
      return;
    }

    if (!password) {
      setFormError(t('app:errors.passwordRequired'));
      return;
    }

    setBusy(true);

    try {
      const result = await window.desktopApi.unlockVault({
        filePath: selectedVaultPath,
        password,
      });

      openFresh(result);
    } catch (caughtError) {
      setFormError(errorText(caughtError, t('app:errors.vaultFailed')));
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  async function handleSelectVaultFile(): Promise<void> {
    setFormError(null);
    setBusy(true);

    try {
      const result =
        await window.desktopApi.selectVaultFile();

      if (result.canceled) {
        return;
      }

      setSelectedVaultPath(result.filePath);
    } catch (caughtError) {
      setFormError(errorText(caughtError, t('app:errors.vaultFileSelectFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateFolder(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setFolderError(null);

    if (!vault || busy) {
      return;
    }

    if (!canCreateFolder) {
      setFolderError(t('app:errors.folderTargetRequired'));
      folderInput.current?.focus();
      return;
    }

    const name = folderName.trim();

    if (!name) {
      setFolderError(t('app:errors.folderNameRequired'));
      folderInput.current?.focus();
      return;
    }

    const folder: FolderNode = {
      id: crypto.randomUUID(),
      type: 'folder',
      name,
      children: [],
    };

    const updatedVault: Vault = {
      ...vault,
      nodes: addNode(
        vault.nodes,
        folder,
        selectedNodeId ?? undefined,
      ),
    };

    if (await persistVault(updatedVault)) {
      setFolderName('');
      setShowFolderForm(false);
    }
  }

  async function saveFolder(name: string, comment: string): Promise<boolean> {
    if (!vault || busy || selectedNode?.type !== 'folder') return false;
    return persistVault({
      ...vault,
      nodes: updateNode(vault.nodes, selectedNode.id, (node) => {
        const rest = { ...node };
        delete rest.comment;
        return { ...rest, name: name.trim(), ...(comment.trim() ? { comment: comment.trim() } : {}) };
      }),
    });
  }

  async function deleteSelectedNode(): Promise<boolean> {
    if (!vault || busy || !selectedNode) return false;
    const updated = removeNodeFromVault(vault, selectedNode.id);
    const saved = await persistVault(updated);
    if (saved) {
      terminals.retainConnections(terminals.tabs.filter(tab => findNode(updated.nodes, tab.connection.id)?.type === 'connection').map(tab => tab.connection.id));
      setSelectedNodeId(null);
      setEditorOpen(false);
      setEditorDirty(false);
    }
    return saved;
  }

  const saveAutoUpload = (connectionId: string, bindings: AutoUploadBinding[]): Promise<boolean> => !vault ? Promise.resolve(false)
    : persistVault({ ...vault, nodes: updateNode(vault.nodes, connectionId, node => {
      if (node.type !== 'connection' || (node.protocol !== 'ssh' && node.protocol !== 'sftp')) return node;
      const { autoUpload: _old, ...rest } = node;
      return bindings.length ? { ...rest, autoUpload: bindings } : rest;
    }) }, t('files:sync.notSaved'));

  async function saveConnection(connection: ConnectionNode, parentId: string): Promise<boolean> {
    if (!vault || busy) return false;
    const existing = findNode(vault.nodes, connection.id);
    connection = keepAutoUpload(connection, existing);
    const nodes = existing
      ? parentFolderId(vault.nodes, connection.id) === parentId
        ? updateNode(vault.nodes, connection.id, () => connection)
        : addNode(removeNode(vault.nodes, connection.id), connection, parentId || undefined)
      : addNode(vault.nodes, connection, parentId || undefined);
    const saved = await persistVault({ ...vault, nodes });
    if (saved) {
      setShowConnectionForm(false);
      setSelectedNodeId(connection.id);
      setEditorDirty(false);
    }
    return saved;
  }

  function requestCloseTab(tabId: string): void {
    const tab = terminals.tabs.find(tab => tab.id === tabId);
    if (!tab || busy) return;
    if (isRunning(tab) && vault?.settings.confirmBeforeClosingSession) setPendingSshAction({ type: 'closeTab', tabId });
    else terminals.close(tabId);
  }

  async function saveWorkspace(name: string, id?: string): Promise<string | null> {
    if (!vault || busy || !name.trim()) return null;
    const existing = vault.workspaces.find(workspace => workspace.id === id);
    const windows = await window.desktopApi.workspaceWindows().catch(() => []);
    const { windows: _windows, views: _views, ...rest } = existing ?? {};
    const workspace = { ...rest, id: existing?.id ?? crypto.randomUUID(), name: name.trim(),
      ...toWorkspaceViews(terminalLayout.viewsState, tabsWithKubeViews()), ...(windows.length ? { windows } : {}) };
    const workspaces = upsertWorkspace(vault.workspaces, workspace);
    if (!await persistVault({ ...vault, workspaces }, t('app:notices.workspaceNotSaved'))) return null;
    setActiveWorkspaceId(workspace.id);
    notify.ok(t('app:notices.workspaceSaved', { name: workspace.name }), { body: workspaceSummary(workspace) });
    return workspace.id;
  }

  async function renameWorkspace(id: string, name: string): Promise<boolean> {
    if (!vault || busy || !name.trim()) return false;
    const existing = vault.workspaces.find(item => item.id === id);
    if (!existing) return false;
    return persistVault({ ...vault, workspaces: upsertWorkspace(vault.workspaces, { ...existing, name: name.trim() }) }, t('app:notices.workspaceNotSaved'));
  }

  async function deleteWorkspace(id: string): Promise<boolean> {
    if (!vault || busy) return false;
    const saved = await persistVault({ ...vault, workspaces: removeWorkspace(vault.workspaces, id) }, t('app:notices.workspaceNotDeleted'));
    if (saved && id === activeWorkspaceId) setActiveWorkspaceId(null);
    return saved;
  }

  function openWorkspace(id: string, confirmed = false): void {
    if (!vault || busy) return;
    const workspace = vault.workspaces.find(item => item.id === id);
    if (!workspace) return;
    try {
      const restored = fromWorkspaceViews(workspace, connectionId => {
        const node = findNode(vault.nodes, connectionId);
        return node?.type === 'connection' ? node : undefined;
      }, () => crypto.randomUUID());
      if (!confirmed && terminals.hasRunning && vault.settings.confirmBeforeClosingSession) {
        setPendingSshAction({ type: 'openWorkspace', workspaceId: id });
        return;
      }
      void window.desktopApi.closeSecondaryWindows().then(() => window.desktopApi.openWorkspaceWindows(workspace.windows ?? []))
        .catch(() => notify.error(t('app:notices.windowNotRestored'), { body: t('app:errors.workspaceWindows') }));
      terminalLayout.replaceViews(restored.state);
      terminals.restore(restored.tabs, restored.activeTabId);
      setActiveWorkspaceId(id);
      setEditorOpen(false);
      if (restored.skipped) notify.info(t('app:notices.skippedTitle'), { body: skippedNotice(restored.skipped) });
    } catch (caughtError) {
      notify.error(t('app:notices.workspaceNotOpened'), { body: errorText(caughtError, t('app:errors.workspaceOpenFailed')) });
    }
  }

  function closeWorkspace(confirmed = false): void {
    if (busy) return;
    if (!confirmed && terminals.hasRunning && vault?.settings.confirmBeforeClosingSession) {
      setPendingSshAction({ type: 'closeWorkspace' });
      return;
    }
    terminals.reset();
    terminalLayout.reset();
    void window.desktopApi.closeSecondaryWindows().catch(() => {});
    setActiveWorkspaceId(null);
  }

  async function lockVault(): Promise<void> {
    setBusy(true);
    try {
      await window.desktopApi.lockVault();
    } finally {
      setBusy(false);
      afterLock();
    }
  }

  // Shared by the manual lock and the main process's auto-lock; sessions, tabs and form drafts stay.
  function afterLock(minutes?: number): void {
    if (lockedRef.current || screenRef.current !== 'vault' || !vault) return;   // idempotent; ignores late events
    lockEpoch.current += 1;
    lockReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLocked({ minutes, vaultId: vault.id });
    setVault(current => current && redactVault(current));
    setAppDialog(null); settingsReturnFocus.current = null; setPaletteOpen(false);
    // A clean editor holds the connection's stored secret in its draft; a dirty one is the user's unsaved input and stays.
    if (!editorDirty) setEditorOpen(false);
  }
  const afterLockRef = useRef(afterLock);
  afterLockRef.current = afterLock;
  useEffect(() => window.desktopApi.onVaultLocked(info => afterLockRef.current(info.minutes)), []);

  async function unlockFromLock(password: string): Promise<void> {
    const current = lockedRef.current;
    if (!current || !vaultPath) throw new AppError('core.vaultFileMissing');
    const result = await window.desktopApi.unlockVault({ filePath: vaultPath, password });
    if (result.vault.id !== current.vaultId) { openFresh(result); return; }   // main already ended the old sessions
    setVault(result.vault); setVaultPath(result.filePath); setSaved(false);
    // Tabs of connections deleted elsewhere close, the same filter as deleteSelectedNode.
    terminals.retainConnections(terminals.tabs.filter(tab => findNode(result.vault.nodes, tab.connection.id)?.type === 'connection').map(tab => tab.connection.id));
    if (selectedNodeId && !findNode(result.vault.nodes, selectedNodeId)) { setSelectedNodeId(null); setEditorOpen(false); setEditorDirty(false); }
    if (activeWorkspaceId && !result.vault.workspaces.some(item => item.id === activeWorkspaceId)) setActiveWorkspaceId(null);
    setLocked(null);
    requestAnimationFrame(() => { const target = lockReturnFocus.current; lockReturnFocus.current = null; if (target?.isConnected) target.focus(); });
  }

  function openFresh(result: UnlockVaultResult): void {
    lockEpoch.current += 1; setLocked(null);
    setVault(result.vault); setVaultPath(result.filePath); setScreen('vault'); resetForm();
    terminals.open(welcomeConnection());   // after reset: never reuse a tab of the old state
  }

  function switchVault(filePath?: string): void {
    lockEpoch.current += 1;   // a save in flight must not bring the old vault back on the open screen
    void window.desktopApi.lockVault({ disconnect: true }).catch(() => {});
    setLocked(null); setPendingVaultFile(null); setVault(null); setVaultPath(null); navigateTo('open');
    if (filePath) setSelectedVaultPath(filePath); else void handleSelectVaultFile();
  }

  function openWelcome(paneId: string): void {
    terminalLayout.setFocused(paneId);
    const open = reusableTab(terminals.tabs, terminals.activeTabId, welcomeConnection());
    if (open) terminals.select(open.id);
    else if (terminals.tabs.length >= MAX_SSH_SESSIONS) notifySessionLimit();
    else terminals.open(welcomeConnection());
  }

  function navigateEditor(action: () => void): void {
    if (busy) return;
    if (editorOpen && editorDirty) setPendingNavigation(() => action);
    else action();
  }

  function editNode(id: string): void {
    navigateEditor(() => { setSelectedNodeId(id); setShowConnectionForm(false); setEditorOpen(true); setEditorDirty(false); });
  }
  // The error card of a terminal asks for the connection editor (B6).
  const editNodeRef = useRef(editNode);
  editNodeRef.current = editNode;
  useEffect(() => onEditRequest(id => editNodeRef.current(id)), []);

  /** Tabs with the live view of each cluster tab, for saving a workspace. */
  function tabsWithKubeViews(): TerminalTab[] {
    return terminals.tabs.map(tab => kubeViews.current.has(tab.id) ? { ...tab, kubeView: kubeViews.current.get(tab.id) } : tab);
  }

  /** Pod logs or shell detached from a cluster tab: a tab of its own, subject to the session limit. */
  function openPopout(connection: TerminalConnection): void {
    if (terminals.tabs.length >= MAX_SSH_SESSIONS) { notifySessionLimit(); return; }
    terminals.open(connection);
  }

  /** Probes the cluster through an SSH connection, then opens the new-cluster form prefilled in the same folder. */
  async function setupCluster(sshId: string): Promise<void> {
    const ssh = vault ? findNode(vault.nodes, sshId) : undefined;
    if (!vault || busy || ssh?.type !== 'connection' || ssh.protocol !== 'ssh') return;
    if (ssh.disabled) { notifyDisabled(ssh); return; }
    const probe = await window.desktopApi.kubeProbe({ connectionId: sshId }).catch((caught: unknown): KubeProbeResult | null => {
      notify.error(t('app:notices.clusterNotChecked'), { body: errorText(caught, t('app:errors.clusterProbeFailed')) });
      return null;
    });
    if (!probe) return;
    const draft = newClusterFromSsh(ssh, vault.nodes, probe, crypto.randomUUID());
    navigateEditor(() => {
      setClusterDraft(draft);
      setNewConnectionTarget({ protocol: 'kubernetes', parentId: parentFolderId(vault.nodes, sshId) ?? '' });
      setShowConnectionForm(true); setEditorOpen(true); setEditorDirty(false); setShowFolderForm(false);
      setEditorRevision(value => value + 1);
    });
  }

  /** parentId: target folder ('' = vault root); undefined uses the current selection. */
  function newConnection(protocol: ConnectionProtocol = 'ssh', parentId?: string): void {
    navigateEditor(() => {
      setClusterDraft(null);
      setNewConnectionTarget({ protocol, parentId: parentId ?? null });
      setShowConnectionForm(true); setEditorOpen(true); setEditorDirty(false); setShowFolderForm(false);
    });
  }

  function newFolder(parentId: string): void {
    navigateEditor(() => {
      setSelectedNodeId(parentId || null); setShowConnectionForm(false); setEditorOpen(false); setEditorDirty(false);
      setFolderName(''); setFolderError(null); setShowFolderForm(true);
    });
  }

  function connectNode(id: string, paneId?: string, asFiles = false): void {
    const node = vault && findNode(vault.nodes, id);
    if (!node || node.type !== 'connection') return;
    if (node.disabled) { notifyDisabled(node); return; }
    navigateEditor(() => {
      if (terminals.tabs.length >= MAX_SSH_SESSIONS) { notifySessionLimit(); return; }
      if (paneId) terminalLayout.setFocused(paneId);
      terminals.open(toTerminalConnection(node, asFiles)); setEditorOpen(false); setEditorDirty(false);
    });
  }

  function openContainer(hostId: string, item: DiscoveredItem, mode: TerminalTargetMode): void {
    const host = hostId === LOCAL_CONTAINER_HOST ? undefined : vault && findNode(vault.nodes, hostId);
    if (hostId !== LOCAL_CONTAINER_HOST && host?.type !== 'connection') return;
    if (host?.type === 'connection' && host.disabled) { notifyDisabled(host); return; }
    navigateEditor(() => {
      if (terminals.tabs.length >= MAX_SSH_SESSIONS) { notifySessionLimit(); return; }
      const name = host?.type === 'connection' ? host.name : t('common:thisComputer');
      const address = host?.type === 'connection' ? connectionAddress(host) : t('app:localAddress');
      terminals.open(containerConnection(hostId, name, address, { item: toTarget(item), mode }));
      setEditorOpen(false); setEditorDirty(false);
    });
  }

  function openContainerView(hostId: string, runtime?: ContainerRuntime, reuse = false): void {
    const host = hostId === LOCAL_CONTAINER_HOST ? undefined : vault && findNode(vault.nodes, hostId);
    if (hostId !== LOCAL_CONTAINER_HOST && !(host?.type === 'connection' && host.protocol === 'ssh')) return;
    if (host?.type === 'connection' && host.disabled) { notifyDisabled(host); return; }
    navigateEditor(() => {
      const name = host?.type === 'connection' ? host.name : t('common:thisComputer');
      const address = host?.type === 'connection' ? connectionAddress(host) : t('app:localAddress');
      const connection = containerViewConnection(hostId, name, address, runtime);
      const plan = planContainerView(terminals.tabs, terminals.activeTabId, connection, reuse);
      if (plan.kind === 'focus') { terminals.select(plan.tabId); setEditorOpen(false); setEditorDirty(false); return; }
      if (plan.kind === 'limit') { notifySessionLimit(); return; }
      terminals.open(connection);
      setEditorOpen(false); setEditorDirty(false);
    });
  }

  const containerTree: ContainerTreeProps = {
    state: containerDiscovery.state,
    onExpand: id => void containerDiscovery.load(id),
    onOpenView: (id, runtime, newTab) => openContainerView(id, runtime, !newTab),
    onOpen: openContainer,
    onAction: (id: string, item: DiscoveredItem, action: ContainerAction, confirm?: string) => { if (!confirm || window.confirm(confirm)) void containerDiscovery.act(id, item, action); },
  };

  /** Opens every connection inside a folder (and its subfolders) as tabs, up to the session limit. */
  function connectFolder(folderId: string): void {
    const folder = vault && findNode(vault.nodes, folderId);
    if (!folder || folder.type !== 'folder') return;
    const { connections, disabled } = connectionsIn(folder.children);
    if (!connections.length) { notify.info(t('app:notices.nothingToConnect'), { body: disabled ? t('app:folder.allDisabled', { name: folder.name }) : t('app:folder.empty', { name: folder.name }) }); return; }
    navigateEditor(() => {
      const free = MAX_SSH_SESSIONS - terminals.tabs.length;
      for (const connection of connections.slice(0, Math.max(0, free))) terminals.open(toTerminalConnection(connection));
      setEditorOpen(false); setEditorDirty(false);
      if (connections.length > free) {
        if (free > 0) notify.info(t('app:notices.partialTitle', { opened: free, count: connections.length }),
          { body: disabled ? t('app:notices.partialBodySkipped', { max: MAX_SSH_SESSIONS, skipped: skippedNotice(disabled) }) : t('app:notices.partialBody', { max: MAX_SSH_SESSIONS }) });
        else notify.info(t('app:notices.noneOpenedTitle'), { body: sessionLimitText() });
      } else if (disabled) notify.info(t('app:notices.skippedTitle'), { body: skippedNotice(disabled) });
    });
  }

  async function saveAndConnect(connection: ConnectionNode, parentId: string): Promise<boolean> {
    if (terminals.tabs.length >= MAX_SSH_SESSIONS) { notifySessionLimit(); return false; }
    if (!await saveConnection(connection, parentId)) return false;
    if (connection.disabled) { setEditorOpen(false); setEditorDirty(false); notifyDisabled(connection); return true; }
    terminals.open(toTerminalConnection(connection)); setEditorOpen(false); setEditorDirty(false); return true;
  }

  async function moveTreeNode(id: string, target: NodeDropTarget): Promise<void> {
    if (!vault || busy) return;
    let nodes: VaultNode[];
    try { nodes = moveNode(vault.nodes, id, target); }
    catch (caught) { notify.error(t('app:notices.notMoved'), { body: errorText(caught, t('app:errors.moveFailed')) }); return; }
    if (nodes !== vault.nodes) await persistVault({ ...vault, nodes });
  }

  async function toggleDisabled(id: string): Promise<boolean> {
    if (!vault || busy) return false;
    return persistVault({ ...vault, nodes: updateNode(vault.nodes, id, node => {
      if (node.type !== 'connection') return node;
      const { disabled: _disabled, ...rest } = node;
      return node.disabled ? rest : { ...rest, disabled: true };
    }) });
  }

  async function renameNode(id: string, name: string): Promise<boolean> {
    if (!vault || busy || !name.trim()) return false;
    return persistVault({ ...vault, nodes: updateNode(vault.nodes, id, node => ({ ...node, name: name.trim() })) });
  }

  const settingsVault = screen === 'vault' ? vault : null;
  const settingsDialog = appDialog?.kind === 'settings' && <SettingsDialog vault={settingsVault} busy={busy}
    instant={appDialog.instant} initialFocus={appDialog.focus} onClose={closeDialogs}
    onManageAi={() => { if (settingsVault) setAppDialog({ kind: 'ai', backToSettings: true }); }}
    onSaveSettings={settings => settingsVault ? persistVault({ ...settingsVault, settings }) : Promise.resolve(false)} />;

  if (screen === 'vault' && vault) {
    const connectionCount = countConnections(vault.nodes);
    const activeWorkspace = vault.workspaces.find(item => item.id === activeWorkspaceId);
    const currentViews = toWorkspaceViews(terminalLayout.viewsState, tabsWithKubeViews());
    const workspaceDirty = activeWorkspace
      ? JSON.stringify([activeWorkspace.layout, activeWorkspace.views]) !== JSON.stringify([currentViews.layout, currentViews.views])
      : terminals.tabs.some(tab => !isWelcomeTab(tab));
    const runningCount = terminals.tabs.filter(isRunning).length;
    const closeEditor = () => navigateEditor(() => { setEditorOpen(false); setEditorDirty(false); });
    return <>
    <main className="vault-shell" inert={locked !== null}>
      {vaultFileDialog}{fileDropHint}
      <header className="app-header">
        <button className="icon-button sidebar-toggle" type="button" aria-label={sidebarCollapsed ? t('app:header.sidebarShow') : t('app:header.sidebarHide')}
          aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed(value => !value)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>
        </button>
        <div className="header-vault" title={vaultPath ?? undefined}><img className="brand-icon" src={mark} alt="" /><span className="brand-word">Shellherd</span><strong>{vault.name}</strong></div>
        <WorkspaceControls workspaces={vault.workspaces} busy={busy} hasTabs={terminals.tabs.some(tab => !isWelcomeTab(tab))}
          activeId={activeWorkspaceId} dirty={workspaceDirty} onSave={saveWorkspace}
          onOpen={id => navigateEditor(() => openWorkspace(id))} onRename={renameWorkspace} onDelete={deleteWorkspace}
          onClose={() => navigateEditor(() => closeWorkspace())} />
        <button className="secondary-button" type="button" title={t('app:header.workflowsTitle', { shortcut: t('common:shortcuts.palette') })} onClick={() => setPaletteOpen(true)}>{t('app:header.workflows')}</button>
        <button className="secondary-button assistant-toggle" type="button" aria-pressed={assistant.open} title={t('app:header.assistantTitle', { shortcut: t('common:shortcuts.assistant') })}
          onClick={assistant.toggle}>{t('app:header.assistant')}</button>
        <button className="secondary-button lock-button" type="button" disabled={busy} onClick={() => void lockVault()}>{t('app:header.lock')}</button>
        <button className="icon-button settings-button" type="button" aria-haspopup="dialog" aria-label={t('app:header.settings')}
          title={t('app:header.settingsTitle', { shortcut: t('common:shortcuts.settings') })} onClick={() => openSettings(false)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>
        </button>
      </header>
      {pendingNavigation && <ConfirmDialog title={t('app:dialogs.unsaved.title')} description={t('app:dialogs.unsaved.description')}
        confirmLabel={t('app:dialogs.unsaved.confirm')} busy={busy} onCancel={() => setPendingNavigation(null)} onConfirm={() => {
          const action = pendingNavigation; setPendingNavigation(null); setEditorDirty(false); setEditorRevision(value => value + 1); action();
        }} />}
      {pendingSshAction && <ConfirmDialog
        title={pendingSshAction.type === 'openWorkspace' ? t('app:dialogs.replaceWorkspace') : pendingSshAction.type === 'closeWorkspace' ? t('app:dialogs.closeWorkspace')
          : t('app:dialogs.closeTab.title', { name: pendingTab ? tabLabel(pendingTab, terminals.tabs) : t('app:dialogs.closeTab.fallbackName') })}
        description={pendingSshAction.type === 'closeTab' ? t('app:dialogs.closeTab.description') : t('app:dialogs.endConnections', { count: runningCount })}
        confirmLabel={pendingSshAction.type === 'openWorkspace' ? t('app:dialogs.confirmReplace') : t('app:dialogs.confirmDisconnect')}
        busy={busy} onCancel={() => setPendingSshAction(null)} onConfirm={() => {
          const action = pendingSshAction; setPendingSshAction(null);
          if (action.type === 'openWorkspace') openWorkspace(action.workspaceId, true);
          else if (action.type === 'closeWorkspace') closeWorkspace(true);
          else terminals.close(action.tabId);
        }} />}
      <div className="vault-content">
        <ResizableSidebar collapsed={sidebarCollapsed}>
          <div className="sidebar-heading"><span>{t('app:sidebar.connections')} <span className="connection-count">{connectionCount}</span></span>
            <button className="new-node-button" type="button" aria-haspopup="menu" aria-expanded={newMenu !== null} disabled={busy}
              onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect();
                setNewMenu(newMenu ? null : { x: rect.left, y: rect.bottom + 4 });
              }}>{t('app:sidebar.new')}</button>
            {newMenu && <ContextMenu x={newMenu.x} y={newMenu.y} label={t('app:sidebar.newMenu')} onClose={closeNewMenu} entries={[
              { kind: 'heading', label: t('app:sidebar.newConnection') },
              ...NEW_CONNECTION_KINDS.map((item): ContextMenuEntry => item.planned
                ? { kind: 'item', label: protocolLabel(item.protocol), hint: t('common:planned'), disabled: true, onSelect: () => {} }
                : { kind: 'item', label: protocolLabel(item.protocol), onSelect: () => newConnection(item.protocol as ConnectionProtocol) }),
              { kind: 'separator' },
              { kind: 'item', label: t('app:sidebar.newFolder'), disabled: !canCreateFolder, onSelect: () => setShowFolderForm(true) },
            ]} />}
          </div>
          <button className="root-row" type="button" disabled={busy} aria-pressed={selectedNodeId === null}
            onClick={() => navigateEditor(() => { setSelectedNodeId(null); setShowConnectionForm(false); setEditorOpen(false); setEditorDirty(false); })}>{t('app:sidebar.all')}</button>
          {showFolderForm && <form className="sidebar-create-form" onSubmit={handleCreateFolder}>
            <label>{t('app:sidebar.folderName')}<input ref={folderInput} autoFocus value={folderName} disabled={busy} aria-invalid={folderError ? true : undefined}
              aria-describedby={folderError ? 'folder-error' : undefined} onChange={event => { setFolderName(event.target.value); setFolderError(null); }} /></label>
            {folderError && <p className="field-error" id="folder-error" role="alert">{folderError}</p>}
            <span className="muted">{t('app:sidebar.folderIn', { name: selectedNode?.type === 'folder' ? selectedNode.name : vault.name })}</span>
            <div className="sidebar-form-actions"><button type="button" onClick={() => setShowFolderForm(false)} disabled={busy}>{t('common:actions.cancel')}</button>
              <button type="submit" disabled={busy || !canCreateFolder || !folderName.trim()}>{t('app:sidebar.create')}</button></div>
          </form>}
          <LocalContainers containers={containerTree} disabled={busy} onOpenView={id => openContainerView(id)} />
          <VaultTree nodes={vault.nodes} selectedNodeId={selectedNodeId} disabled={busy} containers={containerTree}
            onSelect={id => navigateEditor(() => { setSelectedNodeId(id); setShowConnectionForm(false); setEditorDirty(false); })}
            onConnect={connectNode} onOpenFiles={id => connectNode(id, undefined, true)} onConnectAll={connectFolder} onToggleDisabled={id => void toggleDisabled(id)} onMove={(id, target) => void moveTreeNode(id, target)} onEdit={editNode} onRename={renameNode} onNewConnection={newConnection} onNewFolder={newFolder} onSetupCluster={id => void setupCluster(id)} onOpenContainerView={id => openContainerView(id)} />
          {!vault.nodes.length && <div className="empty-state"><p>{t('app:sidebar.emptyText')}</p><button type="button" className="secondary-button" onClick={() => newConnection()}>{t('app:sidebar.emptyAction')}</button></div>}
        </ResizableSidebar>
        <section className={`workspace${editorOpen ? ' with-editor' : ''}`}>
          <div className="terminal-area">
            <SplitTerminalArea nodes={vault.nodes} onConnect={connectNode} tabs={terminals.tabs} selected={terminals.activeTabId} layout={terminalLayout.layout}
              draggedTabId={draggedTabId} onDrag={setDraggedTabId}
              focused={terminalLayout.focused} busy={busy} onLayout={terminalLayout.setLayout} onFocus={terminalLayout.setFocused}
              onSelect={terminals.select} onStatus={terminals.updateStatus} onClose={requestCloseTab}
              externalHover={transfer.externalHover} pendingDock={transfer.pendingDock} onDockHandled={transfer.clearPendingDock} onTearOff={transfer.tearOff}
              viewControls={viewControls} onPopout={openPopout} onSnapshot={saveKubeView} onSaveAutoUpload={saveAutoUpload} onWelcome={openWelcome}
              welcomePanel={<WelcomePage vaultName={vault.name} version={version} onShowReleaseNotes={() => setShowReleaseNotes(true)} connectionCount={connectionCount}
                workspaces={vault.workspaces} busy={busy} onNewConnection={protocol => newConnection(protocol)}
                onOpenWorkspace={id => navigateEditor(() => openWorkspace(id))} />} />
          </div>
          {editorOpen && <aside className="properties-panel" aria-label={t('app:properties.aria')}>
            <div className="properties-heading"><span>{editorDirty ? t('app:dialogs.unsaved.title') : t('app:properties.title')}</span>
              <button type="button" className="icon-button" aria-label={t('app:properties.closeEditor')} disabled={busy} onClick={closeEditor}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>
              </button></div>
            {showConnectionForm || selectedNode?.type === 'connection' ? <ConnectionForm
              key={`${showConnectionForm ? `new-${newConnectionTarget.protocol}-${newConnectionTarget.parentId ?? selectedNodeId ?? 'root'}` : selectedNode?.id}-${editorRevision}`}
              connection={showConnectionForm ? clusterDraft ?? undefined : selectedNode?.type === 'connection' ? selectedNode : undefined} isNew={showConnectionForm}
              nodes={vault.nodes}
              protocol={showConnectionForm ? newConnectionTarget.protocol : undefined}
              initialParentId={showConnectionForm ? newConnectionTarget.parentId ?? (selectedNode?.type === 'folder' ? selectedNode.id : '') : parentFolderId(vault.nodes, selectedNodeId ?? '') ?? ''}
              busy={busy} onDirtyChange={setEditorDirty} onConnect={showConnectionForm ? undefined : () => { if (selectedNode?.type === 'connection') connectNode(selectedNode.id); }}
              onSave={saveConnection} onSaveAndConnect={saveAndConnect} onCancel={closeEditor} onDelete={showConnectionForm ? undefined : deleteSelectedNode}
              onTest={connection => window.desktopApi.connectionTest(connection)}
              onPickKey={async () => { const result = await window.desktopApi.selectPrivateKeyFile(); return result.canceled ? null : result.filePath; }} />
              : selectedNode?.type === 'folder' ? <FolderEditor key={`${selectedNode.id}-${editorRevision}`} folder={selectedNode} busy={busy}
                onDirtyChange={setEditorDirty} onSave={saveFolder} onDelete={deleteSelectedNode} onCancel={closeEditor} /> : null}
          </aside>}
          {assistant.open && <AssistantPanel tabs={terminals.tabs} activeTabId={terminals.activeTabId} onClose={() => assistant.setOpen(false)}
            onManageProviders={() => setAppDialog({ kind: 'ai', backToSettings: false })} onSaveWorkflow={command => setWorkflowEditor({ initial: { command } })} />}
        </section>
      </div>
      {paletteOpen && <WorkflowPalette workflows={vault.workflows ?? []} tabs={terminals.tabs} activeTabId={terminals.activeTabId}
        onClose={() => setPaletteOpen(false)} onManage={() => { setPaletteOpen(false); setWorkflowEditor({}); }} />}
      {workflowEditor && <WorkflowsDialog workflows={vault.workflows ?? []} busy={busy} initial={workflowEditor.initial}
        onClose={() => setWorkflowEditor(null)} onSave={workflows => persistVault({ ...vault, workflows })} />}
      {appDialog?.kind === 'ai' && <AiSettingsDialog settings={vault.ai} busy={busy}
        onClose={() => appDialog.backToSettings ? setAppDialog({ kind: 'settings', instant: true, focus: 'manageAi' }) : closeDialogs()}
        onSave={settings => persistVault({ ...vault, ai: settings })} />}
      {settingsDialog}
      <ToastStack />
      <footer className="app-status"><span role="status">{busy ? t('common:status.saving') : saved ? t('app:status.saved') : t('app:status.open')}</span>
        <span>{t('app:status.activeSessions', { count: runningCount })}</span><span className="status-path" title={vaultPath ?? undefined}>{vaultPath}</span>
        <button type="button" className="version-button" title={t('app:status.whatsNew')} onClick={() => setShowReleaseNotes(true)}>v{version}</button></footer>
      {showReleaseNotes && <ReleaseNotesDialog version={version} onClose={() => setShowReleaseNotes(false)} />}
    </main>
    {locked && <LockScreen vaultName={vault.name} minutes={locked.minutes} running={runningCount} onUnlock={unlockFromLock} onSwitch={() => switchVault()} />}
    </>;
  }

  return (
    <main className="app-shell">
      {fileDropHint}
      <ToastStack />
      {settingsDialog}
      <section className="welcome-card">
        <div className="brand large-brand">
          <img className="brand-mark" src={mark} alt="" />
          <span>Shellherd</span>
        </div>

        {screen === 'home' && (
          <>
            <h1>{t('app:home.title')}</h1>

            <p className="subtitle">{t('app:home.subtitle')}</p>

            <div className="action-grid">
              <button
                className="secondary-button"
                type="button"
                onClick={() => navigateTo('create')}
              >
                {t('app:home.create')}
              </button>

              <button
                className="primary-button"
                type="button"
                onClick={() => navigateTo('open')}
              >
                {t('app:home.open')}
              </button>
            </div>

            <div className="status-row">
              <span className="status-dot" />
              <span>
                {t('app:home.crypto')}
              </span>
            </div>
          </>
        )}

        {screen === 'create' && (
          <form onSubmit={handleCreateVault}>
            <h2>{t('app:create.title')}</h2>

            <label>
              {t('app:create.name')}
              <input
                autoFocus
                value={vaultName}
                onChange={(event) =>
                  setVaultName(event.target.value)
                }
                placeholder={t('app:create.namePlaceholder')}
                disabled={busy}
              />
            </label>

            <label>
              {t('app:create.password')}
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                autoComplete="new-password"
                disabled={busy}
              />
            </label>

            <label>
              {t('app:create.passwordRepeat')}
              <input
                type={showPassword ? 'text' : 'password'}
                value={passwordConfirmation}
                onChange={(event) =>
                  setPasswordConfirmation(event.target.value)
                }
                autoComplete="new-password"
                disabled={busy}
              />
            </label>

            <p className="field-hint">{t('app:create.hint')}</p>
            <label className="password-toggle"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />{t('app:create.showPasswords')}</label>
            {formError && <div className="error-message" role="alert">{formError}</div>}

            <div className="form-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => navigateTo('home')}
              >
                {t('app:create.back')}
              </button>

              <button
                className="primary-button"
                type="submit"
                disabled={busy}
              >
                {busy
                  ? t('app:create.submitting')
                  : t('app:create.submit')}
              </button>
            </div>
          </form>
        )}

        {screen === 'open' && (
          <form onSubmit={handleOpenVault}>
            <h2>{t('app:open.title')}</h2>

            <p className="form-description">{t('app:open.description')}</p>

            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void handleSelectVaultFile()}
            >
              {selectedVaultPath
                ? t('app:open.selectOther')
                : t('app:open.selectFile')}
            </button>

            {selectedVaultPath && (
              <label>
                {t('app:open.selectedFile')}
                <input
                  value={selectedVaultPath}
                  readOnly
                  title={selectedVaultPath}
                />
              </label>
            )}

            <label>
              {t('app:open.password')}
              <input
                // With a preselected vault only the password is left to type.
                key={selectedVaultPath ? 'with-file' : 'without-file'}
                autoFocus={Boolean(selectedVaultPath)}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                autoComplete="current-password"
                disabled={busy}
              />
            </label>

            <label className="password-toggle"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />{t('app:open.showPassword')}</label>
            {formError && <div className="error-message" role="alert">{formError}</div>}

            <div className="form-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => navigateTo('home')}
              >
                {t('app:create.back')}
              </button>

              <button
                className="primary-button"
                type="submit"
                disabled={
                  busy ||
                  !selectedVaultPath ||
                  password.length === 0
                }
              >
                {busy
                  ? t('app:open.submitting')
                  : t('app:open.submit')}
              </button>
            </div>
          </form>
        )}

        <footer>Shellherd {version} · <button type="button" className="link-button" onClick={() => openSettings(false)}>{t('app:home.settings')}</button></footer>
      </section>
    </main>
  );
}
