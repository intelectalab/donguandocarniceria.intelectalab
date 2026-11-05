import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2, type LucideIcon } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-ink hover:brightness-110",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-bad text-white hover:brightness-110",
};
const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-[12.5px]",
  md: "h-10 gap-2 rounded-[9px] px-4 text-[13.5px]",
};

/** Clases de botón, para un <Link> que debe verse como botón. */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra = "") {
  return `inline-flex shrink-0 cursor-pointer items-center justify-center font-semibold whitespace-nowrap transition-[filter,background-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Muestra el giro y desactiva el botón mientras se guarda. */
  loading?: boolean;
  icon?: LucideIcon;
  children?: ReactNode;
};

/**
 *   <Button variant="primary" icon={Plus} onClick={…}>Nueva empresa</Button>
 *   <Button type="submit" variant="primary" loading={guardando}>Guardar</Button>
 */
export function Button({ variant = "secondary", size = "md", loading, icon: Icon, className = "", children, disabled, type = "button", ...rest }: Props) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <Loader2 size={size === "sm" ? 14 : 15} className="animate-spin" aria-hidden="true" />
        : Icon && <Icon size={size === "sm" ? 14 : 16} aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Botón solo con ícono: siempre con su nombre para lectores de pantalla y como tooltip. */
export function IconButton({ icon: Icon, label, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button type="button" aria-label={label} title={label}
      className={`inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 ${className}`} {...rest}>
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}
