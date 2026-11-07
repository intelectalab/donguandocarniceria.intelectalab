import { useId } from "react";

/**
 * Franja de la marca: triángulos de colores sobre una base oscura. Toma los colores del tema
 * activo (variables --franja-*: las de globals.css o las de la marca elegida, lib/temaMarca), así
 * que cambia con la marca. Decorativa: aria-hidden.
 *   <Franja className="h-2 w-full" />
 */
export function Franja({ className = "" }: { className?: string }) {
  // Id del patrón sin «:» (useId los trae y en url(#…) estorban).
  const id = `franja-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg aria-hidden="true" focusable="false" className={`block ${className}`} preserveAspectRatio="none">
      <defs>
        <pattern id={id} width="48" height="8" patternUnits="userSpaceOnUse">
          <rect width="48" height="8" fill="var(--franja-base)" />
          <path d="M0 8 6 0 12 8Z" fill="var(--franja-1)" />
          <path d="M12 0 18 8 24 0Z" fill="var(--franja-2)" />
          <path d="M24 8 30 0 36 8Z" fill="var(--franja-3)" />
          <path d="M36 0 42 8 48 0Z" fill="var(--franja-4)" />
          <path d="M4.5 4h3M28.5 4h3M16.5 4h3M40.5 4h3" stroke="var(--franja-base)" strokeWidth="1.2" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
