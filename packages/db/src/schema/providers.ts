import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Cuentas de proveedor cloud para aprovisionar VPS por API.
// kind "hetzner" → Hetzner Cloud API (adaptador nativo).
// kind "custom"  → adaptador HTTP genérico configurable (config JSON).
export const providers = sqliteTable("providers", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull(),                 // ej: "Hetzner principal"
  kind:      text("kind", { enum: ["hetzner", "custom"] }).notNull(),
  // Token/API key del proveedor. Secreto — nunca se devuelve en las listas.
  apiToken:  text("api_token").notNull(),
  // Config del adaptador custom (JSON con create/delete: url, method, headers,
  // body template, ipPath, idPath). null para hetzner.
  config:    text("config"),
  isActive:  integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type Provider    = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;
