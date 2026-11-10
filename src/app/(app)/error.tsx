"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { Button } from "@/components/ui/button";

/** A page that failed to render (its data's failures are shown on the page itself) */
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-2">
        <h1 className="font-semibold text-xl tracking-tight">Something went wrong</h1>
        <p className="text-muted-foreground text-sm">
          {error.message || "An unexpected error occurred."}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          onClick={() =>
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
        >
          Try again
        </Button>
        <Button variant="outline" asChild>
          <Link href="/">Go to organizations</Link>
        </Button>
      </div>
    </div>
  );
}
