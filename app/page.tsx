/**
 * app/page.tsx
 *
 * Landing page for the Bloom Slack Bot.
 * Shows an "Add to Slack" button that starts the OAuth flow.
 */

import Link from "next/link";

const BG = "#0a0a0a";
const TEXT = "#f5f0e8";
const ACCENT = "#ff4500";

/**
 * Marketing landing page with OAuth install entrypoint.
 */
export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
        background: BG,
        color: TEXT,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        textAlign: "center",
      }}
    >
      <h1
        style={{
          fontSize: "clamp(1.75rem, 4vw, 2.25rem)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: "0 0 12px",
        }}
      >
        🌸 Bloom for Slack
      </h1>
      <p
        style={{
          maxWidth: "420px",
          margin: "0 0 28px",
          fontSize: "1.05rem",
          lineHeight: 1.55,
          opacity: 0.92,
        }}
      >
        Generate on-brand images in Slack with{" "}
        <code
          style={{
            fontSize: "0.95em",
            padding: "2px 8px",
            borderRadius: "6px",
            background: "rgba(245, 240, 232, 0.08)",
            border: "1px solid rgba(245, 240, 232, 0.12)",
          }}
        >
          /bloom-gen
        </code>
      </p>
      <Link
        href="/api/slack/install"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "14px 28px",
          borderRadius: "10px",
          background: ACCENT,
          color: "#fff",
          fontWeight: 600,
          fontSize: "1rem",
          border: "none",
          cursor: "pointer",
          textDecoration: "none",
          boxShadow: "0 4px 20px rgba(255, 69, 0, 0.25)",
        }}
      >
        Add to Slack
      </Link>
    </main>
  );
}
