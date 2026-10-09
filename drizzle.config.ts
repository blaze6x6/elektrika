import { defineConfig } from "drizzle-kit";

// Samo za razvoj (drizzle-kit studio / introspekcija). Poverilnice iz okolja, ne iz kode.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
