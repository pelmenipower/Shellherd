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
import { ResizableSidebar } from './components/ResizableSidebar';
import { useTerminalTabs } from './hooks/useTerminalTabs';
import { containerConnection, isRunning, tabLabel, toTerminalConnection } from './terminal-tabs';
import { connectionAddress, connectionsIn, disabledNotice, NEW_CONNECTION_KINDS, skippedNotice } from '../../shared/vault/connections';
import { LOCAL_CONTAINER_HOST, toTarget } from '../../shared/containers';
import type { ContainerAction, DiscoveredItem, TerminalTargetMode } from '../../shared/containers';
import type { ContainerTreeProps } from './container-tree';
import { useContainerDiscovery } from './hooks/useContainerDiscovery';
import { LocalContainers } from './components/LocalContainers';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { SplitTerminalArea } from './components/SplitTerminalArea';
import { WorkspaceControls } from './components/WorkspaceControls';
import { useTerminalLayout } from './hooks/useTerminalLayout';
import { useTabTransfer } from './hooks/useTabTransfer';
import { useViewControls } from './hooks/useViewControls';
import { fromWorkspaceViews, toWorkspaceViews } from './terminal-views';
import { FileTypeSetting, WelcomePage } from './components/WelcomePage';
import { ReleaseNotesDialog } from './components/ReleaseNotes';
import { AssistantPanel } from './components/AssistantPanel';
import { AiSettingsDialog } from './components/AiSettingsDialog';
import { useAssistantToggle } from './hooks/useAssistantToggle';
import { useCtrlShiftShortcut } from './hooks/useShortcut';
import { WorkflowPalette } from './components/WorkflowPalette';
import { WorkflowsDialog } from './components/WorkflowsDialog';
import type { Workflow } from '../../shared/vault/types';
import { ConnectionForm } from './components/ConnectionForm';
import { parentFolderId } from './connection-form';
import { findNode } from './vault-selection';

type Screen = 'home' | 'create' | 'open' | 'vault';

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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (
      error.message.includes('authenticate') ||
      error.message.includes('Unsupported state')
    ) {
      return 'Das Passwort ist falsch oder die Vault-Datei wurde verändert.';
    }
  }

  return 'Der Vault konnte nicht verarbeitet werden.';
}

export default function App() {
  const [version, setVersion] = useState('…');
  const [screen, setScreen] = useState<Screen>('home');
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const assistant = useAssistantToggle();
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [workflowEditor, setWorkflowEditor] = useState<{ initial?: Partial<Workflow> } | null>(null);
  useCtrlShiftShortcut('Space', () => { if (screenRef.current === 'vault') setPaletteOpen(open => !open); });

  const [vault, setVault] = useState<Vault | null>(null);
  const [vaultPath, setVaultPath] = useState<string | null>(
    null,
  );

  const [vaultName, setVaultName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] =
    useState('');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const saveInProgress = useRef(false);

  const [selectedVaultPath, setSelectedVaultPath] = useState('');

  const [showFolderForm, setShowFolderForm] =
    useState(false);

  const [folderName, setFolderName] =
    useState('');
  const terminals = useTerminalTabs();
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const terminalLayout = useTerminalLayout(terminals.tabs, terminals.activeTabId);
  const transfer = useTabTransfer(terminals, terminalLayout, setError);
  const viewControls = useViewControls(terminalLayout, terminals.select, transfer.transferView);
  // Announce readiness after the transfer listeners above are registered.
  useEffect(() => { void window.desktopApi.windowReady(); }, []);
  const containerDiscovery = useContainerDiscovery();
  const vaultId = vault?.id;
  const { load: loadContainers } = containerDiscovery;
  // Local discovery once per unlocked vault.
  useEffect(() => { if (vaultId) void loadContainers(LOCAL_CONTAINER_HOST); }, [vaultId, loadContainers]);
  const [pendingSshAction, setPendingSshAction] = useState<
    { type: 'closeTab'; tabId: string } | { type: 'lockVault' } | { type: 'openWorkspace'; workspaceId: string } | { type: 'closeWorkspace' } | null
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

  // Vault files opened from Explorer: at start and while Terminus runs.
  const screenRef = useRef(screen);
  screenRef.current = screen;
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
    void window.desktopApi.vaultLaunchFile().then(filePath => { if (filePath) open(filePath); }).catch(() => {});
    return window.desktopApi.onVaultOpenFile(open);
  }, []);
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
      else setError('Hier lassen sich nur Vault-Dateien (.term) öffnen. Dateien für Server ziehst du in die Serverseite eines Dateibrowsers.');
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
  }, []);
  const vaultFileDialog = pendingVaultFile && <ConfirmDialog title={`Vault „${fileName(pendingVaultFile)}“ öffnen?`}
    description={`Der aktuelle Vault wird dafür gesperrt${terminals.hasRunning ? ', alle Verbindungen in allen Fenstern werden getrennt' : ''}. Danach gibst du das Passwort des neuen Vaults ein.`}
    confirmLabel="Sperren und öffnen" destructive={terminals.hasRunning} busy={busy}
    onCancel={() => setPendingVaultFile(null)} onConfirm={() => {
      const filePath = pendingVaultFile;
      setPendingVaultFile(null);
      void lockVault().then(() => { setScreen('open'); setSelectedVaultPath(filePath); });
    }} />;
  const fileDropHint = fileDragActive && <div className="file-drop-hint" aria-hidden="true">Eine .term-Datei hier loslassen öffnet den Vault</div>;

  useEffect(() => {
    void window.desktopApi
      .getVersion()
      .then(setVersion)
      .catch(() => setVersion('unbekannt'));
  }, []);

  function resetForm(): void {
    setEditorOpen(false);
    setEditorDirty(false);
    setPendingNavigation(null);
    setActiveWorkspaceId(null);
    setSavedNotice('');
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
    setError(null);
  }

  function navigateTo(nextScreen: Screen): void {
    resetForm();
    setScreen(nextScreen);
  }

  async function handleCreateVault(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!vaultName.trim()) {
      setError('Bitte gib dem Vault einen Namen.');
      return;
    }

    if (password.length < 8) {
      setError(
        'Das Passwort muss mindestens 8 Zeichen lang sein.',
      );
      return;
    }

    if (password !== passwordConfirmation) {
      setError('Die Passwörter stimmen nicht überein.');
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
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
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
    setError(null);

    if (!selectedVaultPath) {
      setError('Bitte wähle zuerst eine Vault-Datei aus.');
      return;
    }

    if (!password) {
      setError('Bitte gib das Vault-Passwort ein.');
      return;
    }

    setBusy(true);

    try {
      const result = await window.desktopApi.unlockVault({
        filePath: selectedVaultPath,
        password,
      });

      setVault(result.vault);
      setVaultPath(result.filePath);
      setScreen('vault');
      resetForm();
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  async function handleSelectVaultFile(): Promise<void> {
    setError(null);
    setBusy(true);

    try {
      const result =
        await window.desktopApi.selectVaultFile();

      if (result.canceled) {
        return;
      }

      setSelectedVaultPath(result.filePath);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Die Vault-Datei konnte nicht ausgewählt werden.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateFolder(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!vault || busy) {
      return;
    }

    if (!canCreateFolder) {
      setError('Bitte wähle einen Ordner oder die Vault-Ebene aus.');
      return;
    }

    const name = folderName.trim();

    if (!name) {
      setError('Bitte gib einen Ordnernamen ein.');
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

  async function persistVault(updatedVault: Vault): Promise<boolean> {
    if (!vault || saveInProgress.current) return false;
    saveInProgress.current = true;
    const previousVault = vault;
    setError(null);
    setSavedNotice('');
    setBusy(true);
    setVault(updatedVault);
    try {
      const result = await window.desktopApi.saveCurrentVault({ vault: updatedVault });
      setVault(result.vault);
      setVaultPath(result.filePath);
      setSavedNotice('Gespeichert');
      return true;
    } catch (caughtError) {
      setVault(previousVault);
      setError(getErrorMessage(caughtError));
      return false;
    } finally {
      saveInProgress.current = false;
      setBusy(false);
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

  async function saveConnection(connection: ConnectionNode, parentId: string): Promise<boolean> {
    if (!vault || busy) return false;
    const existing = findNode(vault.nodes, connection.id);
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
      ...toWorkspaceViews(terminalLayout.viewsState, terminals.tabs), ...(windows.length ? { windows } : {}) };
    const workspaces = upsertWorkspace(vault.workspaces, workspace);
    if (!await persistVault({ ...vault, workspaces })) return null;
    setActiveWorkspaceId(workspace.id);
    return workspace.id;
  }

  async function renameWorkspace(id: string, name: string): Promise<boolean> {
    if (!vault || busy || !name.trim()) return false;
    const existing = vault.workspaces.find(item => item.id === id);
    if (!existing) return false;
    return persistVault({ ...vault, workspaces: upsertWorkspace(vault.workspaces, { ...existing, name: name.trim() }) });
  }

  async function deleteWorkspace(id: string): Promise<boolean> {
    if (!vault || busy) return false;
    const saved = await persistVault({ ...vault, workspaces: removeWorkspace(vault.workspaces, id) });
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
        .catch(() => setError('Nicht alle Fenster des Workspaces konnten geöffnet werden.'));
      terminalLayout.replaceViews(restored.state);
      terminals.restore(restored.tabs, restored.activeTabId);
      setActiveWorkspaceId(id);
      setEditorOpen(false);
      setError(restored.skipped ? skippedNotice(restored.skipped) : null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Der Workspace konnte nicht geöffnet werden.');
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
      setVault(null);
      setVaultPath(null);
      resetForm();
      setScreen('home');
      setBusy(false);
    }
  }

  function navigateEditor(action: () => void): void {
    if (busy) return;
    if (editorOpen && editorDirty) setPendingNavigation(() => action);
    else action();
  }

  function editNode(id: string): void {
    navigateEditor(() => { setSelectedNodeId(id); setShowConnectionForm(false); setEditorOpen(true); setEditorDirty(false); setError(null); });
  }

  /** parentId: target folder ('' = vault root); undefined uses the current selection. */
  function newConnection(protocol: ConnectionProtocol = 'ssh', parentId?: string): void {
    navigateEditor(() => {
      setNewConnectionTarget({ protocol, parentId: parentId ?? null });
      setShowConnectionForm(true); setEditorOpen(true); setEditorDirty(false); setShowFolderForm(false); setError(null);
    });
  }

  function newFolder(parentId: string): void {
    navigateEditor(() => {
      setSelectedNodeId(parentId || null); setShowConnectionForm(false); setEditorOpen(false); setEditorDirty(false);
      setFolderName(''); setShowFolderForm(true); setError(null);
    });
  }

  function connectNode(id: string, paneId?: string, asFiles = false): void {
    const node = vault && findNode(vault.nodes, id);
    if (!node || node.type !== 'connection') return;
    if (node.disabled) { setError(disabledNotice(node)); return; }
    navigateEditor(() => {
      if (terminals.tabs.length >= MAX_SSH_SESSIONS) { setError(`Maximal ${MAX_SSH_SESSIONS} Sessions. Schließe zuerst einen Tab.`); return; }
      if (paneId) terminalLayout.setFocused(paneId);
      terminals.open(toTerminalConnection(node, asFiles)); setEditorOpen(false); setEditorDirty(false); setError(null);
    });
  }

  function openContainer(hostId: string, item: DiscoveredItem, mode: TerminalTargetMode): void {
    const host = hostId === LOCAL_CONTAINER_HOST ? undefined : vault && findNode(vault.nodes, hostId);
    if (hostId !== LOCAL_CONTAINER_HOST && host?.type !== 'connection') return;
    if (host?.type === 'connection' && host.disabled) { setError(disabledNotice(host)); return; }
    navigateEditor(() => {
      if (terminals.tabs.length >= MAX_SSH_SESSIONS) { setError(`Maximal ${MAX_SSH_SESSIONS} Sessions. Schließe zuerst einen Tab.`); return; }
      const name = host?.type === 'connection' ? host.name : 'Dieser Computer';
      const address = host?.type === 'connection' ? connectionAddress(host) : 'lokal';
      terminals.open(containerConnection(hostId, name, address, { item: toTarget(item), mode }));
      setEditorOpen(false); setEditorDirty(false); setError(null);
    });
  }

  const containerTree: ContainerTreeProps = {
    state: containerDiscovery.state,
    onExpand: id => void containerDiscovery.load(id),
    onOpen: openContainer,
    onAction: (id: string, item: DiscoveredItem, action: ContainerAction, confirm?: string) => { if (!confirm || window.confirm(confirm)) void containerDiscovery.act(id, item, action); },
  };

  /** Opens every connection inside a folder (and its subfolders) as tabs, up to the session limit. */
  function connectFolder(folderId: string): void {
    const folder = vault && findNode(vault.nodes, folderId);
    if (!folder || folder.type !== 'folder') return;
    const { connections, disabled } = connectionsIn(folder.children);
    if (!connections.length) { setError(disabled ? `Alle Verbindungen im Ordner „${folder.name}“ sind deaktiviert.` : `Der Ordner „${folder.name}“ enthält keine Verbindungen.`); return; }
    navigateEditor(() => {
      const free = MAX_SSH_SESSIONS - terminals.tabs.length;
      for (const connection of connections.slice(0, Math.max(0, free))) terminals.open(toTerminalConnection(connection));
      setEditorOpen(false); setEditorDirty(false);
      const notices = [...(connections.length > free ? [`Es wurden nur ${Math.max(0, free)} von ${connections.length} Verbindungen geöffnet: Maximal ${MAX_SSH_SESSIONS} Sessions gleichzeitig.`] : []),
        ...(disabled ? [skippedNotice(disabled)] : [])];
      setError(notices.length ? notices.join(' ') : null);
    });
  }

  async function saveAndConnect(connection: ConnectionNode, parentId: string): Promise<boolean> {
    if (terminals.tabs.length >= MAX_SSH_SESSIONS) { setError(`Maximal ${MAX_SSH_SESSIONS} Sessions. Schließe zuerst einen Tab.`); return false; }
    if (!await saveConnection(connection, parentId)) return false;
    if (connection.disabled) { setEditorOpen(false); setEditorDirty(false); setError(disabledNotice(connection)); return true; }
    terminals.open(toTerminalConnection(connection)); setEditorOpen(false); setEditorDirty(false); return true;
  }

  async function moveTreeNode(id: string, target: NodeDropTarget): Promise<void> {
    if (!vault || busy) return;
    let nodes: VaultNode[];
    try { nodes = moveNode(vault.nodes, id, target); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Verschieben fehlgeschlagen.'); return; }
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

  if (screen === 'vault' && vault) {
    const connectionCount = countConnections(vault.nodes);
    const activeWorkspace = vault.workspaces.find(item => item.id === activeWorkspaceId);
    const currentViews = toWorkspaceViews(terminalLayout.viewsState, terminals.tabs);
    const workspaceDirty = activeWorkspace
      ? JSON.stringify([activeWorkspace.layout, activeWorkspace.views]) !== JSON.stringify([currentViews.layout, currentViews.views])
      : terminals.tabs.length > 0;
    const runningCount = terminals.tabs.filter(isRunning).length;
    const closeEditor = () => navigateEditor(() => { setEditorOpen(false); setEditorDirty(false); });
    return <main className="vault-shell">
      {vaultFileDialog}{fileDropHint}
      <header className="app-header">
        <button className="icon-button sidebar-toggle" type="button" aria-label={sidebarCollapsed ? 'Verbindungen einblenden' : 'Verbindungen ausblenden'}
          aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed(value => !value)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>
        </button>
        <div className="header-vault" title={vaultPath ?? undefined}><span className="brand-word">Terminus</span><strong>{vault.name}</strong></div>
        <WorkspaceControls workspaces={vault.workspaces} busy={busy} hasTabs={terminals.tabs.length > 0}
          activeId={activeWorkspaceId} dirty={workspaceDirty} onSave={saveWorkspace}
          onOpen={id => navigateEditor(() => openWorkspace(id))} onRename={renameWorkspace} onDelete={deleteWorkspace}
          onClose={() => navigateEditor(() => closeWorkspace())} />
        <button className="secondary-button" type="button" title="Workflows suchen und eintippen (Strg+Umschalt+Leertaste)" onClick={() => setPaletteOpen(true)}>Workflows</button>
        <button className="secondary-button assistant-toggle" type="button" aria-pressed={assistant.open} title="KI-Assistent ein- oder ausblenden (Strg+Umschalt+K)"
          onClick={assistant.toggle}>KI-Assistent</button>
        <button className="secondary-button lock-button" type="button" disabled={busy} onClick={() => navigateEditor(() => {
          if (terminals.hasRunning && vault.settings.confirmBeforeClosingSession) setPendingSshAction({ type: 'lockVault' });
          else void lockVault();
        })}>Vault sperren</button>
      </header>
      {pendingNavigation && <ConfirmDialog title="Ungespeicherte Änderungen" description="Deine Eingaben sind noch nicht gespeichert. Kehre zum Editor zurück, um sie zu speichern, oder verwirf sie und fahre fort."
        confirmLabel="Verwerfen und fortfahren" busy={busy} onCancel={() => setPendingNavigation(null)} onConfirm={() => {
          const action = pendingNavigation; setPendingNavigation(null); setEditorDirty(false); setEditorRevision(value => value + 1); action();
        }} />}
      {pendingSshAction && <ConfirmDialog
        title={pendingSshAction.type === 'lockVault' ? 'Vault sperren?' : pendingSshAction.type === 'openWorkspace' ? 'Aktiven Workspace ersetzen?' : pendingSshAction.type === 'closeWorkspace' ? 'Workspace schließen?' : `Tab „${pendingTab ? tabLabel(pendingTab, terminals.tabs) : 'Terminal'}“ schließen?`}
        description={pendingSshAction.type === 'closeTab' ? 'Diese Verbindung wird beendet. Laufende Programme in der Sitzung können dadurch beendet werden.' : `${runningCount} aktive Verbindung${runningCount === 1 ? '' : 'en'} ${runningCount === 1 ? 'wird' : 'werden'} beendet. Laufende Programme in den Sitzungen können dadurch beendet werden.`}
        confirmLabel={pendingSshAction.type === 'lockVault' ? 'Trennen und sperren' : pendingSshAction.type === 'openWorkspace' ? 'Ersetzen und öffnen' : 'Verbindung trennen'}
        busy={busy} onCancel={() => setPendingSshAction(null)} onConfirm={() => {
          const action = pendingSshAction; setPendingSshAction(null);
          if (action.type === 'lockVault') void lockVault();
          else if (action.type === 'openWorkspace') openWorkspace(action.workspaceId, true);
          else if (action.type === 'closeWorkspace') closeWorkspace(true);
          else terminals.close(action.tabId);
        }} />}
      <div className="vault-content">
        <ResizableSidebar collapsed={sidebarCollapsed}>
          <div className="sidebar-heading"><span>Verbindungen <span className="connection-count">{connectionCount}</span></span>
            <button className="new-node-button" type="button" aria-haspopup="menu" aria-expanded={newMenu !== null} disabled={busy}
              onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect();
                setNewMenu(newMenu ? null : { x: rect.left, y: rect.bottom + 4 });
              }}>Neu</button>
            {newMenu && <ContextMenu x={newMenu.x} y={newMenu.y} label="Neu anlegen" onClose={closeNewMenu} entries={[
              { kind: 'heading', label: 'Neue Verbindung' },
              ...NEW_CONNECTION_KINDS.map((item): ContextMenuEntry => item.planned
                ? { kind: 'item', label: item.label, hint: 'geplant', disabled: true, onSelect: () => {} }
                : { kind: 'item', label: item.label, onSelect: () => newConnection(item.protocol as ConnectionProtocol) }),
              { kind: 'separator' },
              { kind: 'item', label: 'Neuer Ordner', disabled: !canCreateFolder, onSelect: () => setShowFolderForm(true) },
            ]} />}
          </div>
          <button className="root-row" type="button" disabled={busy} aria-pressed={selectedNodeId === null}
            onClick={() => navigateEditor(() => { setSelectedNodeId(null); setShowConnectionForm(false); setEditorOpen(false); setEditorDirty(false); })}>Alle Verbindungen</button>
          {showFolderForm && <form className="sidebar-create-form" onSubmit={handleCreateFolder}>
            <label>Ordnername<input autoFocus value={folderName} disabled={busy} onChange={event => setFolderName(event.target.value)} /></label>
            <span className="muted">In: {selectedNode?.type === 'folder' ? selectedNode.name : vault.name}</span>
            <div className="sidebar-form-actions"><button type="button" onClick={() => setShowFolderForm(false)} disabled={busy}>Abbrechen</button>
              <button type="submit" disabled={busy || !canCreateFolder || !folderName.trim()}>Anlegen</button></div>
          </form>}
          <LocalContainers containers={containerTree} disabled={busy} />
          <VaultTree nodes={vault.nodes} selectedNodeId={selectedNodeId} disabled={busy} containers={containerTree}
            onSelect={id => navigateEditor(() => { setSelectedNodeId(id); setShowConnectionForm(false); setEditorDirty(false); setError(null); })}
            onConnect={connectNode} onOpenFiles={id => connectNode(id, undefined, true)} onConnectAll={connectFolder} onToggleDisabled={id => void toggleDisabled(id)} onMove={(id, target) => void moveTreeNode(id, target)} onEdit={editNode} onRename={renameNode} onNewConnection={newConnection} onNewFolder={newFolder} />
          {!vault.nodes.length && <div className="empty-state"><p>Füge deinen ersten Server hinzu. Über „Neu“ oder Rechtsklick wählst du die Verbindungsart.</p><button type="button" className="secondary-button" onClick={() => newConnection()}>Neue SSH-Verbindung</button></div>}
        </ResizableSidebar>
        <section className={`workspace${editorOpen ? ' with-editor' : ''}${!terminals.tabs.length ? ' no-terminals' : ''}`}>
          <div className="terminal-area" hidden={!terminals.tabs.length && !transfer.externalHover}>
            <SplitTerminalArea nodes={vault.nodes} onConnect={connectNode} tabs={terminals.tabs} selected={terminals.activeTabId} layout={terminalLayout.layout}
              draggedTabId={draggedTabId} onDrag={setDraggedTabId} visible={terminals.tabs.length > 0}
              focused={terminalLayout.focused} busy={busy} onLayout={terminalLayout.setLayout} onFocus={terminalLayout.setFocused}
              onSelect={terminals.select} onStatus={terminals.updateStatus} onClose={requestCloseTab}
              externalHover={transfer.externalHover} pendingDock={transfer.pendingDock} onDockHandled={transfer.clearPendingDock} onTearOff={transfer.tearOff}
              viewControls={viewControls} />
          </div>
          {!terminals.tabs.length && !editorOpen && !transfer.externalHover && <WelcomePage vaultName={vault.name} version={version} onShowReleaseNotes={() => setShowReleaseNotes(true)} connectionCount={connectionCount}
            workspaces={vault.workspaces} busy={busy} onNewConnection={protocol => newConnection(protocol)}
            onOpenWorkspace={id => navigateEditor(() => openWorkspace(id))} />}
          {editorOpen && <aside className="properties-panel" aria-label="Eigenschaften">
            <div className="properties-heading"><span>{editorDirty ? 'Ungespeicherte Änderungen' : 'Eigenschaften'}</span>
              <button type="button" className="icon-button" aria-label="Editor schließen" disabled={busy} onClick={closeEditor}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>
              </button></div>
            {showConnectionForm || selectedNode?.type === 'connection' ? <ConnectionForm
              key={`${showConnectionForm ? `new-${newConnectionTarget.protocol}-${newConnectionTarget.parentId ?? selectedNodeId ?? 'root'}` : selectedNode?.id}-${editorRevision}`}
              connection={!showConnectionForm && selectedNode?.type === 'connection' ? selectedNode : undefined} nodes={vault.nodes}
              protocol={showConnectionForm ? newConnectionTarget.protocol : undefined}
              initialParentId={showConnectionForm ? newConnectionTarget.parentId ?? (selectedNode?.type === 'folder' ? selectedNode.id : '') : parentFolderId(vault.nodes, selectedNodeId ?? '') ?? ''}
              busy={busy} onDirtyChange={setEditorDirty} onConnect={() => { if (selectedNode?.type === 'connection') connectNode(selectedNode.id); }}
              onSave={saveConnection} onSaveAndConnect={saveAndConnect} onCancel={closeEditor} onDelete={deleteSelectedNode}
              onTest={connection => window.desktopApi.connectionTest(connection)}
              onPickKey={async () => { const result = await window.desktopApi.selectPrivateKeyFile(); return result.canceled ? null : result.filePath; }} />
              : selectedNode?.type === 'folder' ? <FolderEditor key={`${selectedNode.id}-${editorRevision}`} folder={selectedNode} busy={busy}
                onDirtyChange={setEditorDirty} onSave={saveFolder} onDelete={deleteSelectedNode} onCancel={closeEditor} /> : null}
          </aside>}
          {assistant.open && <AssistantPanel tabs={terminals.tabs} activeTabId={terminals.activeTabId} onClose={() => assistant.setOpen(false)}
            onManageProviders={() => setShowAiSettings(true)} onSaveWorkflow={command => setWorkflowEditor({ initial: { command } })} />}
        </section>
      </div>
      {paletteOpen && <WorkflowPalette workflows={vault.workflows ?? []} tabs={terminals.tabs} activeTabId={terminals.activeTabId}
        onClose={() => setPaletteOpen(false)} onManage={() => { setPaletteOpen(false); setWorkflowEditor({}); }} />}
      {workflowEditor && <WorkflowsDialog workflows={vault.workflows ?? []} busy={busy} initial={workflowEditor.initial}
        onClose={() => setWorkflowEditor(null)} onSave={workflows => persistVault({ ...vault, workflows })} />}
      {showAiSettings && <AiSettingsDialog settings={vault.ai} busy={busy} onClose={() => setShowAiSettings(false)}
        onSave={settings => persistVault({ ...vault, ai: settings })} />}
      {error && <div className="app-error" role="alert"><span>{error}</span><button type="button" aria-label="Fehlermeldung schließen" onClick={() => setError(null)}>Schließen</button></div>}
      <footer className="app-status"><span role="status">{busy ? 'Speichert …' : error ? 'Aktion fehlgeschlagen' : savedNotice || 'Vault geöffnet'}</span>
        <span>{runningCount} {runningCount === 1 ? 'aktive Session' : 'aktive Sessions'}</span><span className="status-path" title={vaultPath ?? undefined}>{vaultPath}</span>
        <button type="button" className="version-button" title="Neuerungen anzeigen" onClick={() => setShowReleaseNotes(true)}>v{version}</button></footer>
      {showReleaseNotes && <ReleaseNotesDialog version={version} onClose={() => setShowReleaseNotes(false)} />}
    </main>;
  }

  return (
    <main className="app-shell">
      {fileDropHint}
      <section className="welcome-card">
        <div className="brand large-brand">
          <span className="brand-mark"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 6 6-6 6m9 0h7" /></svg></span>
          <span>Terminus</span>
        </div>

        {screen === 'home' && (
          <>
            <h1>Deine Server, griffbereit.</h1>

            <p className="subtitle">
              SSH-Verbindungen, Ordner und Workspaces in einer
              lokal verschlüsselten Datei.
            </p>

            <div className="action-grid">
              <button
                className="secondary-button"
                type="button"
                onClick={() => navigateTo('create')}
              >
                Neuen Vault erstellen
              </button>

              <button
                className="primary-button"
                type="button"
                onClick={() => navigateTo('open')}
              >
                Vault öffnen
              </button>
            </div>

            <div className="status-row">
              <span className="status-dot" />
              <span>
                Argon2id und AES-256-GCM aktiv
              </span>
            </div>
            <FileTypeSetting />
          </>
        )}

        {screen === 'create' && (
          <form onSubmit={handleCreateVault}>
            <h2>Vault erstellen</h2>

            <label>
              Name
              <input
                autoFocus
                value={vaultName}
                onChange={(event) =>
                  setVaultName(event.target.value)
                }
                placeholder="Meine Server"
                disabled={busy}
              />
            </label>

            <label>
              Passwort
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
              Passwort wiederholen
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

            <p className="field-hint">Mindestens 8 Zeichen. Das Passwort wird zum Entsperren benötigt.</p>
            <label className="password-toggle"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />Passwörter anzeigen</label>
            {error && <div className="error-message" role="alert">{error}</div>}

            <div className="form-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => navigateTo('home')}
              >
                Zurück
              </button>

              <button
                className="primary-button"
                type="submit"
                disabled={busy}
              >
                {busy
                  ? 'Vault wird verschlüsselt …'
                  : 'Vault erstellen'}
              </button>
            </div>
          </form>
        )}

        {screen === 'open' && (
          <form onSubmit={handleOpenVault}>
            <h2>Vault öffnen</h2>

            <p className="form-description">
              Wähle deine `.term`-Datei aus und gib anschließend
              das zugehörige Passwort ein.
            </p>

            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void handleSelectVaultFile()}
            >
              {selectedVaultPath
                ? 'Andere Vault-Datei auswählen'
                : 'Vault-Datei auswählen'}
            </button>

            {selectedVaultPath && (
              <label>
                Ausgewählte Datei
                <input
                  value={selectedVaultPath}
                  readOnly
                  title={selectedVaultPath}
                />
              </label>
            )}

            <label>
              Passwort
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                autoComplete="current-password"
                disabled={busy}
              />
            </label>

            <label className="password-toggle"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />Passwort anzeigen</label>
            {error && <div className="error-message" role="alert">{error}</div>}

            <div className="form-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => navigateTo('home')}
              >
                Zurück
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
                  ? 'Vault wird entschlüsselt …'
                  : 'Vault öffnen'}
              </button>
            </div>
          </form>
        )}

        <footer>Terminus {version}</footer>
      </section>
    </main>
  );
}
