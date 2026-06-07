/**
 * MeetSpace Electron Main Process
 * - Creates BrowserWindow
 * - Starts Local HTTP Server (for health checks / internal comms)
 * - Starts Local WebSocket Server (for peer signaling)
 * - Creates public tunnel endpoint
 * - Registers endpoint with Main Server
 * - Manages IPC between renderer and native APIs
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  systemPreferences,
  shell,
  Menu,
} from 'electron';
import path from 'path';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

// ── Constants ──────────────────────────────────────────────────────────────────
const MAIN_SERVER_URL = process.env.MAIN_SERVER_URL || 'http://localhost:3001';
const LOCAL_HTTP_PORT = 0; // OS assigns free port
const LOCAL_WS_PORT = 0;   // OS assigns free port

// ── App State ──────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let localHttpServer: http.Server | null = null;
let localWsServer: WebSocketServer | null = null;
let mainServerWs: WebSocket | null = null;

// Peer connections map: peerId -> WebSocket (direct peer ws connection)
const peerConnections = new Map<string, WebSocket>();

// ── Resolve HTML path ──────────────────────────────────────────────────────────
function resolveHtmlPath(htmlFileName: string) {
  if (process.env.NODE_ENV === 'development') {
    const port = process.env.PORT || 1212;
    const url = new URL(`http://localhost:${port}`);
    url.pathname = htmlFileName;
    return url.href;
  }
  return `file://${path.resolve(__dirname, '../renderer/', htmlFileName)}`;
}

// ── Create Window ──────────────────────────────────────────────────────────────
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f17',
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.bundle.dev.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // Required for WebRTC getUserMedia in Electron
      allowRunningInsecureContent: false,
    },
    show: false,
    icon: path.join(__dirname, '../../assets/icon.png'),
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (process.env.NODE_ENV === 'development') {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    cleanup();
  });

  // Remove default menu in production
  if (app.isPackaged) {
    Menu.setApplicationMenu(null);
  }
}

// ── Local HTTP Server (health checks, internal comms) ─────────────────────────
function startLocalHttpServer(): Promise<number> {
  return new Promise((resolve) => {
    localHttpServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', app: 'meetspace-client' }));
      } else if (req.method === 'GET' && req.url === '/info') {
        res.writeHead(200);
        res.end(JSON.stringify({ app: 'meetspace-desktop', version: app.getVersion() }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    localHttpServer.listen(LOCAL_HTTP_PORT, '0.0.0.0', () => {
      const addr = localHttpServer!.address() as { port: number };
      console.log(`[Local HTTP] Running on port ${addr.port}`);
      resolve(addr.port);
    });
  });
}

// ── Local WebSocket Server (peer signaling & event exchange) ──────────────────
function startLocalWsServer(): Promise<number> {
  return new Promise((resolve) => {
    localWsServer = new WebSocketServer({ port: LOCAL_WS_PORT, host: '0.0.0.0' });

    localWsServer.on('connection', (ws, req) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const peerId = url.searchParams.get('peerId');
      if (!peerId) { ws.close(); return; }

      peerConnections.set(peerId, ws);
      console.log(`[Peer WS] Connected: ${peerId}`);

      // Forward peer messages to renderer
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          mainWindow?.webContents.send('peer:message', { peerId, ...msg });
        } catch (e) { /* ignore */ }
      });

      ws.on('close', () => {
        peerConnections.delete(peerId);
        mainWindow?.webContents.send('peer:disconnected', { peerId });
        console.log(`[Peer WS] Disconnected: ${peerId}`);
      });

      ws.on('error', (err) => console.error('[Peer WS Error]', err.message));
    });

    localWsServer.on('listening', () => {
      const addr = localWsServer!.address() as { port: number };
      console.log(`[Local WS] Running on port ${addr.port}`);
      resolve(addr.port);
    });
  });
}

// ── Connect to Main Server WebSocket (for room events) ────────────────────────
function connectMainServerWs(userId: string, roomId: string, mainServerUrl: string) {
  const wsUrl = mainServerUrl.replace('http', 'ws') + `?userId=${userId}&roomId=${roomId}`;
  mainServerWs = new WebSocket(wsUrl);

  mainServerWs.on('open', () => {
    console.log('[Main Server WS] Connected');
    mainWindow?.webContents.send('server:connected');
  });

  mainServerWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('[Main Server WS] Message:', msg.type);
      mainWindow?.webContents.send('server:message', msg);
    } catch (e) { /* ignore */ }
  });

  mainServerWs.on('close', () => {
    console.log('[Main Server WS] Disconnected');
    mainWindow?.webContents.send('server:disconnected');
  });

  mainServerWs.on('error', (err) => {
    console.error('[Main Server WS Error]', err.message);
    mainWindow?.webContents.send('server:error', err.message);
  });
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

// Get desktop sources for screen sharing
ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
    }));
  } catch (e) {
    return [];
  }
});

// Check/request media permissions
ipcMain.handle('check-permissions', async () => {
  if (process.platform === 'darwin') {
    const mic = systemPreferences.getMediaAccessStatus('microphone');
    const cam = systemPreferences.getMediaAccessStatus('camera');
    return { microphone: mic, camera: cam };
  }
  return { microphone: 'granted', camera: 'granted' };
});

ipcMain.handle('request-permission', async (_, type: 'microphone' | 'camera') => {
  if (process.platform === 'darwin') {
    return await systemPreferences.askForMediaAccess(type);
  }
  return true;
});

// Connect to main server WebSocket
ipcMain.handle('connect-main-server-ws', async (_, { userId, roomId, serverUrl }) => {
  try {
    connectMainServerWs(userId, roomId, serverUrl || MAIN_SERVER_URL);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

// Send message via main server WebSocket (for signaling relay)
ipcMain.handle('send-server-message', async (_, msg: object) => {
  if (mainServerWs && mainServerWs.readyState === WebSocket.OPEN) {
    mainServerWs.send(JSON.stringify(msg));
    return { ok: true };
  }
  return { ok: false, error: 'Not connected' };
});

// Send message to a specific peer via their local WS
ipcMain.handle('send-peer-message', async (_, { peerId, message }: { peerId: string; message: object }) => {
  const peer = peerConnections.get(peerId);
  if (peer && peer.readyState === WebSocket.OPEN) {
    peer.send(JSON.stringify(message));
    return { ok: true };
  }
  return { ok: false, error: 'Peer not connected' };
});

// Get local server info
ipcMain.handle('get-local-server-info', async () => {
  return {
    httpPort: (localHttpServer?.address() as { port: number })?.port,
    wsPort: (localWsServer?.address() as { port: number })?.port,
  };
});

// Open external link
ipcMain.handle('open-external', async (_, url: string) => {
  await shell.openExternal(url);
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
function cleanup() {
  mainServerWs?.close();
  localHttpServer?.close();
  localWsServer?.close();
  peerConnections.forEach((ws) => ws.close());
  peerConnections.clear();
}

// ── App Lifecycle ──────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Start local servers
  await startLocalHttpServer();
  await startLocalWsServer();

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    cleanup();
    app.quit();
  }
});

app.on('before-quit', cleanup);
