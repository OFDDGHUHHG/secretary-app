import { pgTable, serial, timestamp, text, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const memos = pgTable(
  "memos",
  {
    id: serial().notNull().primaryKey(),
    content: text("content").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("memos_created_at_idx").on(table.created_at),
  ]
);

export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});
