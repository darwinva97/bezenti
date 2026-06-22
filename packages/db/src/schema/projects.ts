import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { clients } from "./clients";

// Un proyecto = una aplicación PHP bajo un dominio o subdominio.
// Cada proyecto tiene su propia versión PHP y document root aislado.
export const projects = sqliteTable("projects", {
  id:          text("id").primaryKey(),
  clientId:    text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name:        text("name").notNull(),
  // Dominio o subdominio completo, ej: "miapp.com" o "blog.miapp.com".
  // Para subdominios Bezenti guarda el host computado <subdomain>--<accountSlug>.<PAGES_DOMAIN>.
  domain:      text("domain").notNull().unique(),
  // Etiqueta editable <proyecto> del subdominio Bezenti (null si el proyecto usa dominio propio)
  subdomain:   text("subdomain"),
  phpVersion:  text("php_version").notNull().default("8.3"),
  // App instalada por el instalador 1-clic (null = docroot PHP en blanco).
  // ej: "wordpress". Extensible a "laravel", "joomla", etc.
  appType:     text("app_type"),
  // Ruta relativa dentro del home del cliente, ej: "blog" → /var/www/cli_xxx/blog/public
  docPath:     text("doc_path").notNull(),
  // Límite de subida en MB (upload_max_filesize). Legacy: ahora se usa phpSettings.
  uploadMaxMb: integer("upload_max_mb"),
  // Ajustes PHP del proyecto (JSON), configurables por el cliente desde el panel:
  // { uploadMaxMb, maxExecutionTime, memoryLimitMb, maxInputVars, maxInputTime }.
  // null = defaults del nodo. memoryLimitMb se topa al límite del plan en la API.
  phpSettings: text("php_settings"),
  // cloudflare_dns_id para poder borrar el registro via API al eliminar el proyecto
  cloudflareDnsId: text("cloudflare_dns_id"),
  sslStatus:   text("ssl_status", { enum: ["pending", "active", "error"] }).notNull().default("pending"),
  isPrimary:   integer("is_primary", { mode: "boolean" }).notNull().default(false),
  status:      text("status", { enum: ["active", "suspended", "deleted"] }).notNull().default("active"),
  createdAt:   integer("created_at", { mode: "timestamp" }).notNull(),
});

export type Project    = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
