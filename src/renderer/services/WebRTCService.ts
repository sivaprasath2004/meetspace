/**
 * MeetSpace WebRTC Service
 * Full peer-to-peer connection management:
 * - Offer/Answer/ICE exchange via direct peer WebSocket
 * - Audio/Video tracks
 * - Screen sharing
 * - Data channels: Chat, Raise Hand, Remote Control, File Transfer
 */

export interface PeerInfo {
  userId: string;
  name: string;
  email?: string;
  organisation?: string;
  publicUrl: string; // e.g. ws://user-a.domain.com or ws://localhost:PORT
  isHost: boolean;
}

export interface DataMessage {
  type: 'CHAT' | 'RAISE_HAND' | 'LOWER_HAND' | 'REMOTE_CONTROL' | 'FILE_CHUNK' | 'FILE_META' | 'FILE_ACK' | 'PING' | 'MUTE_STATE' | 'SCREEN_SHARE_STATE' | 'REQUEST_CONTROL' | 'GRANT_CONTROL' | 'DENY_CONTROL';
  payload?: any;
  fromUserId?: string;
  timestamp?: number;
}

export type RTCEventType =
  | 'track'
  | 'datachannel'
  | 'connected'
  | 'disconnected'
  | 'data'
  | 'icestatechange'
  | 'file-chunk'
  | 'file-complete';

interface PeerConnection {
  peerId: string;
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  remoteStream: MediaStream | null;
  fileBuffers: Map<string, { chunks: ArrayBuffer[]; meta: any }>;
}

// Self-hosted STUN/TURN config — use your own servers in production
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    // Self-hosted coturn STUN
    { urls: 'stun:stun.meetspace.local:3478' },
    // Self-hosted coturn TURN (replace with real credentials)
    {
      urls: 'turn:turn.meetspace.local:3478',
      username: 'meetspace',
      credential: 'meetspace-secret',
    },
    // Fallback to public STUN during development only
    { urls: 'stun:stun.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

export class WebRTCService {
  private peers = new Map<string, PeerConnection>();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private myUserId: string;
  private eventHandlers = new Map<RTCEventType, Set<Function>>();

  // Signaling: send offer/answer/ICE to a peer
  // In production this goes via the peer's public WS URL
  private signalingFn: (targetUserId: string, msg: object) => void = () => {};

  constructor(userId: string) {
    this.myUserId = userId;
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  setSignalingFn(fn: (targetUserId: string, msg: object) => void) {
    this.signalingFn = fn;
  }

  on(event: RTCEventType, handler: Function) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, new Set());
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: RTCEventType, handler: Function) {
    this.eventHandlers.get(event)?.delete(handler);
  }

  private emit(event: RTCEventType, ...args: any[]) {
    this.eventHandlers.get(event)?.forEach((h) => h(...args));
  }

  // ── Local Media ────────────────────────────────────────────────────────────

  async startLocalStream(video: boolean, audio: boolean): Promise<MediaStream> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } : false,
        audio: audio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
      });
    } catch (e) {
      // Fallback: try audio only
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch {
        this.localStream = new MediaStream();
      }
    }
    return this.localStream;
  }

  getLocalStream() { return this.localStream; }

  async startScreenShare(sourceId?: string): Promise<MediaStream> {
    // Electron: use desktopCapturer source ID
    if (sourceId) {
      this.screenStream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 30,
          },
        },
      });
    } else {
      // Browser fallback
      this.screenStream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { cursor: 'always' },
        audio: false,
      });
    }

    // Replace video track in all peer connections
    this.peers.forEach(({ pc }) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender && this.screenStream?.getVideoTracks()[0]) {
        sender.replaceTrack(this.screenStream.getVideoTracks()[0]);
      }
    });

    // Notify peers via data channel
    this.broadcastData({ type: 'SCREEN_SHARE_STATE', payload: { sharing: true, userId: this.myUserId } });

    this.screenStream.getVideoTracks()[0].addEventListener('ended', () => {
      this.stopScreenShare();
    });

    return this.screenStream;
  }

  stopScreenShare() {
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;

    // Restore camera track
    const videoTrack = this.localStream?.getVideoTracks()[0];
    if (videoTrack) {
      this.peers.forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
      });
    }

    this.broadcastData({ type: 'SCREEN_SHARE_STATE', payload: { sharing: false, userId: this.myUserId } });
  }

  toggleMute(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    this.broadcastData({ type: 'MUTE_STATE', payload: { muted, userId: this.myUserId } });
  }

  toggleVideo(enabled: boolean) {
    this.localStream?.getVideoTracks().forEach((t) => { t.enabled = enabled; });
  }

  // ── Peer Connection Management ─────────────────────────────────────────────

  async connectToPeer(peerInfo: PeerInfo, isInitiator: boolean): Promise<void> {
    if (this.peers.has(peerInfo.userId)) {
      console.log(`[WebRTC] Already connected to ${peerInfo.userId}`);
      return;
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const peer: PeerConnection = {
      peerId: peerInfo.userId,
      pc,
      dataChannel: null,
      remoteStream: new MediaStream(),
      fileBuffers: new Map(),
    };
    this.peers.set(peerInfo.userId, peer);

    // Add local tracks
    this.localStream?.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream!);
    });

    // Handle remote tracks
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        peer.remoteStream!.addTrack(track);
      });
      this.emit('track', { peerId: peerInfo.userId, stream: peer.remoteStream });
    };

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalingFn(peerInfo.userId, {
          type: 'ICE_CANDIDATE',
          candidate: event.candidate.toJSON(),
          fromUserId: this.myUserId,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state with ${peerInfo.userId}: ${pc.iceConnectionState}`);
      this.emit('icestatechange', { peerId: peerInfo.userId, state: pc.iceConnectionState });
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this.emit('connected', { peerId: peerInfo.userId });
      } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        this.emit('disconnected', { peerId: peerInfo.userId });
      }
    };

    // Data channels
    if (isInitiator) {
      // Create data channel (initiator side)
      const dc = pc.createDataChannel('meetspace', { ordered: true });
      peer.dataChannel = dc;
      this.setupDataChannel(dc, peerInfo.userId, peer);

      // Create offer
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
      this.signalingFn(peerInfo.userId, {
        type: 'OFFER',
        sdp: pc.localDescription,
        fromUserId: this.myUserId,
      });
    } else {
      // Receiver side: wait for data channel from initiator
      pc.ondatachannel = (event) => {
        peer.dataChannel = event.channel;
        this.setupDataChannel(event.channel, peerInfo.userId, peer);
      };
    }
  }

  private setupDataChannel(dc: RTCDataChannel, peerId: string, peer: PeerConnection) {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      console.log(`[DataChannel] Open with ${peerId}`);
      this.emit('datachannel', { peerId, channel: dc });
    };

    dc.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // File chunk
        this.handleFileChunk(event.data, peerId, peer);
      } else {
        try {
          const msg: DataMessage = JSON.parse(event.data);
          msg.fromUserId = peerId;
          this.emit('data', msg);
        } catch { /* ignore */ }
      }
    };

    dc.onclose = () => console.log(`[DataChannel] Closed with ${peerId}`);
    dc.onerror = (e) => console.error('[DataChannel Error]', e);
  }

  // ── Signaling Handler (called when we receive a signaling message) ──────────

  async handleSignalingMessage(msg: any): Promise<void> {
    const fromUserId = msg.fromUserId;
    const peer = this.peers.get(fromUserId);

    switch (msg.type) {
      case 'OFFER': {
        const pc = peer?.pc;
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.signalingFn(fromUserId, {
          type: 'ANSWER',
          sdp: pc.localDescription,
          fromUserId: this.myUserId,
        });
        break;
      }
      case 'ANSWER': {
        const pc = peer?.pc;
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        break;
      }
      case 'ICE_CANDIDATE': {
        const pc = peer?.pc;
        if (!pc) return;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (e) {
          console.warn('[ICE] Failed to add candidate', e);
        }
        break;
      }
    }
  }

  // ── Data Channel Messaging ─────────────────────────────────────────────────

  sendData(targetUserId: string, msg: DataMessage) {
    const peer = this.peers.get(targetUserId);
    if (peer?.dataChannel?.readyState === 'open') {
      peer.dataChannel.send(JSON.stringify({ ...msg, timestamp: Date.now() }));
    }
  }

  broadcastData(msg: DataMessage) {
    const payload = JSON.stringify({ ...msg, timestamp: Date.now() });
    this.peers.forEach(({ dataChannel }) => {
      if (dataChannel?.readyState === 'open') {
        dataChannel.send(payload);
      }
    });
  }

  // ── File Transfer ──────────────────────────────────────────────────────────

  async sendFile(targetUserId: string, file: File) {
    const peer = this.peers.get(targetUserId);
    if (!peer?.dataChannel || peer.dataChannel.readyState !== 'open') return;

    const CHUNK_SIZE = 64 * 1024; // 64KB chunks
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Send file metadata first
    peer.dataChannel.send(JSON.stringify({
      type: 'FILE_META',
      payload: { fileId, name: file.name, size: file.size, type: file.type },
    }));

    // Send chunks
    const buffer = await file.arrayBuffer();
    let offset = 0;
    let chunkIndex = 0;
    while (offset < buffer.byteLength) {
      const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
      // Prefix with fileId (8 bytes) + chunkIndex (4 bytes) + isLast (1 byte)
      const header = new ArrayBuffer(13);
      const view = new DataView(header);
      // Store chunk index
      view.setUint32(0, chunkIndex);
      // isLast flag
      view.setUint8(4, offset + CHUNK_SIZE >= buffer.byteLength ? 1 : 0);
      // fileId as first 8 chars encoded as bytes
      const encoder = new TextEncoder();
      const idBytes = encoder.encode(fileId.slice(0, 8));
      const idArray = new Uint8Array(header, 5);
      idArray.set(idBytes.slice(0, 8));

      const packet = new Uint8Array(header.byteLength + chunk.byteLength);
      packet.set(new Uint8Array(header), 0);
      packet.set(new Uint8Array(chunk), header.byteLength);

      peer.dataChannel.send(packet.buffer);
      offset += CHUNK_SIZE;
      chunkIndex++;

      // Throttle to avoid overwhelming buffer
      if (peer.dataChannel.bufferedAmount > 1024 * 1024) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  private handleFileChunk(data: ArrayBuffer, peerId: string, peer: PeerConnection) {
    const view = new DataView(data);
    const chunkIndex = view.getUint32(0);
    const isLast = view.getUint8(4) === 1;
    const decoder = new TextDecoder();
    const fileId = decoder.decode(new Uint8Array(data, 5, 8)).replace(/\0/g, '');
    const chunk = data.slice(13);

    if (!peer.fileBuffers.has(fileId)) {
      peer.fileBuffers.set(fileId, { chunks: [], meta: null });
    }
    const fb = peer.fileBuffers.get(fileId)!;
    fb.chunks[chunkIndex] = chunk;

    if (isLast) {
      const total = new Uint8Array(fb.chunks.reduce((acc, c) => acc + c.byteLength, 0));
      let offset = 0;
      fb.chunks.forEach((c) => { total.set(new Uint8Array(c), offset); offset += c.byteLength; });
      const blob = new Blob([total], { type: fb.meta?.type || 'application/octet-stream' });
      this.emit('file-complete', { peerId, fileId, blob, meta: fb.meta });
      peer.fileBuffers.delete(fileId);
    }
  }

  // ── Remote Control ─────────────────────────────────────────────────────────

  sendRemoteControlEvent(targetUserId: string, event: {
    action: 'mousemove' | 'mousedown' | 'mouseup' | 'click' | 'keydown' | 'keyup' | 'scroll' | 'rightclick';
    x?: number; y?: number;
    key?: string;
    button?: number;
    deltaX?: number; deltaY?: number;
  }) {
    this.sendData(targetUserId, { type: 'REMOTE_CONTROL', payload: event });
  }

  requestScreenControl(targetUserId: string) {
    this.sendData(targetUserId, { type: 'REQUEST_CONTROL', payload: { userId: this.myUserId } });
  }

  grantScreenControl(targetUserId: string) {
    this.sendData(targetUserId, { type: 'GRANT_CONTROL', payload: { userId: this.myUserId } });
  }

  denyScreenControl(targetUserId: string) {
    this.sendData(targetUserId, { type: 'DENY_CONTROL', payload: { userId: this.myUserId } });
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  disconnectPeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.dataChannel?.close();
      peer.pc.close();
      this.peers.delete(peerId);
    }
  }

  disconnectAll() {
    this.peers.forEach((_, peerId) => this.disconnectPeer(peerId));
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.screenStream = null;
  }

  getRemoteStream(peerId: string) {
    return this.peers.get(peerId)?.remoteStream || null;
  }

  isConnected(peerId: string) {
    const peer = this.peers.get(peerId);
    return peer?.pc.iceConnectionState === 'connected' || peer?.pc.iceConnectionState === 'completed';
  }

  getConnectedPeers() {
    return Array.from(this.peers.keys()).filter((id) => this.isConnected(id));
  }
}
