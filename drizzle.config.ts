import { appConfig } from "./app.config";
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: ["./database/schema.ts", appConfig.businessSchema],
  out: "./database/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
