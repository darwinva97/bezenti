import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { clients } from "./clients";

// Un proyecto = una aplicación PHP bajo un dominio o subdominio.
// Cada proyecto tiene su propia versión PHP y document root aislado.
export const projects = sqliteTable("projects", {
  id:          text("id").primaryKey(),
  clientId:    text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name:        text("name").notNull(),
  // Dominio o subdominio completo, ej: "miapp.com" o "blog.miapp.com"
  domain:      text("domain").notNull().unique(),
  phpVersion:  text("php_version").notNull().default("8.3"),
  // Ruta relativa dentro del home del cliente, ej: "blog" → /var/www/cli_xxx/blog/public
  docPath:     text("doc_path").notNull(),
  // cloudflare_dns_id para poder borrar el registro via API al eliminar el proyecto
  cloudflareDnsId: text("cloudflare_dns_id"),
  sslStatus:   text("ssl_status", { enum: ["pending", "active", "error"] }).notNull().default("pending"),
  isPrimary:   integer("is_primary", { mode: "boolean" }).notNull().default(false),
  status:      text("status", { enum: ["active", "suspended", "deleted"] }).notNull().default("active"),
  createdAt:   integer("created_at", { mode: "timestamp" }).notNull(),
});

export type Project    = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
