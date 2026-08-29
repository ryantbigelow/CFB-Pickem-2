"use client";

import { useEffect, useState } from "react";

const OPTS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/**
 * A kickoff time, formatted in the VIEWER's timezone -- not the server's.
 *
 * Server-rendered pages format dates in whatever timezone the server
 * process runs in (Vercel runs UTC), not the visitor's. `toLocaleString`
 * only picks up the browser's local timezone when it actually executes in
 * the browser, so this has to be a client component.
 *
 * It renders nothing until an effect fires after mount, rather than
 * formatting the date on the first render. That first render happens
 * during SSR too (client components are still rendered server-side for
 * the initial HTML), so formatting eagerly would print the server's
 * timezone into that HTML and then fight with React over a hydration
 * mismatch once the browser recomputes a different string. Waiting for
 * the effect means the initial paint (server and client) agrees on
 * "nothing," and the real, correct time appears a beat later with no
 * mismatch warning.
 */
export default function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    setText(new Date(iso).toLocaleString(undefined, OPTS));
  }, [iso]);

  return <>{text}</>;
}
