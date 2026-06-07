/**
 * MeetSpace Preload Script
 * Exposes safe, typed APIs to the renderer process via contextBridge
 */

import { contextBridge, ipcRenderer } from 'electron';

// ── Types ──────────────────────────────────────────────────────────────────────
export type Channels =
  | 'server:connected'
  | 'server:disconnected'
  | 'server:message'
  | 'server:error'
  | 'peer:message'
  | 'peer:disconnected';

// ── Expose APIs ────────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  // Desktop capture sources (for screen sharing)
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

  // Media permissions
  checkPermissions: () => ipcRenderer.invoke('check-permissions'),
  requestPermission: (type: 'microphone' | 'camera') =>
    ipcRenderer.invoke('request-permission', type),

  // Main server WebSocket connection
  connectMainServerWs: (opts: { userId: string; roomId: string; serverUrl?: string }) =>
    ipcRenderer.invoke('connect-main-server-ws', opts),

  // Send relay signaling message through main server WS
  sendServerMessage: (msg: object) => ipcRenderer.invoke('send-server-message', msg),

  // Send message directly to a peer via their local WS
  sendPeerMessage: (peerId: string, message: object) =>
    ipcRenderer.invoke('send-peer-message', { peerId, message }),

  // Get local server ports
  getLocalServerInfo: () => ipcRenderer.invoke('get-local-server-info'),

  // Open external URL
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // Event listeners from main process
  on: (channel: Channels, listener: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => listener(...args));
  },
  off: (channel: Channels, listener: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, listener);
  },
  once: (channel: Channels, listener: (...args: any[]) => void) => {
    ipcRenderer.once(channel, (_event, ...args) => listener(...args));
  },
});
