import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { nodes } from "./nodes";
import { clients } from "./clients";

export const nodeMetrics = sqliteTable("node_metrics", {
  id:           integer("id").primaryKey({ autoIncrement: true }),
  nodeId:       text("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
  recordedAt:   integer("recorded_at", { mode: "timestamp" }).notNull(),
  cpuPct:       real("cpu_pct"),
  ramUsedMb:    integer("ram_used_mb"),
  diskUsedGb:   real("disk_used_gb"),
  clientsCount: integer("clients_count").notNull().default(0),
});

export const clientMetrics = sqliteTable("client_metrics", {
  id:            integer("id").primaryKey({ autoIncrement: true }),
  clientId:      text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  recordedAt:    integer("recorded_at", { mode: "timestamp" }).notNull(),
  diskUsedMb:    integer("disk_used_mb").notNull().default(0),
  mysqlUsedMb:   integer("mysql_used_mb").notNull().default(0),
  pgUsedMb:      integer("pg_used_mb").notNull().default(0),
  emailUsedMb:   integer("email_used_mb").notNull().default(0),
  processCount:  integer("process_count").notNull().default(0),
  requestsToday: integer("requests_today").notNull().default(0),
});

export type NodeMetric   = typeof nodeMetrics.$inferSelect;
export type ClientMetric = typeof clientMetrics.$inferSelect;
