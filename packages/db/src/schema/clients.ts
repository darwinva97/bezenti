import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { nodes } from "./nodes";
import { plans } from "./plans";

export const clients = sqliteTable("clients", {
  id:               text("id").primaryKey(),
  userId:           text("user_id").notNull().unique().references(() => user.id, { onDelete: "cascade" }),
  nodeId:           text("node_id").notNull().references(() => nodes.id),
  planId:           text("plan_id").notNull().references(() => plans.id),
  linuxUser:        text("linux_user").notNull().unique(),
  sftpPasswordHash: text("sftp_password_hash").notNull(),
  status:           text("status", {
    enum: ["active", "suspended", "deleted"],
  }).notNull().default("active"),
  suspensionReason: text("suspension_reason"),
  createdAt:        integer("created_at", { mode: "timestamp" }).notNull(),
  suspendedAt:      integer("suspended_at", { mode: "timestamp" }),
  deletedAt:        integer("deleted_at", { mode: "timestamp" }),
});

// Cuotas de almacenamiento por cliente.
// mode "shared"      → un pool total repartido entre todos los servicios.
// mode "per_service" → cada servicio tiene su propio límite independiente.
export const storageQuotas = sqliteTable("storage_quotas", {
  id:           text("id").primaryKey(),
  clientId:     text("client_id").notNull().unique().references(() => clients.id, { onDelete: "cascade" }),
  mode:         text("mode", { enum: ["shared", "per_service"] }).notNull().default("shared"),
  // shared
  totalMb:      integer("total_mb"),
  // per_service
  filesMb:      integer("files_mb"),
  mysqlMb:      integer("mysql_mb"),
  postgresqlMb: integer("postgresql_mb"),
  emailMb:      integer("email_mb"),
});

export type Client        = typeof clients.$inferSelect;
export type NewClient     = typeof clients.$inferInsert;
export type StorageQuota  = typeof storageQuotas.$inferSelect;
