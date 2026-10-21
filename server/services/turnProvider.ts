import crypto from "node:crypto";
import config from "../config.ts";

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface TurnCredentialsResult {
  iceServers: IceServerConfig[];
  ttlSeconds: number;
  expiresAt: string;
  relayStatus: "healthy" | "stun_only";
}

export interface TurnProvider {
  readonly name: string;
  generateCredentials(params: {
    userId: string;
    roomId: string;
    ttlSeconds: number;
  }): Promise<TurnCredentialsResult>;
}

export interface CoturnHmacProviderOptions {
  sharedSecret?: string;
  turnHost?: string;
  portUdp?: number;
  portTls?: number;
  fallbackStunUrls?: string[];
}

export class CoturnHmacProvider implements TurnProvider {
  readonly name = "coturn";
  private sharedSecret: string;
  private turnHost: string;
  private portUdp: number;
  private portTls: number;
  private fallbackStunUrls: string[];

  constructor(options?: CoturnHmacProviderOptions) {
    this.sharedSecret = options?.sharedSecret ?? config.TURN_SHARED_SECRET ?? "";
    this.turnHost = options?.turnHost ?? config.TURN_HOST ?? "";
    this.portUdp = options?.portUdp ?? Number(config.TURN_PORT_UDP || 3478);
    this.portTls = options?.portTls ?? Number(config.TURN_PORT_TLS || 443);
    const configuredStun = config.TURN_FALLBACK_STUN_URLS;
    if (options?.fallbackStunUrls) {
      this.fallbackStunUrls = options.fallbackStunUrls;
    } else if (configuredStun && typeof configuredStun === "string") {
      this.fallbackStunUrls = configuredStun.split(",").map((u: string) => u.trim()).filter(Boolean);
    } else {
      this.fallbackStunUrls = ["stun:stun.l.google.com:19302"];
    }
  }

  async generateCredentials(params: {
    userId: string;
    roomId: string;
    ttlSeconds: number;
  }): Promise<TurnCredentialsResult> {
    const ttlSeconds = Math.max(60, Math.floor(params.ttlSeconds));
    const nowUnix = Math.floor(Date.now() / 1000);
    const expiryTimestamp = nowUnix + ttlSeconds;
    const expiresAt = new Date(expiryTimestamp * 1000).toISOString();

    // If host or secret is not provisioned (e.g. dev/test fallback), return STUN-only
    if (!this.sharedSecret || !this.turnHost) {
      const iceServers: IceServerConfig[] = [
        { urls: this.fallbackStunUrls },
      ];
      return {
        iceServers,
        ttlSeconds,
        expiresAt,
        relayStatus: "stun_only",
      };
    }

    const username = `${expiryTimestamp}:${params.userId}`;
    const hmac = crypto.createHmac("sha1", this.sharedSecret);
    hmac.update(username);
    const credential = hmac.digest("base64");

    const iceServers: IceServerConfig[] = [
      {
        urls: [
          `stun:${this.turnHost}:${this.portUdp}`,
          ...this.fallbackStunUrls,
        ],
      },
      {
        urls: [
          `turns:${this.turnHost}:${this.portTls}?transport=tcp`,
          `turn:${this.turnHost}:${this.portUdp}?transport=udp`,
        ],
        username,
        credential,
      },
    ];

    return {
      iceServers,
      ttlSeconds,
      expiresAt,
      relayStatus: "healthy",
    };
  }
}
