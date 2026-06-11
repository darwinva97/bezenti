import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { clients } from "./clients";
import { projects } from "./projects";

export const clientDatabases = sqliteTable("client_databases", {
  id:             text("id").primaryKey(),
  clientId:       text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  // null = BD no ligada a un proyecto específico (accesible desde todos)
  projectId:      text("project_id").references(() => projects.id, { onDelete: "set null" }),
  engine:         text("engine", { enum: ["mysql", "postgresql"] }).notNull().default("mysql"),
  dbName:         text("db_name").notNull().unique(),
  dbUser:         text("db_user").notNull().unique(),
  dbPasswordHash: text("db_password_hash").notNull(),
  createdAt:      integer("created_at", { mode: "timestamp" }).notNull(),
});

export type ClientDatabase    = typeof clientDatabases.$inferSelect;
export type NewClientDatabase = typeof clientDatabases.$inferInsert;
