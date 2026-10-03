import {
  pgTable,
  serial,
  varchar,
  date,
  doublePrecision,
  timestamp,
  boolean,
  integer,
  text,
  unique,
} from "drizzle-orm/pg-core";

// Column configuration - defines which columns appear in the table
export const columnConfigs = pgTable("column_configs", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  label: varchar("label", { length: 255 }).notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  sourceType: varchar("source_type", { length: 50 }).notNull().default("manual"),
  // "manual" | "solaredge" | "melcloud" | "formula"
  formula: text("formula"), // e.g. "{toplotna_ogrevanje} + {toplotna_sanitarna}"
  unit: varchar("unit", { length: 50 }).default("kWh"),
  editable: boolean("editable").default(true),
  visible: boolean("visible").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Daily values - one row per date per column
export const dailyValues = pgTable(
  "daily_values",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    columnKey: varchar("column_key", { length: 100 }).notNull(),
    value: doublePrecision("value").default(0),
    isManual: boolean("is_manual").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [unique("date_column_unique").on(t.date, t.columnKey)]
);

// Users
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  isAdmin: boolean("is_admin").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// App settings (key-value)
export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value").default(""),
});

// Audit log
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 255 }).notNull(),
  action: varchar("action", { length: 50 }).notNull(),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
