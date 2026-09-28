import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <EmptyState title="Page not found" action={<Button asChild><Link href="/">Go to dashboard</Link></Button>}>
        The link may be old, or the item was removed.
      </EmptyState>
    </main>
  );
}
