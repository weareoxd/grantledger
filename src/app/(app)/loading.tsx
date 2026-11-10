import { Skeleton } from "@/components/ui/skeleton";

/** While a page's server part loads: its heading's place */
export default function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-40" />
    </div>
  );
}
