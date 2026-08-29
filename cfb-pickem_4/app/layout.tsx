import "./globals.css";
import type { ReactNode } from "react";
import { activePeriod } from "@/lib/db";
import { APP_TIMEZONE, isSaturdayIn } from "@/lib/time";

export const metadata = {
  title: "CFB Pickem",
  description: "Weekly college football draft pool",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Fail soft: if the database isn't configured yet the nav still renders,
  // so you get a readable page instead of a stack trace.
  let label = "";
  try {
    const a = await activePeriod();
    label = a ? `${a.season.label} · ${a.period.label}` : "";
  } catch {
    label = "database not connected";
  }

  return (
    <html lang="en">
      <body>
        <div className="wrap">
          <nav>
            <span className="brand">CFB Pickem</span>
            {isSaturdayIn(APP_TIMEZONE) && (
              <a href="/weekend-preview">Weekend Preview</a>
            )}
            <a href="/">Picks</a>
            <a href="/scoreboard">Scoreboard</a>
            <a href="/results">Results</a>
            <a href="/history">History</a>
            <span className="spacer" />
            <span className="period">{label}</span>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
