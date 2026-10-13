import Link from "next/link";
import { StatusPage } from "@/components/StatusPage";
import { Button } from "@/components/ui/button";

/** A page that isn't there: an old link, say, after the data was loaded again */
export function NotFound() {
  return (
    <StatusPage
      title="Page not found"
      description="This link may be out of date, or the page has moved."
      actions={
        <Button asChild>
          <Link href="/">Go to organizations</Link>
        </Button>
      }
    />
  );
}
