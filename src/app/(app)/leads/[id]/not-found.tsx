import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";

export default function NotFound() {
  return <EmptyState title="Lead not found" action={<Button asChild><Link href="/leads">Back to leads</Link></Button>}>It may have been deleted, or it belongs to another organisation.</EmptyState>;
}
