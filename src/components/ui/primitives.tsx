import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-10 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-base text-foreground placeholder:text-muted sm:text-sm",
      "aria-[invalid=true]:border-danger disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn("w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-base text-foreground placeholder:text-muted sm:text-sm aria-[invalid=true]:border-danger", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn("h-10 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-base text-foreground sm:text-sm", className)}
    {...props}
  />
));
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}

export function Field({ label, htmlFor, error, hint, children, className }: { label: string; htmlFor: string; error?: string | string[] | null; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const err = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {err ? <p id={`${htmlFor}-error`} className="text-xs text-danger" role="alert">{err}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-surface shadow-card", className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-3 border-b border-border px-4 py-3", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-3", className)} {...props} />;
}

const TONES = {
  neutral: "bg-neutral-soft text-foreground",
  primary: "bg-primary-soft text-primary",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", className, children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONES[tone], className)} {...props}>
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}

export function EmptyState({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon ? <div className="text-muted [&_svg]:size-8">{icon}</div> : null}
      <p className="text-base font-semibold">{title}</p>
      {children ? <div className="max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Alert({ tone = "info", title, children, action, className }: { tone?: Tone; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-3 rounded-md px-3 py-2 text-sm", TONES[tone], className)}>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children ? <div className="opacity-90">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
