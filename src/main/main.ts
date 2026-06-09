/**
 * MeetSpace Electron Main Process
 */
const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  systemPreferences,
  shell,
  Menu,
} = require('electron');
const path = require('path');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const MAIN_SERVER_URL = process.env.MAIN_SERVER_URL || 'http://localhost:3001';
const DEV_PORT = process.env.PORT || 1212;
const isDev = process.env.NODE_ENV === 'development';

let mainWindow: any = null;
let localHttpServer: any = null;
let localWsServer: any = null;
let mainServerWs: any = null;
const peerConnections = new Map<string, any>();

// ── Wait for dev server to be reachable ───────────────────────────────────────
function waitForDevServer(url: string, retries = 20): Promise<void> {
  return new Promise((resolve, reject) => {
    const attempt = (n: number) => {
      http.get(url, (res: any) => {
        resolve();
      }).on('error', () => {
        if (n <= 0) { reject(new Error('Dev server not ready')); return; }
        setTimeout(() => attempt(n - 1), 500);
      });
    };
    attempt(retries);
  });
}

// ── Create Window ─────────────────────────────────────────────────────────────
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#0f0f17',
    webPreferences: {
      preload: isDev
        ? path.join(__dirname, 'preload.bundle.dev.js')
        : path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  });

  Menu.setApplicationMenu(null);

  if (isDev) {
    const devUrl = `http://localhost:${DEV_PORT}/`;
    console.log('[Main] Waiting for dev server:', devUrl);
    try { await waitForDevServer(devUrl); } catch { /* continue anyway */ }
    console.log('[Main] Loading dev server:', devUrl);
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const filePath = `file://${path.join(__dirname, '../renderer/index.html')}`;
    mainWindow.loadURL(filePath);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('did-fail-load', (_: any, code: number, desc: string) => {
    console.error('[Main] Load failed:', code, desc);
    if (isDev) {
      // Retry after 1s if dev server wasn't ready
      setTimeout(() => mainWindow?.loadURL(`http://localhost:${DEV_PORT}/`), 1000);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    cleanup();
  });
}

// ── Local HTTP Server ─────────────────────────────────────────────────────────
function startLocalHttpServer(): Promise<number> {
  return new Promise((resolve) => {
    localHttpServer = http.createServer((req: any, res: any) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(req.url === '/health' ? 200 : 404);
      res.end(JSON.stringify(req.url === '/health' ? { status: 'ok' } : { error: 'Not found' }));
    });
    localHttpServer.listen(0, '127.0.0.1', () => {
      const port = (localHttpServer.address() as any).port;
      console.log('[Local HTTP] port:', port);
      resolve(port);
    });
  });
}

// ── Local WebSocket Server ────────────────────────────────────────────────────
function startLocalWsServer(): Promise<number> {
  return new Promise((resolve) => {
    localWsServer = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    localWsServer.on('connection', (ws: any, req: any) => {
      const params = new URL(req.url || '/', 'http://localhost').searchParams;
      const peerId = params.get('peerId');
      if (!peerId) { ws.close(); return; }
      peerConnections.set(peerId, ws);
      ws.on('message', (data: any) => {
        try { mainWindow?.webContents.send('peer:message', { peerId, ...JSON.parse(data.toString()) }); } catch {}
      });
      ws.on('close', () => {
        peerConnections.delete(peerId);
        mainWindow?.webContents.send('peer:disconnected', { peerId });
      });
    });
    localWsServer.on('listening', () => {
      const port = (localWsServer.address() as any).port;
      console.log('[Local WS] port:', port);
      resolve(port);
    });
  });
}

// ── Main Server WS ────────────────────────────────────────────────────────────
function connectMainServerWs(userId: string, roomId: string, serverUrl: string) {
  const wsUrl = serverUrl.replace('http', 'ws') + `?userId=${userId}&roomId=${roomId}`;
  mainServerWs = new WebSocket(wsUrl);
  mainServerWs.on('open', () => mainWindow?.webContents.send('server:connected'));
  mainServerWs.on('message', (data: any) => {
    try { mainWindow?.webContents.send('server:message', JSON.parse(data.toString())); } catch {}
  });
  mainServerWs.on('close', () => mainWindow?.webContents.send('server:disconnected'));
  mainServerWs.on('error', (err: any) => mainWindow?.webContents.send('server:error', err.message));
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 320, height: 180 } });
    return sources.map((s: any) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
  } catch { return []; }
});
ipcMain.handle('check-permissions', async () => {
  if (process.platform === 'darwin') return { microphone: systemPreferences.getMediaAccessStatus('microphone'), camera: systemPreferences.getMediaAccessStatus('camera') };
  return { microphone: 'granted', camera: 'granted' };
});
ipcMain.handle('request-permission', async (_: any, type: string) => {
  if (process.platform === 'darwin') return systemPreferences.askForMediaAccess(type as any);
  return true;
});
ipcMain.handle('connect-main-server-ws', async (_: any, { userId, roomId, serverUrl }: any) => {
  try { connectMainServerWs(userId, roomId, serverUrl || MAIN_SERVER_URL); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e.message }; }
});
ipcMain.handle('send-server-message', async (_: any, msg: any) => {
  if (mainServerWs?.readyState === 1) { mainServerWs.send(JSON.stringify(msg)); return { ok: true }; }
  return { ok: false, error: 'Not connected' };
});
ipcMain.handle('send-peer-message', async (_: any, { peerId, message }: any) => {
  const peer = peerConnections.get(peerId);
  if (peer?.readyState === 1) { peer.send(JSON.stringify(message)); return { ok: true }; }
  return { ok: false, error: 'Peer not connected' };
});
ipcMain.handle('get-local-server-info', async () => ({
  httpPort: (localHttpServer?.address() as any)?.port,
  wsPort: (localWsServer?.address() as any)?.port,
}));
ipcMain.handle('open-external', async (_: any, url: string) => shell.openExternal(url));

// ── Cleanup ───────────────────────────────────────────────────────────────────
function cleanup() {
  mainServerWs?.close();
  localHttpServer?.close();
  localWsServer?.close();
  peerConnections.forEach((ws) => ws.close());
  peerConnections.clear();
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await startLocalHttpServer();
  await startLocalWsServer();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') { cleanup(); app.quit(); } });
app.on('before-quit', cleanup);
