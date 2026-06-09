/**
 * MeetSpace Preload — exposes safe IPC APIs to renderer via contextBridge
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

  checkPermissions: () => ipcRenderer.invoke('check-permissions'),
  requestPermission: (type: string) => ipcRenderer.invoke('request-permission', type),

  connectMainServerWs: (opts: { userId: string; roomId: string; serverUrl?: string }) =>
    ipcRenderer.invoke('connect-main-server-ws', opts),

  sendServerMessage: (msg: object) => ipcRenderer.invoke('send-server-message', msg),

  sendPeerMessage: (peerId: string, message: object) =>
    ipcRenderer.invoke('send-peer-message', { peerId, message }),

  getLocalServerInfo: () => ipcRenderer.invoke('get-local-server-info'),

  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  on: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_event: any, ...args: any[]) => listener(...args));
  },
  off: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, listener);
  },
  once: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.once(channel, (_event: any, ...args: any[]) => listener(...args));
  },
});
