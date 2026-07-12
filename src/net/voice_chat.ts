// Proximity voice chat: the client half. Audio is a direct P2P WebRTC mesh
// between nearby players (never routed through the server); the server only
// tells us WHO to mesh with (see server/voice_signaling.ts) and relays the
// signaling frames. Mic capture is strictly opt-in (privacy): getUserMedia is
// never requested until setEnabled(true) is called, which only happens from an
// explicit Settings toggle (src/game/settings.ts `voiceChatEnabled`).
//
// Glare avoidance: when the server's peer list adds a pid, the LOWER pid sends
// the offer (both sides compute this the same way from data they both already
// have, no extra negotiation round trip needed).
//
// STUN-only (a public server, no TURN relay): players behind strict/symmetric
// NAT simply won't complete a link to some peers. That is an accepted, graceful
// degradation for this feature, not a bug (see the design conversation this
// module implements).
//
// DOM/Three-free of the game UI: this module only touches WebRTC + Web Audio
// browser APIs, never the DOM. Its only outside dependency is the `sendSignal`
// callback ClientWorld wires to the WebSocket (src/net/online.ts), keeping this
// testable in isolation (the pure peer-list diff below has no browser API at all).

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export interface VoicePeerInfo {
  pid: number;
  name: string;
  speaking: boolean;
}

export type VoiceSignalKind = 'voiceoffer' | 'voiceanswer' | 'voiceice';

/** Pure: given the previous and next server-authoritative peer id sets, which
 *  pids to tear a connection down for and which to open one for. Exported
 *  separately from VoiceChatClient so it's testable without any WebRTC/DOM API. */
export function diffVoicePeers(
  prevIds: ReadonlySet<number>,
  next: readonly { pid: number }[],
): { added: number[]; removed: number[] } {
  const nextIds = new Set(next.map((p) => p.pid));
  const added: number[] = [];
  const removed: number[] = [];
  for (const id of nextIds) if (!prevIds.has(id)) added.push(id);
  for (const id of prevIds) if (!nextIds.has(id)) removed.push(id);
  return { added, removed };
}

interface Peer {
  pc: RTCPeerConnection;
  name: string;
  audioEl: HTMLAudioElement | null;
  analyser: AnalyserNode | null;
  speaking: boolean;
}

// Above this normalized RMS level (0..1) a peer is considered "speaking" for
// the UI indicator. Picked empirically: comfortably above room-tone noise
// floor on a typical mic without a noise gate, well under a normal speaking
// level.
const SPEAKING_THRESHOLD = 0.05;

export class VoiceChatClient {
  private enabled = false;
  private localStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private readonly peers = new Map<number, Peer>();
  private permissionDenied = false;

  constructor(
    // A getter, not a static id: this client is constructed before the
    // server's `hello` frame assigns the local player's pid.
    private readonly getSelfPid: () => number,
    private readonly sendSignal: (kind: VoiceSignalKind, toPid: number, payload: unknown) => void,
    private readonly sendOptIn: (on: boolean) => void,
  ) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  /** True once a getUserMedia request has been rejected; setEnabled(true)
   *  after this just re-attempts (the caller may re-prompt via browser UI). */
  didDenyPermission(): boolean {
    return this.permissionDenied;
  }

  async setEnabled(on: boolean): Promise<void> {
    if (on === this.enabled) return;
    if (on) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.permissionDenied = false;
      } catch {
        this.permissionDenied = true;
        return; // stay disabled; caller's settings toggle should revert its UI
      }
      this.enabled = true;
      this.sendOptIn(true);
    } else {
      this.enabled = false;
      this.sendOptIn(false);
      this.teardownAll();
      for (const track of this.localStream?.getTracks() ?? []) track.stop();
      this.localStream = null;
    }
  }

  /** Called with the server's authoritative nearest-peers list (msg.t === 'voicepeers'). */
  onPeerList(list: readonly { pid: number; name: string }[]): void {
    if (!this.enabled) return;
    const { added, removed } = diffVoicePeers(new Set(this.peers.keys()), list);
    for (const pid of removed) this.teardown(pid);
    const byId = new Map(list.map((p) => [p.pid, p.name]));
    for (const pid of added) this.connect(pid, byId.get(pid) ?? '');
  }

  async onOffer(fromPid: number, name: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.enabled) return;
    const peer = this.peers.get(fromPid) ?? this.createPeer(fromPid, name);
    await peer.pc.setRemoteDescription(sdp);
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    this.sendSignal('voiceanswer', fromPid, answer);
  }

  async onAnswer(fromPid: number, sdp: RTCSessionDescriptionInit): Promise<void> {
    const peer = this.peers.get(fromPid);
    if (!peer) return;
    await peer.pc.setRemoteDescription(sdp);
  }

  async onIce(fromPid: number, candidate: RTCIceCandidateInit): Promise<void> {
    const peer = this.peers.get(fromPid);
    if (!peer) return;
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch {
      /* a candidate can legitimately arrive after the connection closed */
    }
  }

  /** Current peers for the UI indicator; polled per frame like the rest of net/. */
  getPeers(): VoicePeerInfo[] {
    return Array.from(this.peers.entries()).map(([pid, p]) => ({
      pid,
      name: p.name,
      speaking: p.speaking,
    }));
  }

  updateSpeakingLevels(): void {
    for (const peer of this.peers.values()) {
      if (!peer.analyser) continue;
      const buf = new Uint8Array(peer.analyser.fftSize);
      peer.analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (const v of buf) {
        const centered = (v - 128) / 128;
        sumSq += centered * centered;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      peer.speaking = rms > SPEAKING_THRESHOLD;
    }
  }

  dispose(): void {
    this.enabled = false;
    this.teardownAll();
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.localStream = null;
    void this.audioCtx?.close();
    this.audioCtx = null;
  }

  private connect(pid: number, name: string): void {
    const peer = this.createPeer(pid, name);
    // Lower pid initiates the offer so both sides agree who does without a
    // negotiation round trip (both already know the full peer list).
    if (this.getSelfPid() < pid) void this.makeOffer(pid, peer);
  }

  private createPeer(pid: number, name: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer: Peer = { pc, name, audioEl: null, analyser: null, speaking: false };
    this.peers.set(pid, peer);
    for (const track of this.localStream?.getTracks() ?? []) {
      pc.addTrack(track, this.localStream!);
    }
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.sendSignal('voiceice', pid, ev.candidate.toJSON());
    };
    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (!stream) return;
      const audioEl = new Audio();
      audioEl.srcObject = stream;
      audioEl.autoplay = true;
      peer.audioEl = audioEl;
      this.audioCtx ??= new AudioContext();
      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      peer.analyser = analyser;
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.teardown(pid);
    };
    return peer;
  }

  private async makeOffer(pid: number, peer: Peer): Promise<void> {
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    this.sendSignal('voiceoffer', pid, offer);
  }

  private teardown(pid: number): void {
    const peer = this.peers.get(pid);
    if (!peer) return;
    peer.pc.close();
    if (peer.audioEl) peer.audioEl.srcObject = null;
    this.peers.delete(pid);
  }

  private teardownAll(): void {
    for (const pid of Array.from(this.peers.keys())) this.teardown(pid);
  }
}
