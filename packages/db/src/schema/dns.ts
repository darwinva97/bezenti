import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { clients } from "./clients";

// Zona DNS = un dominio cuya autoridad la maneja el sistema.
// El sistema actúa como servidor DNS autoritativo para estas zonas.
export const dnsZones = sqliteTable("dns_zones", {
  id:        text("id").primaryKey(),
  clientId:  text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  zone:      text("zone").notNull().unique(),  // ej: "midominio.com"
  // Verificación de propiedad estilo Cloudflare: a cada zona se le asigna un
  // par del pool *.ns.bezenti.com; la zona se activa solo cuando la
  // delegación real (NS en el registrador) coincide con el par asignado.
  ns1:        text("ns1"),
  ns2:        text("ns2"),
  status:     text("status", { enum: ["pending", "active"] }).notNull().default("pending"),
  verifiedAt: integer("verified_at", { mode: "timestamp" }),
  createdAt:  integer("created_at", { mode: "timestamp" }).notNull(),
});

export const dnsRecords = sqliteTable("dns_records", {
  id:       text("id").primaryKey(),
  zoneId:   text("zone_id").notNull().references(() => dnsZones.id, { onDelete: "cascade" }),
  type:     text("type", {
    enum: ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "CAA", "SRV", "PTR"],
  }).notNull(),
  // "@" para el apex, o nombre del subdominio (ej: "www", "mail", "blog")
  name:     text("name").notNull(),
  value:    text("value").notNull(),
  ttl:      integer("ttl").notNull().default(3600),
  // Para MX y SRV
  priority: integer("priority"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type DnsZone      = typeof dnsZones.$inferSelect;
export type NewDnsZone   = typeof dnsZones.$inferInsert;
export type DnsRecord    = typeof dnsRecords.$inferSelect;
export type NewDnsRecord = typeof dnsRecords.$inferInsert;
