"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Alert, Button, Modal } from "@/components/ui";
import { erroresDe, mensajeDe } from "@/lib/api";

/** Modal de formulario corto con errores por campo. */
export function Dialogo({ titulo, boton, aviso, onClose, enviar, children }: {
  titulo: string; boton: string; aviso?: string; onClose: () => void; enviar: () => Promise<void>;
  children: (errores: Record<string, string>) => ReactNode;
}) {
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  async function enviarForm(e: FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(""); setErrores({});
    try {
      await enviar();
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} dismissable={!guardando} title={titulo}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button type="submit" form="f-dialogo" variant="primary" loading={guardando}>{boton}</Button></>}>
      <form id="f-dialogo" onSubmit={enviarForm} noValidate className="grid gap-4 sm:grid-cols-2">
        {aviso && <div className="sm:col-span-2"><Alert tone="info">{aviso}</Alert></div>}
        {error && <p role="alert" className="rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad sm:col-span-2">{error}</p>}
        {children(errores)}
      </form>
    </Modal>
  );
}
