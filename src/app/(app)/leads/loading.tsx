import { Skeleton } from "@/components/ui/primitives";
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading leads" className="grid gap-3">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-10" />
      <Skeleton className="h-24" />
      {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}
    </div>
  );
}
