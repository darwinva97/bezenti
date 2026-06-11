import { connect as cfConnect } from "cloudflare:sockets";
import { Client } from "ssh2";
import { Duplex } from "node:stream";

export type SshOpts = {
  host: string;
  port: number;
  username: string;
  password: string;
};

/**
 * Executes a shell command on a remote host via SSH.
 * Uses Cloudflare's TCP socket API as transport, then ssh2 for the protocol layer.
 * The command is launched with `nohup ... &` so it survives the SSH session closing.
 */
export async function sshRun(opts: SshOpts, command: string, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("SSH timeout — la conexión tardó demasiado")),
      timeoutMs,
    );

    const cfSocket = cfConnect({ hostname: opts.host, port: opts.port });

    // Convert the CF Web Streams socket into a Node.js Duplex stream
    // that ssh2 can use as its underlying transport.
    const writer = cfSocket.writable.getWriter();
    const reader = cfSocket.readable.getReader();

    const duplex = new Duplex({
      read() {}, // proactive push — _read is intentionally a no-op
      write(chunk: Uint8Array, _enc: string, cb: (err?: Error | null) => void) {
        writer
          .write(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk))
          .then(() => cb())
          .catch(cb);
      },
      final(cb: (err?: Error | null) => void) {
        writer.close().then(() => cb()).catch(cb);
      },
    });

    // Continuously push data arriving from the CF socket into the Duplex.
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) { duplex.push(null); break; }
          duplex.push(value);
        }
      } catch (err) {
        duplex.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    const conn = new Client();

    conn.on("ready", () => {
      // Fire-and-forget: the heavy work happens in the background on the VPS.
      conn.exec(command, { pty: false }, (err, stream) => {
        if (err) { clearTimeout(timer); reject(err); conn.end(); return; }

        stream.on("close", () => {
          clearTimeout(timer);
          conn.end();
          resolve();
        });

        // Drain stdout/stderr so the stream doesn't stall.
        stream.resume();
        stream.stderr?.resume();
      });
    });

    conn.on("error", (err) => { clearTimeout(timer); reject(err); });

    conn.connect({
      sock:         duplex,
      username:     opts.username,
      password:     opts.password,
      readyTimeout: 12_000,
      // Avoid strict host-key checking — fine for initial VPS setup.
      hostVerifier: () => true,
    });
  });
}
