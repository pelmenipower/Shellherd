import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, net, powerMonitor, shell, webContents } from 'electron';
import type { Rectangle, WebContents } from 'electron';
import { join } from 'node:path';

import { createKnownHosts, registerSshIpcHandlers, requireSshSender } from './ssh/ipc';
import { registerKnownHostsIpc } from './ssh/known-hosts-ipc';
import { AuthPrompts } from './ssh/auth-prompts';
import type { PromptTarget } from './ssh/auth-prompts';
import { openJump } from './ssh/jump';
import { openRemoteHost } from './containers/runner';
import { registerFileIpcHandlers } from './files/ipc';
import { registerContainerIpcHandlers } from './containers/ipc';
import { SudoRejections } from './containers/sudo-rejections';
import type { ContainerDiscovery } from './containers/discovery';
import { registerKubernetesIpcHandlers } from './kubernetes/ipc';
import type { KubeSessions } from './kubernetes/session';
import type { SftpSessionManager } from './files/sftp-session';
import { findConnection } from './ssh/session';
import type { SshSessionManager } from './ssh/session';
import { rdpSurfaceMode, registerRdpIpcHandlers } from './rdp/ipc';
import type { RdpSessionManager } from './rdp/host';
import { visibleBounds, windowRegistry } from './windows';
import type { WindowRole } from './windows';
import { registerWindowIpcHandlers } from './window-ipc';
import { FileAssociation, vaultFileFromArgs } from './file-association';
import { brandIconPath } from './brand';
import { migrateUserData } from './user-data';
import { testConnection } from './connection-test';
import { registerAiIpcHandlers } from './ai/ipc';
import type { AssistantService } from './ai/assistant';
import { ConnectionNodeSchema } from '../shared/vault/schema';
import { effectiveTimeouts } from '../shared/vault/timeouts';
import { webLinkHref } from '../shared/links';
import { readAppSettings, writeAppSettings } from './app-settings';
import { z } from 'zod';
import { AppError } from '../shared/errors';
import { capabilities } from './platform';
import { LANGUAGE_SETTINGS, LOCALE_ARG } from '../shared/locale';
import { THEME_SETTINGS } from '../shared/theme';
import { localeStore } from './locale';
import { mainT, setMainLocale } from './i18n';
import { localTestUrl, readImport } from './import-source';
import { UPDATE_URL, UpdateChecker } from './update-check';

import { IPC_CHANNELS } from '../shared/ipc';
import type { VaultLockedInfo } from '../shared/ipc';
import { AutoLock } from './vault/auto-lock';
import { vaultPathGrants } from './vault/path-grants';
import {
  registerVaultIpcHandlers,
  vaultSessionManager,
} from './vault/ipc';


let sshSessionManager: SshSessionManager;
let containerDiscovery: ContainerDiscovery | undefined;
let kubeSessions: KubeSessions | undefined;
let rdpSessionManager: RdpSessionManager;
let sftpSessionManager: SftpSessionManager;
let assistant: AssistantService | undefined;
let autoLock: AutoLock | undefined;
let authPrompts: AuthPrompts | undefined;
let lastFocusedId: number | undefined;
/** True while the vault is locked: windows created meanwhile start excluded from screen capture too. */
let captureBlocked = false;

/** Target of an auth prompt: the owner's window, else the last focused one, else the main window. */
function resolvePromptTarget(ownerId?: number): PromptTarget | undefined {
  const live = (contents: WebContents | undefined): WebContents | undefined =>
    contents && !contents.isDestroyed() ? contents : undefined;
  const focused = lastFocusedId !== undefined && windowRegistry.roleOf(lastFocusedId) ? webContents.fromId(lastFocusedId) : undefined;
  const main = windowRegistry.main();
  const contents = live(ownerId === undefined ? undefined : webContents.fromId(ownerId))
    ?? live(focused)
    ?? live(main && !main.isDestroyed() ? main.webContents : undefined);
  if (!contents) return undefined;
  return { id: contents.id, send: (channel, payload) => contents.send(channel, payload) };
}

// SSH, local shells, RDP and SFTP share every lifecycle path: crash, navigation, close, lock and quit.
const closeOwnerSessions = (ownerId: number): void => {
  authPrompts?.cancelOwner(ownerId);
  sshSessionManager.closeOwner(ownerId); rdpSessionManager.closeOwner(ownerId); sftpSessionManager.closeOwner(ownerId);
  kubeSessions?.closeOwner(ownerId);
  assistant?.cancelOwner(ownerId);
};
const closeAllSessions = (): void => { authPrompts?.cancelAll(); sshSessionManager?.closeAll(); rdpSessionManager?.closeAll(); sftpSessionManager?.closeAll(); assistant?.cancelAll(); containerDiscovery?.closeAll(); kubeSessions?.closeAll(); };
const hasOwnerSessions = (ownerId: number): boolean =>
  sshSessionManager.hasOwner(ownerId) || rdpSessionManager.hasOwner(ownerId) || sftpSessionManager.hasOwner(ownerId) || (kubeSessions?.hasOwner(ownerId) ?? false);
const hasAnySessions = (): boolean => BrowserWindow.getAllWindows().some(window => !window.isDestroyed() && hasOwnerSessions(window.webContents.id));

/** Detached windows close without moving their tabs (vault lock, workspace replacement, app exit). */
function closeSecondaryWindows(): void {
  for (const window of windowRegistry.secondaries()) {
    closeOwnerSessions(window.webContents.id);
    windowRegistry.allowClose(window.webContents.id);
    window.close();
  }
}

// Shown before the first paint; matches --color-bg-app of the active scheme.
const windowBackground = (): string => nativeTheme.shouldUseDarkColors ? '#0e141e' : '#f1eee9';

function createWindow(role: WindowRole, bounds?: Rectangle, maximized = false): BrowserWindow {
  const icon = brandIconPath();
  const window = new BrowserWindow({
    ...(bounds ?? { width: 1280, height: 800 }),
    minWidth: role === 'main' ? 900 : 480,
    minHeight: role === 'main' ? 600 : 320,
    title: mainT(role === 'main' ? 'window.main' : 'window.secondary'),
    ...(icon ? { icon } : {}),
    backgroundColor: windowBackground(),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
      additionalArguments: [`${LOCALE_ARG}${localeStore.get().effective}`, `--shellherd-capabilities=${JSON.stringify(capabilities)}`],
    },
  });
  windowRegistry.register(window, role);
  if (captureBlocked) window.setContentProtection(true);
  window.on('focus', () => { lastFocusedId = window.webContents.id; });
  // index.html has its own <title>; keep the localized window title.
  window.on('page-title-updated', event => event.preventDefault());

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => closeOwnerSessions(window.webContents.id));
  const ownerId = window.webContents.id;
  window.webContents.on('destroyed', () => closeOwnerSessions(ownerId));
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) closeOwnerSessions(ownerId);
  });
  if (role === 'main') guardMainWindowClose(window, ownerId);
  else guardSecondaryWindowClose(window, ownerId);

  window.once('ready-to-show', () => { if (maximized) window.maximize(); window.show(); });

  const query = role === 'secondary' ? { role: 'secondary' } : undefined;
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query ? '?role=secondary' : ''}`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), query ? { query } : undefined);
  }
  return window;
}

/** Restores the saved main window placement; only the close of the main window writes it, never while minimized. */
function createMainWindow(settingsFile: string): BrowserWindow {
  const saved = readAppSettings(settingsFile).mainWindow;
  const window = createWindow('main', saved ? visibleBounds(saved.bounds) : undefined, saved?.maximized ?? false);
  window.on('close', () => {
    if (window.isDestroyed() || window.isMinimized()) return;
    const { x, y, width, height } = window.getNormalBounds();
    writeAppSettings(settingsFile, { mainWindow: { bounds: { x, y, width, height }, maximized: window.isMaximized() } });
  });
  return window;
}

/** Closing the main window ends the app; sessions in all windows are confirmed together. */
function guardMainWindowClose(window: BrowserWindow, ownerId: number): void {
  let closing = false;
  let confirmingClose = false;
  window.on('close', event => {
    if (closing || !hasAnySessions()) { closeSecondaryWindows(); return; }
    let confirm = true;
    try { confirm = vaultSessionManager.getSnapshot().vault.settings.confirmBeforeClosingSession; } catch { /* locked */ }
    if (!confirm) { closeAllSessions(); closeSecondaryWindows(); return; }
    event.preventDefault();
    if (confirmingClose) return;
    confirmingClose = true;
    void dialog.showMessageBox(window, {
      type: 'question', title: mainT('dialogs.closeApp.title'), message: mainT('dialogs.closeApp.message'),
      buttons: [mainT('dialogs.cancel'), mainT('dialogs.closeApp.confirm')], defaultId: 0, cancelId: 0, noLink: true,
    }).then(result => {
      if (result.response === 1 && !window.isDestroyed()) {
        closing = true;
        closeOwnerSessions(ownerId);
        closeAllSessions();
        window.close();
      }
    }).catch(() => {}).finally(() => { confirmingClose = false; });
  });
}

/** Closing a detached window ends its connections; with the vault setting on, after a confirmation. */
function guardSecondaryWindowClose(window: BrowserWindow, ownerId: number): void {
  let confirming = false;
  const closeNow = (): void => {
    closeOwnerSessions(ownerId);
    windowRegistry.allowClose(ownerId);
    if (!window.isDestroyed()) window.close();
  };
  window.on('close', event => {
    if (windowRegistry.closeAllowed(ownerId) || !hasOwnerSessions(ownerId)) { closeOwnerSessions(ownerId); return; }
    let confirm = true;
    try { confirm = vaultSessionManager.getSnapshot().vault.settings.confirmBeforeClosingSession; } catch { /* locked */ }
    if (!confirm) { closeOwnerSessions(ownerId); return; }
    event.preventDefault();
    if (confirming) return;
    confirming = true;
    void dialog.showMessageBox(window, {
      type: 'question', title: mainT('dialogs.closeWindow.title'), message: mainT('dialogs.closeWindow.message'),
      detail: mainT('dialogs.closeWindow.detail'),
      buttons: [mainT('dialogs.cancel'), mainT('dialogs.closeWindow.confirm')], defaultId: 0, cancelId: 0, noLink: true,
    }).then(result => { if (result.response === 1) closeNow(); }).catch(() => {}).finally(() => { confirming = false; });
  });
}

// Taskbar grouping and toast identity on Windows.
if (process.platform === 'win32') app.setAppUserModelId('com.pelmenipower.shellherd');

// One Shellherd per user: a vault opened from Explorer goes to the running window.
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
let launchFile = vaultFileFromArgs(process.argv);
// Explorer passed it: the user's click, so main may open it.
if (launchFile) vaultPathGrants.grant(launchFile);
app.on('second-instance', (_event, argv) => {
  const main = windowRegistry.main();
  if (!main) return;
  if (main.isMinimized()) main.restore();
  main.focus();
  const file = vaultFileFromArgs(argv);
  if (file) {
    vaultPathGrants.grant(file);
    main.webContents.send(IPC_CHANNELS.vaultOpenFile, file);
  }
});

// Experimental variant A only: child windows from the helper are invisible under DirectComposition.
if (rdpSurfaceMode() === 'child') app.commandLine.appendSwitch('disable-direct-composition');

app.whenReady().then(() => {
  if (!singleInstance) return;
  // Before anything reads userData (known hosts, last vault): take over the legacy profile files once.
  migrateUserData(join(app.getPath('appData'), 'Terminus'), app.getPath('userData'));
  const settingsFile = join(app.getPath('userData'), 'settings.json');
  const languageState = localeStore.init({
    settingsFile,
    systemLanguages: () => app.getPreferredSystemLanguages(),
  });
  setMainLocale(languageState.effective);
  nativeTheme.themeSource = readAppSettings(settingsFile).theme;
  const association = new FileAssociation(process.execPath, process.defaultApp ? app.getAppPath() : null, brandIconPath());
  ipcMain.handle(IPC_CHANNELS.vaultLaunchFile, event => {
    windowRegistry.requireMain(event);
    const file = launchFile;
    launchFile = null;
    return file;
  });
  ipcMain.handle(IPC_CHANNELS.fileTypeStatus, event => { windowRegistry.requireMain(event); return association.registered(); });
  ipcMain.handle(IPC_CHANNELS.fileTypeRegister, async event => { windowRegistry.requireMain(event); await association.register(); });
  ipcMain.handle(IPC_CHANNELS.fileTypeUnregister, async event => { windowRegistry.requireMain(event); await association.unregister(); });

  ipcMain.handle(
    IPC_CHANNELS.getVersion,
    () => app.getVersion(),
  );

  // Any registered window may read the language (self-healing); only the main window changes it.
  ipcMain.handle(IPC_CHANNELS.appGetLanguage, event => {
    if (!windowRegistry.roleOf(event.sender.id) || event.senderFrame !== event.sender.mainFrame) throw new AppError('core.invalidRequest');
    return localeStore.get();
  });
  ipcMain.handle(IPC_CHANNELS.appSetLanguage, (event, value: unknown) => {
    windowRegistry.requireMain(event);
    const parsed = z.enum(LANGUAGE_SETTINGS).safeParse(value);
    if (!parsed.success) throw new AppError('core.invalidRequest');
    return localeStore.set(parsed.data);
  });
  // Main window only, as in the spec for getTheme; main applies the scheme to every window.
  ipcMain.handle(IPC_CHANNELS.appGetTheme, event => {
    windowRegistry.requireMain(event);
    return readAppSettings(settingsFile).theme;
  });
  ipcMain.handle(IPC_CHANNELS.appSetTheme, (event, value: unknown) => {
    windowRegistry.requireMain(event);
    const parsed = z.enum(THEME_SETTINGS).safeParse(value);
    if (!parsed.success) throw new AppError('core.invalidRequest');
    if (!writeAppSettings(settingsFile, { theme: parsed.data })) throw new AppError('core.settingsWriteFailed');
    nativeTheme.themeSource = parsed.data;
    return parsed.data;
  });
  // Background colour follows the scheme; the transparent drag ghost is not registered and is skipped.
  nativeTheme.on('updated', () => {
    for (const target of [windowRegistry.main(), ...windowRegistry.secondaries()]) if (target && !target.isDestroyed()) target.setBackgroundColor(windowBackground());
  });
  // Broadcast only to main/secondary windows (not the drag ghost window).
  localeStore.subscribe(state => {
    setMainLocale(state.effective);
    const targets = [windowRegistry.main(), ...windowRegistry.secondaries()];
    for (const target of targets) {
      if (!target || target.isDestroyed()) continue;
      target.setTitle(mainT(target === windowRegistry.main() ? 'window.main' : 'window.secondary'));
      if (!target.webContents.isDestroyed()) target.webContents.send(IPC_CHANNELS.appLocaleChanged, state);
    }
  });

  const knownHosts = createKnownHosts();
  registerKnownHostsIpc(knownHosts);
  const prompts = new AuthPrompts({ resolveTarget: resolvePromptTarget, isUnlocked: () => vaultSessionManager.isUnlocked() });
  authPrompts = prompts;
  // One memory of refused sudo passwords for container lists and container tabs.
  const sudoRejections = new SudoRejections();
  const kubes = registerKubernetesIpcHandlers(knownHosts, prompts, sudoRejections);
  kubeSessions = kubes;
  sshSessionManager = registerSshIpcHandlers(knownHosts, prompts, sudoRejections,
    (clusterId, target, size, io) => kubes.openTerminal(clusterId, target, size, io));
  containerDiscovery = registerContainerIpcHandlers(knownHosts, prompts, sudoRejections);
  rdpSessionManager = registerRdpIpcHandlers();
  sftpSessionManager = registerFileIpcHandlers(knownHosts, prompts);
  const ai = registerAiIpcHandlers(windowRegistry);
  assistant = ai.service;
  // Dry run with the form's current values; only the main window may test, nothing is stored or logged.
  ipcMain.handle(IPC_CHANNELS.connectionTest, (event, request: unknown) => {
    windowRegistry.requireMain(event);
    vaultSessionManager.getSnapshot();
    const parsed = ConnectionNodeSchema.safeParse(request);
    if (!parsed.success) throw new AppError('core.invalidConnectionData');
    return testConnection(parsed.data, {
      verifyHost: (host, port, key, isActive) => knownHosts.verify(host, port, key, isActive),
      ask: prompts.ask,
      openJump: node => openJump(node, {
        getConnection: id => findConnection(vaultSessionManager.getSnapshot().vault.nodes, id),
        openRemote: (jump, ownerId) => openRemoteHost(jump, (host, port, key, isActive) => knownHosts.verify(host, port, key, isActive), undefined,
          effectiveTimeouts(vaultSessionManager.getSnapshot().vault.settings, jump), { ask: prompts.ask, ownerId }),
      }),
    });
  });
  ipcMain.handle(IPC_CHANNELS.readClipboardText, event => {
    requireSshSender(event);
    vaultSessionManager.getSnapshot();
    return clipboard.readText();
  });
  ipcMain.handle(IPC_CHANNELS.writeClipboardText, (event, text: unknown) => {
    requireSshSender(event);
    vaultSessionManager.getSnapshot();
    if (typeof text !== 'string' || text.length > 4 * 1024 * 1024) throw new AppError('core.clipboardTooLarge');
    clipboard.writeText(text);
  });
  ipcMain.handle(IPC_CHANNELS.openExternal, async (event, raw: unknown) => {
    requireSshSender(event);
    vaultSessionManager.getSnapshot();
    const href = webLinkHref(raw);
    if (!href) throw new AppError('core.linkNotAllowed');
    await shell.openExternal(href);
  });
  const { broadcastCatalog } = registerWindowIpcHandlers({
    registry: windowRegistry, ssh: sshSessionManager, rdp: rdpSessionManager, sftp: sftpSessionManager, closeOwnerSessions,
    createSecondary: bounds => createWindow('secondary', bounds),
  });
  // Lock and unlock reach every window; the main window learns its own unlock from the IPC result.
  const announce = (channel: string, payload?: unknown): void => {
    for (const target of [windowRegistry.main(), ...windowRegistry.secondaries()])
      if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) target.webContents.send(channel, payload);
  };
  // While locked, every Shellherd window is left out of screen capture and sharing (Windows: WDA_EXCLUDEFROMCAPTURE).
  const protectWindows = (on: boolean): void => {
    captureBlocked = on;
    for (const target of [windowRegistry.main(), ...windowRegistry.secondaries()]) if (target && !target.isDestroyed()) target.setContentProtection(on);
  };
  registerVaultIpcHandlers({
    onSessionChange: () => { closeAllSessions(); closeSecondaryWindows(); protectWindows(false); },
    onLock: () => { sshSessionManager?.stopToolbars(); protectWindows(true); authPrompts?.cancelAll(); announce(IPC_CHANNELS.vaultLocked, {} satisfies VaultLockedInfo); },
    onUnlock: () => { protectWindows(false); autoLock?.touch(); announce(IPC_CHANNELS.vaultUnlocked); },
    onVaultChange: () => { broadcastCatalog(); ai.broadcast(); rdpSessionManager.prewarm(); kubeSessions?.refreshStatus(); },
    guard: event => windowRegistry.requireMain(event),
  });
  autoLock = new AutoLock({
    minutes: () => vaultSessionManager.isUnlocked() ? vaultSessionManager.getSnapshot().vault.settings.autoLockMinutes : 0,
    lock: minutes => { try { vaultSessionManager.lock(); } finally { sshSessionManager?.stopToolbars(); protectWindows(true); authPrompts?.cancelAll(); announce(IPC_CHANNELS.vaultLocked, { minutes } satisfies VaultLockedInfo); } },
    systemIdleSeconds: () => powerMonitor.getSystemIdleTime(),
    rdpConnected: () => rdpSessionManager.hasConnected(),
  });
  autoLock.start();
  powerMonitor.on('resume', () => autoLock?.check());
  // Payload-free ping; only registered windows' main frames count.
  ipcMain.on(IPC_CHANNELS.vaultActivity, event => {
    if (windowRegistry.roleOf(event.sender.id) && event.senderFrame === event.sender.mainFrame) autoLock?.touch();
  });
  // Import reads only after a click in the main window; the vault must be unlocked.
  ipcMain.handle(IPC_CHANNELS.importRead, (event, source: unknown) => {
    windowRegistry.requireMain(event);
    vaultSessionManager.getSnapshot();
    const parsed = z.enum(['openssh', 'putty', 'winscp', 'mremoteng']).safeParse(source);
    if (!parsed.success) throw new AppError('core.invalidRequest');
    return readImport(parsed.data, BrowserWindow.fromWebContents(event.sender));
  });

  // Test hook for the update URL: only a local fake server is accepted.
  const testUpdateUrl = localTestUrl(process.env.SHELLHERD_UPDATE_URL);
  const updates = new UpdateChecker({
    current: app.getVersion(),
    settingsFile,
    url: testUpdateUrl ?? UPDATE_URL,
    now: Date.now,
    isUnlocked: () => vaultSessionManager.isUnlocked(),
    fetch: (url, init) => net.fetch(url, init),
  });
  ipcMain.handle(IPC_CHANNELS.updateStatus, event => { windowRegistry.requireMain(event); return updates.status(); });
  ipcMain.handle(IPC_CHANNELS.updateSetEnabled, (event, enabled: unknown) => {
    windowRegistry.requireMain(event);
    const parsed = z.boolean().safeParse(enabled);
    if (!parsed.success) throw new AppError('core.invalidRequest');
    return updates.setEnabled(parsed.data);
  });
  ipcMain.handle(IPC_CHANNELS.updateSkip, (event, version: unknown) => {
    windowRegistry.requireMain(event);
    const parsed = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/).safeParse(version);
    if (!parsed.success) throw new AppError('core.invalidRequest');
    return updates.skip(parsed.data);
  });

  createMainWindow(settingsFile);

  app.on('activate', () => {
    if (!windowRegistry.main()) {
      createMainWindow(settingsFile);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  autoLock?.dispose();
  closeAllSessions();
  rdpSessionManager?.dispose();
  vaultSessionManager.lock();
});
