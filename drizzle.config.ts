import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env files on its own; Next.js does, so mirror it here.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // file is optional (on Vercel the env comes from the platform)
  }
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
