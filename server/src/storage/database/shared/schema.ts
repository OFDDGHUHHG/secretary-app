import { pgTable, serial, timestamp, text, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const memos = pgTable(
  "memos",
  {
    id: serial().notNull().primaryKey(),
    content: text("content").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    reminder_time: timestamp("reminder_time", { withTimezone: true }),
    file_path: text("file_path"),
  },
  (table) => [
    index("memos_created_at_idx").on(table.created_at),
    index("memos_reminder_idx").on(table.reminder_time),
  ]
);

export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});
