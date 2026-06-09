import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useApp, UserInfo, RoomInfo } from '../App';
import { WebRTCService, PeerInfo, DataMessage } from '../services/WebRTCService';
import { MeetingService, Participant } from '../services/MeetingService';

// ── Types ──────────────────────────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  fromUserId: string;
  fromName: string;
  text: string;
  time: string;
  self: boolean;
}
interface ParticipantState extends Participant {
  muted: boolean;
  handRaised: boolean;
  screenSharing: boolean;
  stream: MediaStream | null;
  connected: boolean;
}
interface ControlRequest { fromUserId: string; fromName: string; }
interface FileToast { id: string; name: string; size: number; blob: Blob; fromName: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const AV_COLORS = ['av-blue','av-green','av-purple','av-red','av-amber','av-teal','av-pink','av-slate'];
function avatarColor(id: string) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % AV_COLORS.length; return AV_COLORS[h];
}
function initials(name: string) { return (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function fmtTime(ts: number) { return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }

interface Props { user: UserInfo; room: RoomInfo; initialParticipants: Participant[]; }

export default function Meeting({ user, room, initialParticipants }: Props) {
  const { leaveMeeting } = useApp();

  // ── State ─────────────────────────────────────────────────────────────────
  const [participants, setParticipants] = useState<Map<string,ParticipantState>>(
    () => new Map(initialParticipants.map(p => [p.userId, {...p, muted:false, handRaised:false, screenSharing:false, stream:null, connected:false}]))
  );
  const [activeSpeaker, setActiveSpeaker]     = useState(user.userId);
  const [chatMessages, setChatMessages]       = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]             = useState('');
  const [sideTab, setSideTab]                 = useState<'participants'|'chat'>('participants');
  const [meetTab, setMeetTab]                 = useState<'meeting'|'document'>('meeting');
  const [micMuted, setMicMuted]               = useState(false);
  const [camOff, setCamOff]                   = useState(false);
  const [screenSharing, setScreenSharing]     = useState(false);
  const [handRaised, setHandRaised]           = useState(false);
  const [elapsed, setElapsed]                 = useState(0);
  const [showScreenPicker, setShowScreenPicker] = useState(false);
  const [screenSources, setScreenSources]     = useState<any[]>([]);
  const [showShareBanner, setShowShareBanner] = useState(false);
  const [sharerName, setSharerName]           = useState('');
  const [showReqBar, setShowReqBar]           = useState(false);
  const [controlRequest, setControlRequest]   = useState<ControlRequest|null>(null);
  const [fileToasts, setFileToasts]           = useState<FileToast[]>([]);
  const [pSearch, setPSearch]                 = useState('');
  const [roomIdCopied, setRoomIdCopied]       = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const rtcRef        = useRef<WebRTCService|null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const mainVideoRef  = useRef<HTMLVideoElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const startTimeRef  = useRef(Date.now());
  const serverWsRef   = useRef<WebSocket|null>(null);

  // ── Participant helpers ───────────────────────────────────────────────────
  const updateParticipant = useCallback((uid: string, patch: Partial<ParticipantState>) => {
    setParticipants(prev => {
      const next = new Map(prev);
      const ex = next.get(uid); if (ex) next.set(uid, {...ex, ...patch}); return next;
    });
  }, []);

  const addParticipant = useCallback((p: Participant) => {
    setParticipants(prev => {
      const next = new Map(prev);
      if (!next.has(p.userId)) next.set(p.userId, {...p, muted:false, handRaised:false, screenSharing:false, stream:null, connected:false});
      return next;
    });
  }, []);

  const removeParticipant = useCallback((uid: string) => {
    setParticipants(prev => { const next = new Map(prev); next.delete(uid); return next; });
    rtcRef.current?.disconnectPeer(uid);
    setActiveSpeaker(prev => prev === uid ? user.userId : prev);
  }, [user.userId]);

  // ── Peer connection ───────────────────────────────────────────────────────
  async function connectToParticipant(p: Participant, asInitiator: boolean) {
    if (!rtcRef.current) return;
    await rtcRef.current.connectToPeer({ userId:p.userId, name:p.name, email:p.email, organisation:p.organisation, publicUrl:p.publicUrl, isHost:p.isHost }, asInitiator);
  }

  // ── Signaling setup ───────────────────────────────────────────────────────
  function setupSignaling(rtc: WebRTCService) {
    const isElectron = !!(window as any).electronAPI;
    if (isElectron) {
      rtc.setSignalingFn((targetUserId, msg) => {
        (window as any).electronAPI.sendServerMessage({ ...msg, targetUserId });
      });
      (window as any).electronAPI.on('server:message', (msg: any) => {
        if (msg.type === 'PARTICIPANT_JOINED') {
          addParticipant(msg.participant);
          connectToParticipant(msg.participant, false);
        } else if (msg.type === 'PARTICIPANT_LEFT') {
          removeParticipant(msg.userId);
        } else if (['OFFER','ANSWER','ICE_CANDIDATE'].includes(msg.type)) {
          rtc.handleSignalingMessage(msg);
        }
      });
    } else {
      const wsUrl = MeetingService.serverUrl.replace('http','ws') + `?userId=${user.userId}&roomId=${room.roomId}`;
      const ws = new WebSocket(wsUrl);
      serverWsRef.current = ws;
      rtc.setSignalingFn((targetUserId, msg) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({...msg, targetUserId}));
      });
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'PARTICIPANT_JOINED') { addParticipant(msg.participant); connectToParticipant(msg.participant, false); }
        else if (msg.type === 'PARTICIPANT_LEFT') { removeParticipant(msg.userId); }
        else if (['OFFER','ANSWER','ICE_CANDIDATE'].includes(msg.type)) { rtc.handleSignalingMessage(msg); }
      };
    }
  }

  // ── WebRTC events ─────────────────────────────────────────────────────────
  function setupRTCEvents(rtc: WebRTCService) {
    rtc.on('track', ({ peerId, stream }: any) => {
      updateParticipant(peerId, { stream, connected: true });
    });
    rtc.on('connected', ({ peerId }: any) => updateParticipant(peerId, { connected: true }));
    rtc.on('disconnected', ({ peerId }: any) => updateParticipant(peerId, { connected: false, stream: null }));
    rtc.on('data', (msg: DataMessage) => {
      const peerId = msg.fromUserId!;
      // capture participants at event time via ref trick — use functional setState
      switch (msg.type) {
        case 'CHAT':
          setParticipants(prev => {
            const p = prev.get(peerId);
            setChatMessages(cm => [...cm, {
              id: `${Date.now()}-${peerId}`,
              fromUserId: peerId,
              fromName: p?.name || 'Guest',
              text: msg.payload?.text || '',
              time: fmtTime(msg.timestamp || Date.now()),
              self: false,
            }]);
            return prev;
          });
          break;
        case 'RAISE_HAND':   updateParticipant(peerId, { handRaised: true });  break;
        case 'LOWER_HAND':   updateParticipant(peerId, { handRaised: false }); break;
        case 'MUTE_STATE':   updateParticipant(peerId, { muted: msg.payload?.muted }); break;
        case 'SCREEN_SHARE_STATE':
          updateParticipant(peerId, { screenSharing: msg.payload?.sharing });
          if (msg.payload?.sharing) {
            setParticipants(prev => { const p = prev.get(peerId); setSharerName(p?.name||'Someone'); return prev; });
            setShowReqBar(true);
          } else { setShowReqBar(false); }
          break;
        case 'REQUEST_CONTROL':
          setParticipants(prev => { const p = prev.get(peerId); setControlRequest({ fromUserId:peerId, fromName:p?.name||'Someone' }); return prev; });
          setShowShareBanner(true);
          break;
        case 'GRANT_CONTROL': break;
        case 'DENY_CONTROL':  break;
        case 'REMOTE_CONTROL': executeRemoteControl(msg.payload); break;
      }
    });
    rtc.on('file-complete', ({ peerId, fileId, blob, meta }: any) => {
      setParticipants(prev => {
        const p = prev.get(peerId);
        setFileToasts(ft => [...ft, { id: fileId, name: meta?.name||'file', size: meta?.size||blob.size, blob, fromName: p?.name||'Someone' }]);
        return prev;
      });
      setTimeout(() => setFileToasts(ft => ft.filter(f => f.id !== fileId)), 15000);
    });
  }

  function executeRemoteControl(event: any) {
    const el = document.elementFromPoint(event.x, event.y);
    if (!el) return;
    if (event.action === 'click') (el as HTMLElement).click?.();
    if (event.action === 'keydown') document.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, bubbles: true }));
  }

  // ── Mount ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const rtc = new WebRTCService(user.userId);
    rtcRef.current = rtc;
    setupSignaling(rtc);
    setupRTCEvents(rtc);

    // Start local media
    rtc.startLocalStream(true, true).then(stream => {
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      // Show local stream in main video immediately
      if (mainVideoRef.current) mainVideoRef.current.srcObject = stream;
    }).catch(() => {
      rtc.startLocalStream(false, true).then(stream => {
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        if (mainVideoRef.current) mainVideoRef.current.srcObject = stream;
      }).catch(console.error);
    });

    // Connect to existing peers as initiator
    initialParticipants.forEach(p => { if (p.userId !== user.userId) connectToParticipant(p, true); });

    // Timer
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000);

    return () => {
      clearInterval(timer);
      rtc.disconnectAll();
      serverWsRef.current?.close();
      MeetingService.leaveRoom(room.roomId, user.userId).catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll chat
  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // Main video tracks active speaker
  useEffect(() => {
    if (!mainVideoRef.current) return;
    if (activeSpeaker === user.userId) {
      mainVideoRef.current.srcObject = rtcRef.current?.getLocalStream() || null;
    } else {
      const p = participants.get(activeSpeaker);
      mainVideoRef.current.srcObject = p?.stream || null;
    }
  }, [activeSpeaker, participants, user.userId]);

  // ── Controls ──────────────────────────────────────────────────────────────
  function toggleMic() {
    const next = !micMuted; setMicMuted(next);
    rtcRef.current?.toggleMute(next);
  }
  function toggleCam() {
    const next = !camOff; setCamOff(next);
    rtcRef.current?.toggleVideo(!next);
  }
  function toggleHand() {
    const next = !handRaised; setHandRaised(next);
    rtcRef.current?.broadcastData({ type: next ? 'RAISE_HAND' : 'LOWER_HAND' });
  }

  async function startScreenShare(sourceId?: string) {
    try {
      const stream = await rtcRef.current!.startScreenShare(sourceId);
      setScreenSharing(true); setShowScreenPicker(false);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      if (activeSpeaker === user.userId && mainVideoRef.current) mainVideoRef.current.srcObject = stream;
    } catch (e) { console.error('Screen share failed', e); }
  }
  function stopScreenShare() {
    rtcRef.current?.stopScreenShare(); setScreenSharing(false);
    const s = rtcRef.current?.getLocalStream() || null;
    if (localVideoRef.current) localVideoRef.current.srcObject = s;
    if (activeSpeaker === user.userId && mainVideoRef.current) mainVideoRef.current.srcObject = s;
  }
  async function openScreenPicker() {
    if (screenSharing) { stopScreenShare(); return; }
    const isElectron = !!(window as any).electronAPI;
    if (isElectron) {
      const sources = await (window as any).electronAPI.getDesktopSources();
      setScreenSources(sources); setShowScreenPicker(true);
    } else { startScreenShare(); }
  }

  function sendChatMessage() {
    const text = chatInput.trim(); if (!text) return;
    rtcRef.current?.broadcastData({ type: 'CHAT', payload: { text } });
    setChatMessages(prev => [...prev, { id:`${Date.now()}-self`, fromUserId:user.userId, fromName:user.name, text, time:fmtTime(Date.now()), self:true }]);
    setChatInput('');
  }

  async function handleLeaveMeeting() {
    await MeetingService.leaveRoom(room.roomId, user.userId).catch(() => {});
    rtcRef.current?.disconnectAll();
    serverWsRef.current?.close();
    leaveMeeting();
  }

  function allowControl() {
    if (controlRequest) rtcRef.current?.grantScreenControl(controlRequest.fromUserId);
    setShowShareBanner(false); setControlRequest(null);
  }
  function denyControl() {
    if (controlRequest) rtcRef.current?.denyScreenControl(controlRequest.fromUserId);
    setShowShareBanner(false); setControlRequest(null);
  }
  function downloadFile(toast: FileToast) {
    const url = URL.createObjectURL(toast.blob);
    Object.assign(document.createElement('a'), { href:url, download:toast.name }).click();
    URL.revokeObjectURL(url);
  }
  function copyRoomId() {
    navigator.clipboard.writeText(room.roomId).catch(() => {});
    setRoomIdCopied(true); setTimeout(() => setRoomIdCopied(false), 2000);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const mins = String(Math.floor(elapsed / 60)).padStart(2,'0');
  const secs = String(elapsed % 60).padStart(2,'0');
  const participantList = Array.from(participants.values()).filter(p =>
    !pSearch || p.name.toLowerCase().includes(pSearch.toLowerCase())
  );
  const thumbList = [
    { userId: user.userId, name: user.name, isSelf: true },
    ...Array.from(participants.values()).map(p => ({ userId:p.userId, name:p.name, isSelf:false })),
  ];
  const activeSpeakerName = activeSpeaker === user.userId
    ? user.name + ' (You)'
    : participants.get(activeSpeaker)?.name || 'Unknown';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="meeting-outer">
      <div className="meeting-wrap">

        {/* ── TOP BAR ── */}
        <div className="meet-top">
          {/* Left: project + title */}
          <div className="meet-top-left">
            <div>
              <div className="meet-project">{room.title}</div>
              <div className="meet-title">QA Video Session</div>
            </div>
            {/* Room ID badge — clickable to copy */}
            <div className="room-id-badge" onClick={copyRoomId} title="Click to copy Room ID">
              <div>
                <div className="room-id-badge-label">Room ID</div>
                <div className="room-id-badge-val">{room.roomId}</div>
              </div>
              <span className={roomIdCopied ? 'room-id-copied' : 'room-id-badge-copy'}>
                <i className={`fas fa-${roomIdCopied ? 'check' : 'copy'}`} />
                {roomIdCopied ? ' Copied!' : ' Copy'}
              </span>
            </div>
          </div>

          {/* Centre: Document / Meeting tabs */}
          <div className="meet-tabs">
            <button className={`meet-tab${meetTab==='document'?' active':''}`} onClick={()=>setMeetTab('document')}>Document</button>
            <button className={`meet-tab${meetTab==='meeting'?' active':''}`}  onClick={()=>setMeetTab('meeting')}>Meeting</button>
          </div>

          {/* Right: timer only, no REC */}
          <div className="timer-wrap">
            <i className="fas fa-clock timer-icon" />
            <span className="timer-lbl">{mins}:{secs}</span>
          </div>
        </div>

        {/* ── BODY ── */}
        <div className="meet-body">

          {/* ── MAIN VIDEO AREA ── */}
          <div className="meet-main">

            {/* Grant control banner */}
            {showShareBanner && controlRequest && (
              <div className="share-request-banner">
                <div className="banner-icon"><i className="fas fa-desktop" /></div>
                <div>
                  <div className="banner-text">{controlRequest.fromName} wants to control your screen</div>
                  <div className="banner-sub">They'll be able to move your mouse and use keyboard</div>
                </div>
                <div className="banner-actions">
                  <button className="ban-allow" onClick={allowControl}>Allow</button>
                  <button className="ban-deny"  onClick={denyControl}>Deny</button>
                </div>
              </div>
            )}

            {/* Main video */}
            <div className="main-video">
              <div className="vid-placeholder">
                <div className="vid-radial" />
                {/* Avatar — shown when no video */}
                <div
                  className={`vid-avatar-big ${avatarColor(activeSpeaker)}`}
                  style={{ display: 'none' }}
                  id="main-avatar"
                >
                  {activeSpeaker === user.userId ? initials(user.name) : initials(participants.get(activeSpeaker)?.name || '?')}
                </div>
                <video
                  ref={mainVideoRef}
                  className="vid-el"
                  autoPlay
                  muted={activeSpeaker === user.userId}
                  playsInline
                  onLoadedMetadata={e => { (e.target as HTMLVideoElement).play().catch(()=>{}); }}
                />
              </div>
              <div className="vid-name-tag">
                <div className="speaking-dot" />
                <span>{activeSpeakerName}</span>
              </div>
            </div>

            {/* Screen share request bar */}
            {showReqBar && (
              <div className="req-access-bar">
                <div className="req-icon"><i className="fas fa-desktop" /></div>
                <div className="req-text">
                  <strong>{sharerName}</strong> is sharing their screen —{' '}
                  <span className="req-link" onClick={() => {
                    const sharer = Array.from(participants.values()).find(p=>p.screenSharing);
                    if (sharer) rtcRef.current?.requestScreenControl(sharer.userId);
                  }}>Request control</span>
                </div>
                <button className="req-allow" onClick={() => {
                  const sharer = Array.from(participants.values()).find(p=>p.screenSharing);
                  if (sharer) rtcRef.current?.requestScreenControl(sharer.userId);
                }}>Request Access</button>
                <button className="req-deny" onClick={()=>setShowReqBar(false)}>✕</button>
              </div>
            )}

            {/* ── THUMBNAIL STRIP ── */}
            <div className="thumb-row">
              {thumbList.map(({ userId, name, isSelf }) => {
                const p       = isSelf ? null : participants.get(userId);
                const isActive = activeSpeaker === userId;
                const hasMic   = isSelf ? !micMuted : !p?.muted;
                const hasHand  = isSelf ? handRaised : p?.handRaised;
                return (
                  <div
                    key={userId}
                    className={`thumb${isActive?' active-thumb':''}`}
                    onClick={() => setActiveSpeaker(userId)}
                  >
                    <div className={`thumb-inner ${avatarColor(userId)}`}>
                      {isSelf ? initials(user.name) : initials(p?.name||'?')}
                    </div>
                    {/* Local video in self thumb */}
                    {isSelf && (
                      <video
                        ref={localVideoRef}
                        autoPlay muted playsInline
                        style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', display: camOff ? 'none' : 'block' }}
                        onLoadedMetadata={e => { (e.target as HTMLVideoElement).play().catch(()=>{}); }}
                      />
                    )}
                    <div className="thumb-label">{isSelf ? 'You' : name}</div>
                    {hasHand && <div className="hand-badge">✋</div>}
                    <div className={`thumb-mic ${hasMic ? 'mic-on' : 'mic-off'}`}>
                      <i className={`fas fa-${hasMic?'microphone':'microphone-slash'}`} style={{ color:'#fff', fontSize:9 }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── CONTROLS ── */}
            <div className="controls">
              <div className={`ctrl-btn${!camOff?' active-ctrl':''}`} onClick={toggleCam}>
                <i className={`fas fa-${camOff?'video-slash':'video'}`} />
                <div className="ctrl-tooltip">{camOff?'Start Camera':'Stop Camera'}</div>
              </div>
              <div className={`ctrl-btn${!micMuted?' active-ctrl':''}`} onClick={toggleMic}>
                <i className={`fas fa-${micMuted?'microphone-slash':'microphone'}`} />
                <div className="ctrl-tooltip">{micMuted?'Unmute':'Mute'}</div>
              </div>
              <div className="ctrl-sep" />
              <div className={`ctrl-btn${screenSharing?' active-ctrl':''}`} onClick={openScreenPicker}>
                <i className="fas fa-desktop" />
                <div className="ctrl-tooltip">{screenSharing?'Stop Sharing':'Share Screen'}</div>
              </div>
              <div className={`ctrl-btn${handRaised?' active-ctrl':''}`} onClick={toggleHand}>
                <i className="fas fa-hand-paper" />
                <div className="ctrl-tooltip">{handRaised?'Lower Hand':'Raise Hand'}</div>
              </div>
              <div className={`ctrl-btn${sideTab==='chat'?' active-ctrl':''}`} onClick={()=>setSideTab('chat')}>
                <i className="fas fa-comment-alt" />
                <div className="ctrl-tooltip">Chat</div>
              </div>
              <div className={`ctrl-btn${sideTab==='participants'?' active-ctrl':''}`} onClick={()=>setSideTab('participants')}>
                <i className="fas fa-users" />
                <div className="ctrl-tooltip">Participants</div>
              </div>
              <div className="ctrl-sep" />
              <div className="ctrl-btn">
                <i className="fas fa-ellipsis-h" />
                <div className="ctrl-tooltip">More</div>
              </div>
              <div className="ctrl-sep" />
              <div className="ctrl-btn danger ctrl-end" onClick={handleLeaveMeeting}>
                <i className="fas fa-phone-slash" />
                <div className="ctrl-tooltip">Leave</div>
              </div>
            </div>
          </div>

          {/* ── SIDEBAR ── */}
          <div className="meet-sidebar">
            <div className="sidebar-tabs">
              <div className={`stab${sideTab==='chat'?' active':''}`} onClick={()=>setSideTab('chat')}>
                Chat
              </div>
              <div className={`stab${sideTab==='participants'?' active':''}`} onClick={()=>setSideTab('participants')}>
                Participants <span className="stab-count">{participants.size + 1}</span>
              </div>
            </div>

            {/* PARTICIPANTS */}
            {sideTab === 'participants' && (
              <div style={{ display:'flex', flexDirection:'column', flex:1, overflow:'hidden', minHeight:0 }}>
                <div className="sidebar-search">
                  <div className="search-wrap">
                    <i className="fas fa-search" />
                    <input className="search-inp" placeholder="Search for people" value={pSearch} onChange={e=>setPSearch(e.target.value)} />
                  </div>
                </div>
                <div className="participants-list">
                  <div className="p-section-label">On the call</div>

                  {/* Self */}
                  <div className="p-row">
                    <div className={`p-avatar ${avatarColor(user.userId)}`}>
                      <div className="p-avatar-inner" style={{ background:'inherit' }}>
                        {initials(user.name)}
                      </div>
                      <div className="p-avatar-status" />
                    </div>
                    <div className="p-info">
                      <div className="p-name">{user.name} (You)</div>
                      <div className="p-company">{user.organisation}</div>
                    </div>
                    <div className={`p-action ${micMuted?'muted':'speaking'}`}>
                      <i className={`fas fa-${micMuted?'microphone-slash':'microphone'}`} style={{ fontSize:10, color:'#fff' }} />
                    </div>
                  </div>

                  {/* Other participants */}
                  {participantList.map(p => (
                    <div key={p.userId} className="p-row">
                      <div className={`p-avatar ${avatarColor(p.userId)}`}>
                        <div className="p-avatar-inner" style={{ background:'inherit' }}>
                          {initials(p.name)}
                        </div>
                        {p.connected && <div className="p-avatar-status" />}
                      </div>
                      <div className="p-info">
                        <div className="p-name">{p.name}</div>
                        <div className="p-company">{p.organisation}</div>
                      </div>
                      <div className={`p-action ${p.muted?'muted':'more'}`}>
                        <i className={`fas fa-${p.muted?'microphone-slash':'ellipsis-h'}`} style={{ fontSize:10, color:'#fff' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CHAT */}
            {sideTab === 'chat' && (
              <div className="chat-panel">
                <div className="chat-area">
                  {chatMessages.length === 0 ? (
                    <div className="chat-empty">
                      <i className="fas fa-comments" />
                      <p>No messages yet</p>
                      <p style={{ fontSize:11, color:'var(--text-dim)' }}>Say something to the group!</p>
                    </div>
                  ) : (
                    chatMessages.map(msg => (
                      <div key={msg.id} className={`chat-msg${msg.self?' self':''}`}>
                        <div className="chat-msg-header">
                          <div className={`chat-av ${msg.self ? 'av-blue' : avatarColor(msg.fromUserId)}`}>
                            {initials(msg.fromName)}
                          </div>
                          <span className="chat-sender">{msg.fromName}</span>
                          <span className="chat-time">{msg.time}</span>
                        </div>
                        <div className={`chat-bubble${msg.self?' mine':''}`}>{msg.text}</div>
                      </div>
                    ))
                  )}
                  <div ref={chatBottomRef} />
                </div>
                <div className="chat-input-wrap">
                  <input
                    className="chat-inp"
                    placeholder="Type a message…"
                    value={chatInput}
                    onChange={e=>setChatInput(e.target.value)}
                    onKeyDown={e=>e.key==='Enter' && sendChatMessage()}
                  />
                  <button className="chat-send" onClick={sendChatMessage}>
                    <i className="fas fa-paper-plane" style={{ fontSize:13 }} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── SCREEN PICKER OVERLAY ── */}
      {showScreenPicker && (
        <div className="screen-share-overlay">
          <h3 style={{ fontSize:16, fontWeight:600 }}>Choose what to share</h3>
          <p style={{ fontSize:13, color:'var(--text-muted)' }}>Select a window or your entire screen</p>
          <div className="source-grid">
            {screenSources.map(src => (
              <div key={src.id} className="source-item" onClick={()=>startScreenShare(src.id)}>
                <img src={src.thumbnail} alt={src.name} />
                <div className="source-item-name">{src.name}</div>
              </div>
            ))}
          </div>
          <button className="overlay-close" onClick={()=>setShowScreenPicker(false)}>Cancel</button>
        </div>
      )}

      {/* ── FILE TOASTS ── */}
      {fileToasts.map((toast, i) => (
        <div key={toast.id} className="file-toast" style={{ bottom: 24 + i * 90 }}>
          <div className="file-toast-icon"><i className="fas fa-file" /></div>
          <div>
            <div className="file-toast-name">{toast.name}</div>
            <div className="file-toast-sub">From {toast.fromName} · {(toast.size/1024).toFixed(1)} KB</div>
          </div>
          <button className="file-toast-dl" onClick={()=>downloadFile(toast)}>
            <i className="fas fa-download" style={{ marginRight:6 }} />Download
          </button>
        </div>
      ))}
    </div>
  );
}
