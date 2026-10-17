"use client";

// Last-resort boundary when the root layout itself fails. Keeps styling inline on purpose:
// globals.css may be what failed.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  console.error(`[global-error] ${error.name}: ${error.message}`, error.digest ?? "", error.stack ?? "");
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32, background: "#f5f4f1", color: "#1c1b19" }}>
        <p style={{ fontWeight: 600 }}>Error: the app failed to load.</p>
        <p style={{ fontFamily: "monospace", fontSize: 12 }}>code CLIENT_RENDER {error.digest ? `digest ${error.digest}` : ""}</p>
        <button type="button" onClick={reset} style={{ marginTop: 16, padding: "6px 12px", border: "1px solid #a9a59c", background: "#fbfaf8" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
