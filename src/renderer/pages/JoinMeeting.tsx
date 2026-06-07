import React, { useState } from 'react';
import { useApp } from '../App';
import { MeetingService } from '../services/MeetingService';
import { TunnelService } from '../services/TunnelService';

interface Props {
  sessionUserId: string;
}

const tunnelService = new TunnelService();

export default function JoinMeeting({ sessionUserId }: Props) {
  const { setScreen, enterMeeting } = useApp();

  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleJoin() {
    if (!roomId.trim()) { setError('Please enter the Room ID.'); return; }
    if (!name.trim()) { setError('Please enter your name.'); return; }
    setLoading(true);
    setError('');
    try {
      let publicUrl = 'ws://localhost:4001';
      try {
        const info = await (window as any).electronAPI?.getLocalServerInfo();
        const tunnel = await tunnelService.createTunnel(info?.wsPort || 4001, info?.httpPort || 4000);
        publicUrl = tunnel.publicUrl;
      } catch { /* browser fallback */ }

      const data = await MeetingService.joinRoom({
        roomId: roomId.trim().toUpperCase(),
        userId: sessionUserId,
        name: name.trim(),
        email: email.trim(),
        organisation: organisation.trim(),
        publicUrl,
      });

      try {
        await (window as any).electronAPI?.connectMainServerWs({
          userId: sessionUserId,
          roomId: data.roomId,
          serverUrl: MeetingService.serverUrl,
        });
      } catch { /* browser fallback */ }

      enterMeeting(
        { userId: sessionUserId, name: name.trim(), email, organisation, publicUrl },
        { roomId: data.roomId, title: data.room.title, isHost: false },
        data.participants,
      );
    } catch (e: any) {
      setError(e.message || 'Failed to join. Check the Room ID and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon"><i className="fas fa-video" /></div>
          <div className="auth-logo-text">MeetSpace</div>
        </div>
        <div className="auth-title">Join a meeting</div>
        <div className="auth-sub">Enter the room code shared by the host</div>

        <div className="field-wrap">
          <label className="field-label">Room ID</label>
          <input
            className="field-input room-id-input"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            placeholder="e.g. ROOM-A1B2C"
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          />
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

        <button className="btn-primary" onClick={handleJoin} disabled={loading}>
          {loading
            ? <><i className="fas fa-spinner fa-spin" /> Joining...</>
            : <><i className="fas fa-sign-in-alt" /> Join Meeting</>}
        </button>

        <div className="divider">
          <div className="divider-line" />
          <div className="divider-text">or</div>
          <div className="divider-line" />
        </div>
        <button className="btn-secondary" onClick={() => setScreen('create')}>
          Create a new meeting instead
        </button>
      </div>
    </div>
  );
}
