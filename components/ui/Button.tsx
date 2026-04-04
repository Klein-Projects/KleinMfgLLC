"use client";

import Link from "next/link";

type ButtonVariant = "primary" | "secondary" | "outline";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonBaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
  className?: string;
}

interface ButtonAsLink extends ButtonBaseProps {
  href: string;
  onClick?: never;
  type?: never;
}

interface ButtonAsButton extends ButtonBaseProps {
  href?: never;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit" | "reset";
}

type ButtonProps = ButtonAsLink | ButtonAsButton;

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-red text-white hover:bg-red/90 focus-visible:ring-red",
  secondary:
    "bg-navy text-white hover:bg-navy/90 focus-visible:ring-navy",
  outline:
    "border-2 border-navy text-navy hover:bg-navy hover:text-white focus-visible:ring-navy",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-5 py-2.5 text-base",
  lg: "px-7 py-3 text-lg",
};

export default function Button({
  variant = "primary",
  size = "md",
  children,
  className = "",
  ...props
}: ButtonProps) {
  const classes = [
    "inline-flex items-center justify-center rounded-md font-semibold transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    variantClasses[variant],
    sizeClasses[size],
    className,
  ].join(" ");

  if ("href" in props && props.href) {
    return (
      <Link href={props.href} className={classes}>
        {children}
      </Link>
    );
  }

  const { onClick, type = "button" } = props as ButtonAsButton;
  return (
    <button type={type} onClick={onClick} className={classes}>
      {children}
    </button>
  );
}
