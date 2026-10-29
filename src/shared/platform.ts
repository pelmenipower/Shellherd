import type { LocalShellProtocol } from './vault/types';

export interface PlatformCapabilities {
  platform: string;
  rdp: boolean;
  windowsHello: boolean;
  fileAssociation: boolean;
  registryImport: boolean;
  localShells: LocalShellProtocol[];
}
