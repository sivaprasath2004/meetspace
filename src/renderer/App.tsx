import React, { createContext, useContext, useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import CreateMeeting from './pages/CreateMeeting';
import JoinMeeting from './pages/JoinMeeting';
import Meeting from './pages/Meeting';
import './styles/global.css';

export interface UserInfo { userId: string; name: string; email: string; organisation: string; publicUrl: string; }
export interface RoomInfo  { roomId: string; title: string; isHost: boolean; }

export interface AppState {
  screen: 'create' | 'join' | 'meeting';
  user: UserInfo | null;
  room: RoomInfo | null;
  initialParticipants: any[];
}

interface AppContextValue extends AppState {
  setScreen: (s: AppState['screen']) => void;
  enterMeeting: (user: UserInfo, room: RoomInfo, participants?: any[]) => void;
  leaveMeeting: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

const SESSION_USER_ID = (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : 'user-' + Math.random().toString(36).slice(2);

export default function App() {
  const [state, setState] = useState<AppState>({ screen: 'create', user: null, room: null, initialParticipants: [] });

  const setScreen       = useCallback((screen: AppState['screen']) => setState(s => ({...s, screen})), []);
  const enterMeeting    = useCallback((user: UserInfo, room: RoomInfo, participants: any[] = []) =>
    setState({ screen: 'meeting', user, room, initialParticipants: participants }), []);
  const leaveMeeting    = useCallback(() =>
    setState(s => ({...s, screen: 'create', room: null, initialParticipants: [] })), []);

  const ctx: AppContextValue = { ...state, setScreen, enterMeeting, leaveMeeting };

  // Meeting fills entire window — no nav bar, no centred wrapper
  if (state.screen === 'meeting') {
    return (
      <AppContext.Provider value={ctx}>
        <div style={{ position:'fixed', inset:0, width:'100vw', height:'100vh', overflow:'hidden', background:'#0d0d14' }}>
          <Meeting user={state.user!} room={state.room!} initialParticipants={state.initialParticipants} />
        </div>
      </AppContext.Provider>
    );
  }

  return (
    <AppContext.Provider value={ctx}>
      <div className="app-root">
        {/* Navigation Tabs */}
        <nav className="top-nav">
          <div className="nav-inner">
            <button className={`nav-btn${state.screen==='create'?' active':''}`} onClick={()=>setScreen('create')}>
              Create Meeting
            </button>
            <button className={`nav-btn${state.screen==='join'?' active':''}`} onClick={()=>setScreen('join')}>
              Join Meeting
            </button>
          </div>
        </nav>
        {state.screen === 'create' && <CreateMeeting sessionUserId={SESSION_USER_ID} />}
        {state.screen === 'join'   && <JoinMeeting   sessionUserId={SESSION_USER_ID} />}
      </div>
    </AppContext.Provider>
  );
}
