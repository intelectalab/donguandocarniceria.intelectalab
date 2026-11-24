"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Textarea, toast } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { erroresDe, mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { setToken } from "@/lib/auth";
import { MODULOS } from "@/lib/modulos";

type Opciones = { empresas: { id: string; short: string }[]; modulos: string[]; tickets: { id: string; number: string; subject: string }[]; max_horas: number };

/**
 * OPS-05 Solicitar acceso de soporte: empresa, ticket, motivo, nivel, módulos, exportación y horas sugeridas. Queda
 * pendiente hasta que la empresa lo apruebe. Nivel 1 de soporte pide solo lectura; lectura y escritura, nivel 2,
 * ingeniería y administración.
 */
export function PedirAcceso({ empresa, ticket, onClose, onPedido }: { empresa?: string; ticket?: string; onClose: () => void; onPedido: () => void }) {
  const yo = useUsuarioConsola();
  const [f, setF] = useState({ tenant_id: empresa ?? "", ticket_id: ticket ?? "", reason: "", level: "RO", modules: [] as string[], can_export: false, hours: "8" });
  const [op, setOp] = useState<Opciones | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    apiConsola<Opciones>(`/accesos/opciones${f.tenant_id ? `?tenant=${f.tenant_id}` : ""}`).then(setOp).catch((e) => toast.error(mensajeDe(e)));
  }, [f.tenant_id]);

  const rw = Boolean(yo.puede["access.request_rw"]);
  const nombre = (c: string) => MODULOS.find((m) => m.code === c)?.name ?? c;
  const marcar = (c: string) => setF({ ...f, modules: f.modules.includes(c) ? f.modules.filter((m) => m !== c) : [...f.modules, c] });

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await apiConsola("/accesos", { method: "POST", body: { ...f, ticket_id: f.ticket_id || null, hours: Number(f.hours) } });
      toast.ok("Acceso pedido: queda por aprobar en la empresa");
      onPedido();
    } catch (err) {
      setErrores(erroresDe(err));
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} title="Pedir acceso de soporte"
      description="La empresa lo aprueba o lo rechaza. Es personal: entra solo quien lo pide, por el tiempo que la empresa apruebe."
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-acceso" icon={KeyRound} loading={guardando}>Pedir acceso</Button></>}>
      <form id="f-acceso" onSubmit={enviar} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Empresa" required error={errores.tenant_id}>
            <Select value={f.tenant_id} onChange={(e) => setF({ ...f, tenant_id: e.target.value, ticket_id: "", modules: [] })} placeholder="Elige la empresa"
              options={(op?.empresas ?? []).map((t) => ({ value: t.id, label: t.short }))} />
          </Field>
          <Field label="Ticket" error={errores.ticket_id}>
            <Select value={f.ticket_id} onChange={(e) => setF({ ...f, ticket_id: e.target.value })} placeholder="Sin ticket" disabled={!f.tenant_id}
              options={(op?.tickets ?? []).map((t) => ({ value: t.id, label: `${t.number} · ${t.subject}` }))} />
          </Field>
        </div>
        <Field label="Motivo" required error={errores.reason} hint="Lo ve la empresa al aprobar: qué vas a revisar y por qué.">
          <Textarea rows={3} maxLength={1000} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nivel" required error={errores.level}>
            <Select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} options={[
              { value: "RO", label: "Solo lectura" }, { value: "RW", label: "Lectura y escritura", disabled: !rw },
            ]} />
          </Field>
          <Field label="Horas sugeridas" required error={errores.hours} hint={op ? `Máximo ${op.max_horas} h` : undefined}>
            <Input type="number" min={1} max={op?.max_horas ?? 72} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />
          </Field>
        </div>
        <Checkbox checked={f.can_export} onChange={(v) => setF({ ...f, can_export: v })} label="Necesito exportar (descargar archivos)" />
        <Field label="Módulos" error={errores.modules} hint="Sin marcar ninguno: todos los módulos de la empresa.">
          {!f.tenant_id ? <p className="text-[13px] text-muted">Elige primero la empresa.</p> : (
            <div className="grid max-h-52 grid-cols-2 gap-x-3 gap-y-1.5 overflow-y-auto rounded-lg border border-line p-2.5 sm:grid-cols-3">
              {(op?.modulos ?? []).map((c) => <Checkbox key={c} checked={f.modules.includes(c)} onChange={() => marcar(c)} label={nombre(c)} />)}
            </div>
          )}
        </Field>
        {!rw && <Alert tone="info">Tu rol pide accesos de solo lectura.</Alert>}
      </form>
    </Modal>
  );
}

/** OPS-06: abre la empresa con el acceso, en otra pestaña (la sesión vence con el acceso). */
export async function entrarConAcceso(id: string) {
  try {
    const r = await apiConsola<{ token: string }>(`/accesos/${id}/entrar`, { method: "POST" });
    setToken(r.token, false);
    window.open("/inicio", "_blank", "noopener");
  } catch (e) {
    toast.error(mensajeDe(e));
  }
}
