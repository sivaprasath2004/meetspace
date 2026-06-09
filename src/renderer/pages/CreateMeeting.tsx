import React, { useState } from 'react';
import { useApp } from '../App';
import { MeetingService } from '../services/MeetingService';
import { TunnelService } from '../services/TunnelService';

interface Props { sessionUserId: string; }
const tunnelService = new TunnelService();

export default function CreateMeeting({ sessionUserId }: Props) {
  const { setScreen, enterMeeting } = useApp();
  const [title, setTitle]           = useState('End-to-end Data Science Project');
  const [name, setName]             = useState('Brooklyn Simmons');
  const [organisation, setOrg]      = useState('Trivago');
  const [email, setEmail]           = useState('brooklyn@trivago.com');
  const [camOn, setCamOn]           = useState(true);
  const [micOn, setMicOn]           = useState(true);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [createdRoomId, setCreatedRoomId] = useState('');
  const [copied, setCopied]         = useState(false);

  async function handleCreate() {
    if (!name.trim()) { setError('Please enter your name.'); return; }
    setLoading(true); setError('');
    try {
      let publicUrl = 'ws://localhost:4001';
      try {
        const info   = await (window as any).electronAPI?.getLocalServerInfo();
        const tunnel = await tunnelService.createTunnel(info?.wsPort || 4001, info?.httpPort || 4000);
        publicUrl = tunnel.publicUrl;
      } catch { /* browser fallback */ }

      const { roomId } = await MeetingService.createRoom({
        title: title || 'Meeting',
        userId: sessionUserId,
        name: name.trim(),
        email: email.trim(),
        organisation: organisation.trim(),
        publicUrl,
      });

      setCreatedRoomId(roomId);

      try {
        await (window as any).electronAPI?.connectMainServerWs({
          userId: sessionUserId, roomId, serverUrl: MeetingService.serverUrl,
        });
      } catch { /* browser fallback */ }

      enterMeeting(
        { userId:sessionUserId, name:name.trim(), email, organisation, publicUrl },
        { roomId, title: title || 'Meeting', isHost: true },
        [],
      );
    } catch (e: any) {
      setError(e.message || 'Failed to create meeting. Is the server running?');
    } finally { setLoading(false); }
  }

  function copyRoomId() {
    navigator.clipboard.writeText(createdRoomId).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon"><i className="fas fa-video" /></div>
          <div className="auth-logo-text">MeetSpace</div>
        </div>
        <div className="auth-title">Create a new meeting</div>
        <div className="auth-sub">Set up your room and invite participants</div>

        {createdRoomId && (
          <div className="room-id-box">
            <div>
              <div className="room-id-label">Room ID — share this with participants</div>
              <div className="room-id-val">{createdRoomId}</div>
            </div>
            <button className="copy-btn" onClick={copyRoomId}>
              <i className={`fas fa-${copied ? 'check' : 'copy'}`} /> {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}

        <div className="field-wrap">
          <label className="field-label">Meeting title</label>
          <input className="field-input" value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. QA Video Session" />
        </div>
        <div className="field-wrap">
          <label className="field-label">Your name</label>
          <input className="field-input" value={name} onChange={e=>setName(e.target.value)} placeholder="Full name" />
        </div>
        <div className="field-wrap">
          <label className="field-label">Email</label>
          <input className="field-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" />
        </div>
        <div className="field-wrap">
          <label className="field-label">Organisation</label>
          <input className="field-input" value={organisation} onChange={e=>setOrg(e.target.value)} placeholder="Company or team" />
        </div>

        <div className="options-row">
          <div className={`opt-toggle${camOn?' on':''}`} onClick={()=>setCamOn(v=>!v)}>
            <div className="opt-icon"><i className={`fas fa-${camOn?'video':'video-slash'}`} /></div>
            <div><div className="opt-name">Camera</div><div className="opt-status">{camOn?'On':'Off'}</div></div>
          </div>
          <div className={`opt-toggle${micOn?' on':''}`} onClick={()=>setMicOn(v=>!v)}>
            <div className="opt-icon"><i className={`fas fa-${micOn?'microphone':'microphone-slash'}`} /></div>
            <div><div className="opt-name">Microphone</div><div className="opt-status">{micOn?'On':'Off'}</div></div>
          </div>
        </div>

        {error && <div className="error-inline">{error}</div>}

        <button className="btn-primary" onClick={handleCreate} disabled={loading}>
          {loading ? <><i className="fas fa-spinner fa-spin" /> Creating…</> : <><i className="fas fa-plus" /> Create &amp; Start Meeting</>}
        </button>
        <div className="divider">
          <div className="divider-line" /><div className="divider-text">already have a room?</div><div className="divider-line" />
        </div>
        <button className="btn-secondary" onClick={()=>setScreen('join')}>Join an existing meeting</button>

        {/* How to open second instance hint */}
        <div style={{ marginTop:18, padding:'12px 14px', background:'rgba(37,99,235,0.06)', border:'1px solid rgba(37,99,235,0.15)', borderRadius:10 }}>
          <div style={{ fontSize:11, fontWeight:600, color:'var(--accent-light)', marginBottom:4 }}>
            <i className="fas fa-info-circle" style={{ marginRight:6 }} />To join from another window
          </div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.45)', lineHeight:1.6 }}>
            Open a second terminal and run:<br />
            <code style={{ background:'rgba(0,0,0,0.3)', padding:'2px 6px', borderRadius:4, fontSize:11, color:'#93c5fd' }}>
              PORT=1213 npm start
            </code>
            <br />Then click <strong style={{ color:'rgba(255,255,255,0.7)' }}>Join Meeting</strong> and enter the Room ID above.
          </div>
        </div>
      </div>
    </div>
  );
}
