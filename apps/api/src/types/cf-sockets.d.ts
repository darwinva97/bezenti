// Type declarations for the Cloudflare-specific cloudflare:sockets module.
// https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
declare module "cloudflare:sockets" {
  export interface Socket {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    close(): Promise<void>;
    closed: Promise<void>;
  }
  export interface ConnectOptions {
    hostname: string;
    port: number;
    secureTransport?: "off" | "on" | "starttls";
    allowHalfOpen?: boolean;
  }
  export function connect(address: ConnectOptions): Socket;
}
