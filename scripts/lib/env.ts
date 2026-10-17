// Imported first by every script: loads .env.local and .env the way Next.js does, before any
// module reads process.env at load time (the logger reads LOG_LEVEL when it is first imported).
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // optional file
  }
}
