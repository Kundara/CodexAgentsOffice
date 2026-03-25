import { createHash, randomUUID } from "node:crypto";
import dgram from "node:dgram";
import { networkInterfaces } from "node:os";

import type { FleetResponse, LanOptions, LanPeerDescriptor } from "./server-types";

const BEACON_TYPE = "codex-agents-office-lan-v1";
const ANNOUNCE_INTERVAL_MS = 3000;
const PEER_TTL_MS = 12000;
const FETCH_TIMEOUT_MS = 2500;

interface LanBeacon {
  type: string;
  peerId: string;
  label: string;
  port: number;
  addresses: string[];
  keyHash: string | null;
  seenAt: string;
}

interface PeerRecord extends LanPeerDescriptor {
  lastSeenMs: number;
}

function hashKey(key: string | null): string | null {
  return key ? createHash("sha256").update(key).digest("hex") : null;
}

function advertisedAddresses(host: string): string[] {
  if (host && host !== "0.0.0.0" && host !== "::") {
    return [host];
  }

  const values = Object.values(networkInterfaces())
    .flat()
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .filter((entry) => entry.family === "IPv4" && entry.internal === false)
    .map((entry) => entry.address);
  return Array.from(new Set(values));
}

async function fetchJson(url: string, key: string | null): Promise<FleetResponse | null> {
  try {
    const response = await fetch(url, {
      headers: key ? { "x-codex-agents-office-key": key } : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) {
      return null;
    }
    return await response.json() as FleetResponse;
  } catch {
    return null;
  }
}

export class LanPeerService {
  private readonly peerId = randomUUID();
  private readonly keyHash: string | null;
  private readonly peers = new Map<string, PeerRecord>();
  private socket: dgram.Socket | null = null;
  private announceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: LanOptions,
    private readonly host: string,
    private readonly port: number,
    private readonly label: string
  ) {
    this.keyHash = hashKey(this.options.key);
  }

  get enabled(): boolean {
    return this.options.enabled;
  }

  get discoveryPort(): number | null {
    return this.options.enabled ? this.options.discoveryPort : null;
  }

  get id(): string | null {
    return this.options.enabled ? this.peerId : null;
  }

  async start(): Promise<void> {
    if (!this.options.enabled) {
      return;
    }

    this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.socket.on("message", (message) => {
      this.onMessage(message);
    });

    await new Promise<void>((resolvePromise, reject) => {
      this.socket?.once("error", reject);
      this.socket?.bind(this.options.discoveryPort, () => {
        this.socket?.off("error", reject);
        this.socket?.setBroadcast(true);
        resolvePromise();
      });
    });

    this.announce();
    this.announceTimer = setInterval(() => {
      this.announce();
      this.prunePeers();
    }, ANNOUNCE_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
    if (this.socket) {
      await new Promise<void>((resolvePromise) => {
        this.socket?.close(() => resolvePromise());
      });
      this.socket = null;
    }
    this.peers.clear();
  }

  getPeers(): LanPeerDescriptor[] {
    this.prunePeers();
    return [...this.peers.values()]
      .sort((left, right) => right.lastSeenMs - left.lastSeenMs)
      .map(({ lastSeenMs: _lastSeenMs, ...peer }) => peer);
  }

  async fetchPeerFleets(): Promise<Array<{ peer: LanPeerDescriptor; fleet: FleetResponse }>> {
    const peers = this.getPeers();
    const results = await Promise.all(peers.map(async (peer) => {
      for (const address of peer.addresses) {
        const fleet = await fetchJson(`http://${address}:${peer.port}/api/lan/fleet`, this.options.key);
        if (fleet) {
          return { peer, fleet };
        }
      }
      return null;
    }));
    return results.filter((entry): entry is { peer: LanPeerDescriptor; fleet: FleetResponse } => Boolean(entry));
  }

  private announce(): void {
    if (!this.socket) {
      return;
    }

    const beacon: LanBeacon = {
      type: BEACON_TYPE,
      peerId: this.peerId,
      label: this.label,
      port: this.port,
      addresses: advertisedAddresses(this.host),
      keyHash: this.keyHash,
      seenAt: new Date().toISOString()
    };

    const payload = Buffer.from(JSON.stringify(beacon), "utf8");
    this.socket.send(payload, this.options.discoveryPort, "255.255.255.255");
  }

  private onMessage(message: Buffer): void {
    let beacon: LanBeacon | null = null;
    try {
      beacon = JSON.parse(message.toString("utf8")) as LanBeacon;
    } catch {
      return;
    }

    if (!beacon || beacon.type !== BEACON_TYPE || beacon.peerId === this.peerId) {
      return;
    }
    if ((beacon.keyHash ?? null) !== this.keyHash) {
      return;
    }
    if (!Array.isArray(beacon.addresses) || beacon.addresses.length === 0 || !Number.isFinite(beacon.port)) {
      return;
    }

    const seenAt = Date.parse(beacon.seenAt);
    this.peers.set(beacon.peerId, {
      id: beacon.peerId,
      label: typeof beacon.label === "string" && beacon.label.trim().length > 0 ? beacon.label.trim() : "Peer",
      addresses: beacon.addresses.filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
      port: beacon.port,
      seenAt: new Date(Number.isFinite(seenAt) ? seenAt : Date.now()).toISOString(),
      lastSeenMs: Number.isFinite(seenAt) ? seenAt : Date.now()
    });
  }

  private prunePeers(): void {
    const cutoff = Date.now() - PEER_TTL_MS;
    for (const [peerId, peer] of this.peers.entries()) {
      if (peer.lastSeenMs < cutoff) {
        this.peers.delete(peerId);
      }
    }
  }
}
