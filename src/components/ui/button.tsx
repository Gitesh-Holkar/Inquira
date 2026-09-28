import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        outline: "border border-border bg-surface text-foreground hover:bg-surface-2",
        ghost: "text-foreground hover:bg-surface-2",
        soft: "bg-primary-soft text-primary hover:opacity-90",
        danger: "bg-danger text-white hover:opacity-90 dark:text-black",
        link: "text-primary underline-offset-4 hover:underline px-0",
      },
      size: {
        sm: "h-8 px-3",
        default: "h-10 px-4",
        lg: "h-11 px-5 text-base",
        icon: "size-10",
        touch: "h-11 min-w-11 px-4", // ≥44px tap target on phones
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";
