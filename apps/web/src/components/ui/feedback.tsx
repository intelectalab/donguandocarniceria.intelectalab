"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { Button } from "./Button";
import { Field, Textarea } from "./Field";
import { Modal } from "./Modal";

// Avisos flotantes y confirmaciones que se llaman desde cualquier pantalla sin montar nada:
// <UiHost /> ya está en el armazón (AppShell).

type Tono = "ok" | "bad" | "info";
type Aviso = { id: number; tono: Tono; texto: string };

type Confirmacion = {
  title: string;
  message?: string;
  /** Texto del botón que confirma: «Eliminar», «Cerrar período»… */
  confirmLabel?: string;
  danger?: boolean;
  /** Pide un motivo (muchas reglas RN lo exigen) con este mínimo de caracteres. */
  reason?: { label?: string; min?: number; optional?: boolean };
};
type Pendiente = Confirmacion & { resolver: (r: { reason?: string } | null) => void };

let avisos: Aviso[] = [];
let pendiente: Pendiente | null = null;
let siguienteId = 1;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((fn) => fn());
const suscribir = (fn: () => void) => {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
};

function mostrar(tono: Tono, texto: string) {
  const id = siguienteId++;
  avisos = [...avisos, { id, tono, texto }];
  avisar();
  setTimeout(() => cerrarAviso(id), tono === "bad" ? 7000 : 4000);
}
function cerrarAviso(id: number) {
  avisos = avisos.filter((a) => a.id !== id);
  avisar();
}

/**
 *   toast.ok("Empresa guardada");
 *   toast.error(mensajeDe(err));
 */
export const toast = {
  ok: (texto: string) => mostrar("ok", texto),
  error: (texto: string) => mostrar("bad", texto),
  info: (texto: string) => mostrar("info", texto),
};

/**
 * Pide confirmación antes de una acción. Devuelve null si se cancela.
 *   if (!(await confirmAction({ title: "¿Desactivar el local?", confirmLabel: "Desactivar", danger: true }))) return;
 *   const r = await confirmAction({ title: "Reabrir octubre", reason: { min: 10 } });
 *   if (r) await api(…, { body: { reason: r.reason } });
 */
export function confirmAction(opciones: Confirmacion): Promise<{ reason?: string } | null> {
  pendiente?.resolver(null);
  return new Promise((resolver) => {
    pendiente = { ...opciones, resolver };
    avisar();
  });
}
function responder(r: { reason?: string } | null) {
  pendiente?.resolver(r);
  pendiente = null;
  avisar();
}

const TONOS: Record<Tono, { clase: string; Icono: typeof Info }> = {
  ok: { clase: "border-ok/30 bg-ok-soft text-ok", Icono: CheckCircle2 },
  bad: { clase: "border-bad/30 bg-bad-soft text-bad", Icono: XCircle },
  info: { clase: "border-info/30 bg-info-soft text-info", Icono: Info },
};

/** Se monta una vez en el armazón. */
export function UiHost() {
  const lista = useSyncExternalStore(suscribir, () => avisos, () => avisos);
  const confirmacion = useSyncExternalStore(suscribir, () => pendiente, () => null);
  const montado = useSyncExternalStore(suscribir, () => true, () => false);

  return (
    <>
      {montado && createPortal(
        <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 left-4 z-[400] flex flex-col items-end gap-2 sm:left-auto">
          {lista.map(({ id, tono, texto }) => {
            const { clase, Icono } = TONOS[tono];
            return (
              <div key={id} role={tono === "bad" ? "alert" : "status"}
                className={`pointer-events-auto flex w-full max-w-[380px] items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13.5px] shadow-card ${clase}`}>
                <Icono size={17} className="mt-px shrink-0" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-ink">{texto}</p>
                <button type="button" onClick={() => cerrarAviso(id)} aria-label="Cerrar aviso" className="cursor-pointer text-muted hover:text-ink">
                  <X size={15} />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
      {confirmacion && <DialogoConfirmar key={confirmacion.title} {...confirmacion} />}
    </>
  );
}

function DialogoConfirmar({ title, message, confirmLabel = "Confirmar", danger, reason }: Pendiente) {
  const [motivo, setMotivo] = useState("");
  const min = reason?.optional ? 0 : reason?.min ?? 10;
  const falta = reason ? Math.max(0, min - motivo.trim().length) : 0;

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (falta) return;
    responder(reason ? { reason: motivo.trim() } : {});
  }

  return (
    <Modal open onClose={() => responder(null)} title={title} size="sm" placement="center"
      footer={<>
        <Button onClick={() => responder(null)}>Cancelar</Button>
        <Button type="submit" form="ui-confirmar" variant={danger ? "danger" : "primary"} disabled={falta > 0}>{confirmLabel}</Button>
      </>}>
      <form id="ui-confirmar" onSubmit={enviar} className="grid gap-4">
        {message && (
          <p className="flex gap-2.5 text-[13.5px] text-ink">
            {danger && <AlertTriangle size={18} className="mt-px shrink-0 text-bad" aria-hidden="true" />}
            {message}
          </p>
        )}
        {reason && (
          <Field label={reason.label ?? "Motivo"} required={!reason.optional}
            hint={falta ? `Faltan ${falta} caracteres (mínimo ${min}).` : reason.optional ? "Opcional. Queda en el historial." : "Queda registrado en la auditoría."}>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} />
          </Field>
        )}
      </form>
    </Modal>
  );
}
