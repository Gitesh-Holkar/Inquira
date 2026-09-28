import { Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid gap-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div>
    </div>
  );
}
