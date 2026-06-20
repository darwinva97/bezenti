import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const plans = sqliteTable("plans", {
  id:                 text("id").primaryKey(),
  name:               text("name").notNull(),          // Starter, Pro, Business
  pricePen:           real("price_pen").notNull(),      // precio en soles
  priceUsd:           real("price_usd"),                // precio en USD (fase 2)
  diskMb:             integer("disk_mb").notNull(),
  ramMbSoft:          integer("ram_mb_soft").notNull(), // límite soft de RAM (referencia)
  maxDomains:         integer("max_domains").notNull(),
  maxDatabases:       integer("max_databases").notNull(),
  maxEmailAccounts:   integer("max_email_accounts").notNull().default(5),
  // JSON array de versiones permitidas, ej: '["8.1","8.2","8.3"]'
  phpVersions:        text("php_versions").notNull().default('["8.3"]'),
  phpMemoryLimitMb:   integer("php_memory_limit_mb").notNull().default(128),
  phpMaxProcesses:    integer("php_max_processes").notNull().default(5),
  bandwidthGbMonth:   integer("bandwidth_gb_month"),   // null = ilimitado
  isActive:           integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt:          integer("created_at", { mode: "timestamp" }).notNull(),
});

export type Plan    = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
