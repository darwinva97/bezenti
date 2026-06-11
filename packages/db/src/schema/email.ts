import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { clients } from "./clients";

// Cuentas de correo gestionadas via Stalwart Mail Server (API externa).
// El sistema crea/elimina/modifica cuentas llamando a la API REST de Stalwart.
export const emailAccounts = sqliteTable("email_accounts", {
  id:          text("id").primaryKey(),
  clientId:    text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  // Dirección completa, ej: "hola@midominio.com"
  email:       text("email").notNull().unique(),
  // ID interno de Stalwart para operaciones de management
  stalwartId:  text("stalwart_id"),
  quotaMb:     integer("quota_mb").notNull().default(1024),
  usedMb:      integer("used_mb").notNull().default(0),
  status:      text("status", { enum: ["active", "suspended", "deleted"] }).notNull().default("active"),
  createdAt:   integer("created_at", { mode: "timestamp" }).notNull(),
});

export type EmailAccount    = typeof emailAccounts.$inferSelect;
export type NewEmailAccount = typeof emailAccounts.$inferInsert;
