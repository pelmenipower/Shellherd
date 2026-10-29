import { createContext } from 'react';
import { DEFAULT_TOOLBAR, type ToolbarConfig } from '../../shared/toolbar';
export const ToolbarContext = createContext<{ config: ToolbarConfig; active: boolean; saving?: boolean; save?: (config: ToolbarConfig) => Promise<boolean> }>({ config: DEFAULT_TOOLBAR, active: false });
