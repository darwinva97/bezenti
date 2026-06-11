import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id:           text("id").primaryKey(),           // nanoid
  email:        text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // admin → accede al panel admin
  // client → accede al portal del cliente
  role:         text("role", { enum: ["admin", "client"] }).notNull().default("client"),
  createdAt:    integer("created_at", { mode: "timestamp" }).notNull(),
  lastLoginAt:  integer("last_login_at", { mode: "timestamp" }),
});

export type User     = typeof users.$inferSelect;
export type NewUser  = typeof users.$inferInsert;
