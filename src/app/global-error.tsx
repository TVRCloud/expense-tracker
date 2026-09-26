"use client";

import NextError from "next/error";
import { useEffect } from "react";

// Root error boundary. Error reporting was removed along with Sentry; errors
// are logged to the browser console until an alternative is added.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
