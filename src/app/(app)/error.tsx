"use client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";
import { AlertTriangle } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState icon={<AlertTriangle />} title="This page couldn't load" action={<Button onClick={reset}>Try again</Button>}>
      Something went wrong on our side. Your data is safe. If it keeps happening, check Settings → Integrations or the server logs.
    </EmptyState>
  );
}
