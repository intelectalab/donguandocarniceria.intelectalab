"use client";

import { useState, type FormEvent } from "react";
import { notFound } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  Alert, Badge, Button, Checkbox, DataTable, DetailList, Field, IconButton, Input, Modal, PageHeader, Select,
  StatusBadge, Switch, Tabs, Textarea, confirmAction, toast, type Column,
} from "@/components/ui";
import { fecha, fechaHora, kg, porcentaje, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";

type Notificacion = { id: string; title: string; module: string | null; tone: string; read: boolean; created_at: string };

/**
 * Muestra de los componentes compartidos (src/components/ui), con datos reales: la tabla usa
 * useListado sobre /v1/me/notifications. Solo existe en desarrollo.
 */
export default function Componentes() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Muestra />;
}

function Muestra() {
  const [tab, setTab] = useState<"tabla" | "formulario" | "otros">("tabla");
  return (
    <div className="space-y-5">
      <PageHeader code="DEV" description="Componentes compartidos para construir las pantallas. Se importan de @/components/ui."
        actions={<Button variant="primary" icon={Plus} onClick={() => toast.ok("Así se ve un aviso de éxito.")}>Botón principal</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "tabla", label: "Tabla" }, { key: "formulario", label: "Formulario y ventana" }, { key: "otros", label: "Avisos y formatos" },
      ]} />
      {tab === "tabla" && <Tabla />}
      {tab === "formulario" && <Formulario />}
      {tab === "otros" && <Otros />}
    </div>
  );
}

function Tabla() {
  const [soloNoLeidas, setSoloNoLeidas] = useState(false);
  const lista = useListado<Notificacion>("/v1/me/notifications", { porPagina: 10, orden: "-at", filtros: { unread: soloNoLeidas || undefined } });
  const columnas: Column<Notificacion>[] = [
    { key: "title", header: "Aviso", sortable: true, render: (n) => <span className={n.read ? "" : "font-semibold"}>{n.title}</span> },
    { key: "module", header: "Módulo", sortable: true, hideOnMobile: true, render: (n) => n.module ? <Badge tone="primary">{n.module}</Badge> : "—" },
    { key: "tone", header: "Tipo", hideOnMobile: true, render: (n) => <Badge tone={n.tone === "bad" ? "bad" : n.tone === "warn" ? "warn" : "info"}>{n.tone}</Badge> },
    { key: "created_at", header: "Fecha", sortable: true, sortKey: "at", align: "right", render: (n) => fechaHora(n.created_at) },
  ];
  return (
    <DataTable {...lista.tabla} columns={columnas} onRowClick={(n) => toast.info(`Abrirías: ${n.title}`)}
      search={{ ...lista.tabla.search, placeholder: "Buscar aviso o módulo…" }}
      empty="No tienes notificaciones."
      toolbar={<Checkbox checked={soloNoLeidas} onChange={setSoloNoLeidas} label="Solo no leídas" />} />
  );
}

function Formulario() {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={Plus} onClick={() => setAbierto(true)}>Abrir formulario en ventana</Button>
        <Button icon={Pencil}>Secundario</Button>
        <Button variant="ghost">Fantasma</Button>
        <Button variant="danger" icon={Trash2}>Peligro</Button>
        <Button variant="primary" loading>Guardando</Button>
        <Button size="sm">Pequeño</Button>
        <IconButton icon={Pencil} label="Editar" />
      </div>
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <FormularioEjemplo idForm="f-pagina" onGuardado={() => undefined} />
        <div className="mt-4 flex justify-end"><Button type="submit" form="f-pagina" variant="primary">Guardar</Button></div>
      </section>
      <Modal open={abierto} onClose={() => setAbierto(false)} title="Nueva empresa" description="Ejemplo: no guarda nada."
        footer={<>
          <Button onClick={() => setAbierto(false)}>Cancelar</Button>
          <Button type="submit" form="f-modal" variant="primary">Guardar</Button>
        </>}>
        <FormularioEjemplo idForm="f-modal" onGuardado={() => setAbierto(false)} />
      </Modal>
    </div>
  );
}

function FormularioEjemplo({ idForm, onGuardado }: { idForm: string; onGuardado: () => void }) {
  const [ruc, setRuc] = useState("");
  const [nombre, setNombre] = useState("");
  const [regimen, setRegimen] = useState("");
  const [activa, setActiva] = useState(true);
  const [errores, setErrores] = useState<Record<string, string>>({});

  function guardar(e: FormEvent) {
    e.preventDefault();
    // En una pantalla real los errores vienen de la API: setErrores(erroresDe(err)).
    const nuevos: Record<string, string> = {};
    if (!/^\d{11}$/.test(ruc)) nuevos.ruc = "El RUC debe tener 11 dígitos.";
    if (!nombre.trim()) nuevos.nombre = "La razón social es obligatoria.";
    setErrores(nuevos);
    if (Object.keys(nuevos).length) return;
    toast.ok("Guardado (de ejemplo)");
    onGuardado();
  }

  return (
    <form id={idForm} onSubmit={guardar} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field label="RUC" required error={errores.ruc} hint="11 dígitos">
        <Input value={ruc} onChange={(e) => setRuc(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={11} />
      </Field>
      <Field label="Razón social" required error={errores.nombre}>
        <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </Field>
      <Field label="Régimen">
        <Select value={regimen} onChange={(e) => setRegimen(e.target.value)} placeholder="Elige uno"
          options={[{ value: "MYPE", label: "MYPE tributario" }, { value: "GENERAL", label: "General" }, { value: "RER", label: "Especial (RER)" }]} />
      </Field>
      <Field label="Comisión" hint="Con sufijo">
        <Input type="number" step="0.01" suffix="%" placeholder="0.00" />
      </Field>
      <Field label="Observaciones" className="sm:col-span-2">
        <Textarea placeholder="Opcional" />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Switch checked={activa} onChange={setActiva} label="Empresa activa" />
        <span className="text-[13.5px]">{activa ? "Activa" : "Inactiva"}</span>
      </div>
    </form>
  );
}

function Otros() {
  async function desactivar() {
    if (await confirmAction({ title: "¿Desactivar el local?", message: "No se podrán registrar ventas en él.", confirmLabel: "Desactivar", danger: true })) {
      toast.ok("Desactivado (de ejemplo)");
    }
  }
  async function reabrir() {
    const r = await confirmAction({ title: "Reabrir octubre 2026", message: "RN-PLT-18: reabrir exige un motivo.", confirmLabel: "Reabrir", reason: { min: 10 } });
    if (r) toast.info(`Motivo: ${r.reason}`);
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => toast.ok("Empresa guardada")}>Aviso de éxito</Button>
        <Button onClick={() => toast.error("RN-PLT-13: el RUC no es válido.")}>Aviso de error</Button>
        <Button onClick={desactivar}>Confirmar</Button>
        <Button onClick={reabrir}>Confirmar con motivo</Button>
      </div>
      <Alert tone="warn" title="Período en cierre">Octubre está en cierre: solo la contadora puede registrar con esa fecha.</Alert>
      <Alert tone="bad">RN-PLT-05: no se puede grabar con fecha de un período cerrado.</Alert>
      <div className="flex flex-wrap gap-2">
        {["ACTIVE", "INACTIVE", "PENDING", "APPROVED", "REJECTED", "OPEN", "CLOSING", "CLOSED", "LOCKED"].map((s) => <StatusBadge key={s} status={s} />)}
      </div>
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <DetailList items={[
          { label: "soles(1234.5)", value: soles(1234.5) },
          { label: "kg(12.35)", value: kg(12.35) },
          { label: "porcentaje(18)", value: porcentaje(18) },
          { label: "fecha('2026-11-05')", value: fecha("2026-11-05") },
          { label: "fechaHora(ahora, UTC)", value: fechaHora(new Date().toISOString()) },
        ]} />
      </section>
    </div>
  );
}
