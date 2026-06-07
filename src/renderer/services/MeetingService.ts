/**
 * MeetSpace Meeting Service
 * HTTP API calls to Main Server for room management
 */

export interface Participant {
  userId: string;
  name: string;
  email?: string;
  organisation?: string;
  publicUrl: string;
  isHost: boolean;
  joinedAt: number;
}

export interface Room {
  id: string;
  title: string;
  participants: Participant[];
}

const SERVER_URL = (window as any).__MEETSPACE_SERVER_URL__ || 'http://localhost:3001';

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const MeetingService = {
  serverUrl: SERVER_URL,

  async createRoom(opts: {
    title: string;
    userId: string;
    name: string;
    email?: string;
    organisation?: string;
    publicUrl: string;
  }): Promise<{ roomId: string; participant: Participant }> {
    return apiFetch('/rooms/create', { method: 'POST', body: JSON.stringify(opts) });
  },

  async joinRoom(opts: {
    roomId: string;
    userId: string;
    name: string;
    email?: string;
    organisation?: string;
    publicUrl: string;
  }): Promise<{ roomId: string; room: { id: string; title: string }; participants: Participant[] }> {
    return apiFetch('/rooms/join', { method: 'POST', body: JSON.stringify(opts) });
  },

  async getRoom(roomId: string): Promise<Room> {
    return apiFetch(`/rooms/${roomId}`);
  },

  async leaveRoom(roomId: string, userId: string): Promise<void> {
    await apiFetch('/rooms/leave', { method: 'POST', body: JSON.stringify({ roomId, userId }) });
  },

  async healthCheck(): Promise<boolean> {
    try {
      await apiFetch('/health');
      return true;
    } catch {
      return false;
    }
  },
};
