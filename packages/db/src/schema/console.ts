import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { nodes } from "./nodes";

// Historial de comandos ejecutados desde la consola web del admin por nodo.
export const nodeCommands = sqliteTable("node_commands", {
  id:        text("id").primaryKey(),
  nodeId:    text("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
  command:   text("command").notNull(),
  exitCode:  integer("exit_code"),
  output:    text("output"),          // salida (truncada para almacenamiento)
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type NodeCommand = typeof nodeCommands.$inferSelect;
