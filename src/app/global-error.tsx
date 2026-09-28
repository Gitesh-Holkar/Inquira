"use client";

/** Last-resort boundary (root layout failed). Plain HTML: the design system may be what broke. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en-IN">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 16 }}>
          <h1 style={{ fontSize: 20 }}>Inquira couldn&apos;t load</h1>
          <p style={{ color: "#5b665e" }}>Something went wrong on our side. Your data is safe.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "10px 16px", borderRadius: 8, border: 0, background: "#2f7a24", color: "#fff" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
