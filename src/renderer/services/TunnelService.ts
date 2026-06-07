/**
 * MeetSpace Tunnel Service
 * Creates a public endpoint for each Electron client so peers can
 * connect directly via WebSocket for signaling.
 *
 * In production: use your own reverse proxy / ngrok-compatible server.
 * In development: falls back to localhost with the local WS port.
 *
 * The publicUrl format: ws://hostname:PORT
 * This URL is registered with Main Server and shared with peers.
 */

export interface TunnelInfo {
  publicUrl: string;   // WebSocket URL peers will connect to
  httpUrl: string;     // HTTP URL for health checks
}

export class TunnelService {
  private tunnelInfo: TunnelInfo | null = null;

  /**
   * Create public endpoint.
   * In production, replace this with a real tunnel/reverse-proxy setup.
   * For a self-hosted setup, each machine has a static IP/hostname.
   */
  async createTunnel(wsPort: number, httpPort: number): Promise<TunnelInfo> {
    // In a real deployment, clients have a known public address.
    // Here we construct from hostname or fallback to localhost for LAN.
    const hostname = await this.getLocalIp();
    this.tunnelInfo = {
      publicUrl: `ws://${hostname}:${wsPort}`,
      httpUrl: `http://${hostname}:${httpPort}`,
    };
    console.log(`[Tunnel] Public URL: ${this.tunnelInfo.publicUrl}`);
    return this.tunnelInfo;
  }

  private async getLocalIp(): Promise<string> {
    // Try to get LAN IP via WebRTC ICE candidate trick
    return new Promise((resolve) => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      pc.createOffer().then((offer) => pc.setLocalDescription(offer));

      const timeout = setTimeout(() => {
        pc.close();
        resolve('localhost');
      }, 2000);

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const match = event.candidate.candidate.match(
          /(\d+\.\d+\.\d+\.\d+)/
        );
        if (match && match[1] !== '0.0.0.0' && !match[1].startsWith('127.')) {
          clearTimeout(timeout);
          pc.close();
          resolve(match[1]);
        }
      };
    });
  }

  getTunnelInfo(): TunnelInfo | null {
    return this.tunnelInfo;
  }

  async destroy() {
    this.tunnelInfo = null;
  }
}
