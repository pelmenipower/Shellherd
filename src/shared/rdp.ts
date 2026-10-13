/** CSS-pixel rectangle relative to the renderer viewport. */
export interface ViewportRect { x: number; y: number; width: number; height: number }

export type RdpSurfaceMode = 'child' | 'owned';

export interface RdpOpenRequest { connectionId: string; bounds: ViewportRect; visible: boolean }
export interface RdpSessionRequest { sessionId: string }
export interface RdpBoundsRequest extends RdpSessionRequest { bounds: ViewportRect }
export interface RdpVisibleRequest extends RdpSessionRequest { visible: boolean }

/** Key actions the RDP helper accepts; anything else is rejected. */
export const RDP_ACTIONS = ['ctrlAltDel', 'taskManager', 'startScreen', 'appSwitch', 'actionCenter'] as const;
export type RdpAction = typeof RDP_ACTIONS[number];
export interface RdpActionRequest extends RdpSessionRequest { action: RdpAction }

export type RdpStatus = 'connecting' | 'connected' | 'closed' | 'error';
export type RdpEvent = { type: 'status'; sessionId: string; status: RdpStatus; message?: string };
