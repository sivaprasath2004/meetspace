import React, { useState } from 'react';
import { useApp } from '../App';
import { MeetingService } from '../services/MeetingService';
import { TunnelService } from '../services/TunnelService';
import { v4 as uuidv4 } from 'uuid';

interface Props {
  sessionUserId: string;
}

const tunnelService = new TunnelService();

export default function CreateMeeting({ sessionUserId }: Props) {
  const { setScreen, enterMeeting } = useApp();

  const [title, setTitle] = useState('End-to-end Data Science Project');
  const [name, setName] = useState('Brooklyn Simmons');
  const [organisation, setOrganisation] = useState('Trivago');
  const [email, setEmail] = useState('brooklyn@trivago.com');
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdRoomId, setCreatedRoomId] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    if (!name.trim()) { setError('Please enter your name.'); return; }
    setLoading(true);
    setError('');
    try {
      // Get local server info for tunnel
      let publicUrl = 'ws://localhost:4001';
      try {
        const info = await (window as any).electronAPI?.getLocalServerInfo();
        const tunnel = await tunnelService.createTunnel(info?.wsPort || 4001, info?.httpPort || 4000);
        publicUrl = tunnel.publicUrl;
      } catch { /* running in browser, use fallback */ }

      const { roomId, participant } = await MeetingService.createRoom({
        title: title || 'Meeting',
        userId: sessionUserId,
        name: name.trim(),
        email: email.trim(),
        organisation: organisation.trim(),
        publicUrl,
      });

      setCreatedRoomId(roomId);

      // Connect to main server WebSocket for room events
      try {
        await (window as any).electronAPI?.connectMainServerWs({
          userId: sessionUserId,
          roomId,
          serverUrl: MeetingService.serverUrl,
        });
      } catch { /* browser fallback — WS handled in renderer */ }

      enterMeeting(
        { userId: sessionUserId, name: name.trim(), email, organisation, publicUrl },
        { roomId, title: title || 'Meeting', isHost: true },
        [],
      );
    } catch (e: any) {
      setError(e.message || 'Failed to create meeting. Is the server running?');
    } finally {
      setLoading(false);
    }
  }

  function copyRoomId() {
    navigator.clipboard.writeText(createdRoomId).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
              <div className="room-id-label">Room ID — share with participants</div>
              <div className="room-id-val">{createdRoomId}</div>
            </div>
            <button className="copy-btn" onClick={copyRoomId}>
              <i className={`fas fa-${copied ? 'check' : 'copy'}`} /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}

        <div className="field-wrap">
          <label className="field-label">Meeting title</label>
          <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. QA Video Session" />
        </div>
        <div className="field-wrap">
          <label className="field-label">Your name</label>
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </div>
        <div className="field-wrap">
          <label className="field-label">Email</label>
          <input className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" type="email" />
        </div>
        <div className="field-wrap">
          <label className="field-label">Organisation</label>
          <input className="field-input" value={organisation} onChange={(e) => setOrganisation(e.target.value)} placeholder="Company or team" />
        </div>

        <div className="options-row">
          <div className={`opt-toggle${camOn ? ' on' : ''}`} onClick={() => setCamOn((v) => !v)}>
            <div className="opt-icon"><i className={`fas fa-${camOn ? 'video' : 'video-slash'}`} /></div>
            <div>
              <div className="opt-name">Camera</div>
              <div className="opt-status">{camOn ? 'On' : 'Off'}</div>
            </div>
          </div>
          <div className={`opt-toggle${micOn ? ' on' : ''}`} onClick={() => setMicOn((v) => !v)}>
            <div className="opt-icon"><i className={`fas fa-${micOn ? 'microphone' : 'microphone-slash'}`} /></div>
            <div>
              <div className="opt-name">Microphone</div>
              <div className="opt-status">{micOn ? 'On' : 'Off'}</div>
            </div>
          </div>
        </div>

        {error && <div className="error-toast" style={{position:'static',marginBottom:12}}>{error}</div>}

        <button className="btn-primary" onClick={handleCreate} disabled={loading}>
          {loading
            ? <><i className="fas fa-spinner fa-spin" /> Creating...</>
            : <><i className="fas fa-plus" /> Create &amp; Start Meeting</>}
        </button>

        <div className="divider">
          <div className="divider-line" />
          <div className="divider-text">already have a room?</div>
          <div className="divider-line" />
        </div>
        <button className="btn-secondary" onClick={() => setScreen('join')}>
          Join an existing meeting
        </button>
      </div>
    </div>
  );
}
