"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const SIZES = { sm: "max-w-[420px]", md: "max-w-[560px]", lg: "max-w-[680px]", xl: "max-w-[960px]" };

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  size?: keyof typeof SIZES;
  /** Botones de abajo (Cancelar, Guardar…). */
  footer?: ReactNode;
  /** false mientras se guarda: Escape y el clic afuera no cierran. */
  dismissable?: boolean;
  /** "right" (por defecto): panel que entra por la derecha, para crear y editar. "center": diálogo corto. */
  placement?: "right" | "center";
  children: ReactNode;
};

/**
 * Panel que entra por la derecha (o diálogo centrado con placement="center"). Se monta solo
 * mientras está abierto: un formulario adentro empieza siempre limpio.
 *   <Modal open={abierto} onClose={() => setAbierto(false)} title="Nueva empresa"
 *     footer={<><Button onClick={cerrar}>Cancelar</Button><Button variant="primary" type="submit" form="f-empresa">Guardar</Button></>}>
 *     <form id="f-empresa" onSubmit={guardar}>…</form>
 *   </Modal>
 */
export function Modal({ open, onClose, title, description, size = "md", footer, dismissable = true, placement = "right", children }: Props) {
  if (!open) return null;
  return <ModalAbierto {...{ onClose, title, description, size, footer, dismissable, placement }}>{children}</ModalAbierto>;
}

function ModalAbierto({ onClose, title, description, size = "md", footer, dismissable, placement, children }: Omit<Props, "open">) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cerrar = useRef(onClose);
  const puedeCerrar = useRef(dismissable);
  useEffect(() => {
    cerrar.current = onClose;
    puedeCerrar.current = dismissable;
  });

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    // Foco al primer campo; si no hay, al panel.
    const primero = panel.current?.querySelector<HTMLElement>("input:not([type=hidden]),select,textarea,[autofocus]");
    (primero ?? panel.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && puedeCerrar.current) cerrar.current();
      if (e.key !== "Tab" || !panel.current) return;
      // El foco no sale de la ventana con Tab.
      const focusables = [...panel.current.querySelectorAll<HTMLElement>("a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex='-1'])")];
      if (!focusables.length) return;
      const [a, z] = [focusables[0], focusables[focusables.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previo?.focus?.();
    };
  }, []);

  return createPortal(
    <div className={`fixed inset-0 z-[300] flex bg-[var(--overlay)] animate-[ui-fade_.15s_ease-out] ${placement === "right" ? "justify-end" : "items-end justify-center sm:items-center sm:p-4"}`}
      onMouseDown={(e) => e.target === e.currentTarget && dismissable && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`flex w-full ${SIZES[size]} flex-col border-line bg-surface shadow-[0_20px_50px_rgba(40,8,18,0.28)] outline-none ${placement === "right"
          ? "h-full border-l animate-[ui-slide-in_.22s_cubic-bezier(.2,.8,.2,1)]"
          : "max-h-[92vh] rounded-t-xl border sm:rounded-xl"}`}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={!dismissable} aria-label="Cerrar"
            className="-mr-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2 disabled:opacity-40">
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
