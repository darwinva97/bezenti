import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Cada VPS registrado en el sistema
export const nodes = sqliteTable("nodes", {
  id:               text("id").primaryKey(),
  name:             text("name").notNull(),           // nombre amigable, ej: "hetzner-nbg-01"
  provider:         text("provider").notNull(),        // hetzner | digitalocean | vultr | other
  region:           text("region"),                    // ej: "eu-central" "nyc3"
  ipPublic:         text("ip_public").notNull(),
  // URL base del node agent, ej: https://agent.bezenti.internal/nbg01
  // En producción el agent solo es accesible via Cloudflare Tunnel
  agentUrl:         text("agent_url").notNull(),
  // SHA-256 del token secreto — usado para validar heartbeats del agent
  agentTokenHash:   text("agent_token_hash").notNull(),
  // Token en claro — el control plane lo envía como X-Agent-Token al llamar
  // a la API del agent (crear clientes, dominios, etc.)
  agentToken:       text("agent_token"),
  status:           text("status", {
    enum: ["provisioning", "ready", "degraded", "offline"],
  }).notNull().default("provisioning"),
  diskGbTotal:      integer("disk_gb_total"),
  ramMbTotal:       integer("ram_mb_total"),
  createdAt:        integer("created_at", { mode: "timestamp" }).notNull(),
  // Último heartbeat recibido del agent
  lastHeartbeatAt:  integer("last_heartbeat_at", { mode: "timestamp" }),
});

export type Node    = typeof nodes.$inferSelect;
export type NewNode = typeof nodes.$inferInsert;
