"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";

// Movimiento de la página pública: lo justo para que se sienta viva, sin marear. Todo se apaga para
// quien pidió menos movimiento en su sistema (se ve quieto y completo desde el inicio).

const SUAVE = [0.22, 1, 0.36, 1] as const;

/** Aparece al entrar en pantalla (una vez): sube un poco y se aclara. «desde» cambia la dirección. */
export function Aparece({ children, retraso = 0, desde = "abajo", className }: {
  children: ReactNode; retraso?: number; desde?: "abajo" | "izquierda" | "derecha"; className?: string;
}) {
  const quieto = useReducedMotion();
  if (quieto) return <div className={className}>{children}</div>;
  const inicio = desde === "izquierda" ? { x: -36 } : desde === "derecha" ? { x: 36 } : { y: 28 };
  return (
    <motion.div className={className} initial={{ opacity: 0, ...inicio }} whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -80px 0px" }} transition={{ duration: 0.7, delay: retraso, ease: SUAVE }}>
      {children}
    </motion.div>
  );
}

/** Una cifra que cuenta hasta su valor cuando aparece (S/ 8,420.50, 642.80 kg…). */
export function Cifra({ valor, decimales = 0, prefijo = "", sufijo = "", duracion = 1.4, separador = true }: {
  valor: number; decimales?: number; prefijo?: string; sufijo?: string; duracion?: number; separador?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const visto = useInView(ref, { once: true, margin: "0px 0px -40px 0px" });
  const quieto = useReducedMotion();
  const formato = (n: number) => `${prefijo}${n.toLocaleString(separador ? "en-US" : "es-PE", { minimumFractionDigits: decimales, maximumFractionDigits: decimales, useGrouping: separador })}${sufijo}`;
  const [texto, setTexto] = useState(formato(quieto ? valor : 0));
  useEffect(() => {
    if (!visto || quieto) return;
    const control = animate(0, valor, { duration: duracion, ease: SUAVE, onUpdate: (v) => setTexto(formato(v)) });
    return () => control.stop();
  }, [visto]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref} className="tabular-nums">{texto}</span>;
}

/** Una barra que crece hasta su porcentaje cuando aparece. */
export function Barra({ porcentaje, color, className = "h-3" }: { porcentaje: number; color: string; className?: string }) {
  const quieto = useReducedMotion();
  return (
    <div className={`w-full overflow-hidden rounded-full bg-[#E0D9D2] ${className}`}>
      <motion.div className="h-full rounded-full" style={{ background: color }}
        initial={{ width: quieto ? `${porcentaje}%` : "0%" }} whileInView={{ width: `${porcentaje}%` }}
        viewport={{ once: true }} transition={{ duration: 1.2, delay: 0.15, ease: SUAVE }} />
    </div>
  );
}

/** Punto que late (algo está «en línea» o «en vivo»). */
export function Latido({ color = "#2E7D4F" }: { color?: string }) {
  return (
    <span className="relative inline-flex size-2">
      <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden" style={{ background: color }} />
      <span className="relative inline-flex size-2 rounded-full" style={{ background: color }} />
    </span>
  );
}
