"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Checkbox, Field, Input, Modal, Select, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { CANALES, ESTADOS_LISTA, TIPOS_CLIENTE, type ListaPrecio } from "./tipos";

const manana = () => { const d = new Date(Date.now() + 86400000); return d.toLocaleDateString("en-CA", { timeZone: "America/Lima" }); };

/** Crear o editar una lista de precio (CAT-05, RN-CAT-05). */
export function ListaForm({ lista, marcas, marcaPorDefecto, onClose, onGuardada }: {
  lista: ListaPrecio | null; marcas: { id: string; name: string }[]; marcaPorDefecto: string;
  onClose: () => void; onGuardada: (id: string) => void;
}) {
  const [v, setV] = useState(() => ({
    code: lista?.code ?? "", name: lista?.name ?? "", brand_id: lista ? (lista.brand_id ?? "") : marcaPorDefecto,
    priority: String(lista?.priority ?? 100), valid_from: lista?.valid_from ?? manana(), valid_to: lista?.valid_to ?? "",
    includes_igv: lista?.includes_igv ?? true, status: lista?.status ?? "DRAFT",
    channels: lista?.channels ?? [] as string[], customer_types: lista?.customer_types ?? [] as string[],
  }));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = (k: keyof typeof v) => (valor: string | boolean) => setV((x) => ({ ...x, [k]: valor }));
  const alternar = (k: "channels" | "customer_types", valor: string, si: boolean) =>
    setV((x) => ({ ...x, [k]: si ? [...x[k], valor] : x[k].filter((y) => y !== valor) }));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(""); setErrores({});
    try {
      const body = { ...v, brand_id: v.brand_id || null, priority: Number(v.priority), valid_to: v.valid_to || null };
      const r = await api<{ id: string }>(lista ? `/v1/cat/listas/${lista.id}` : "/v1/cat/listas", { method: lista ? "PUT" : "POST", body });
      toast.ok(lista ? "Lista actualizada" : "Lista creada");
      onGuardada(r.id);
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} size="lg" title={lista ? `Editar ${lista.name}` : "Nueva lista de precio"}
      footer={<>
        <Button onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button type="submit" form="f-lista" variant="primary" loading={guardando}>{lista ? "Guardar cambios" : "Crear lista"}</Button>
      </>}>
      <form id="f-lista" onSubmit={guardar} noValidate className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Alert tone="info">Canales o tipos de cliente sin marcar = cualquiera. Entre las listas que aplican gana la de menor prioridad y, a igual prioridad, la más específica (RN-CAT-05).</Alert>
        </div>
        <Field label="Código" required error={errores.code} hint="Único. Ej.: DG-WA">
          <Input value={v.code} onChange={(e) => set("code")(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} maxLength={20} className="font-mono uppercase" />
        </Field>
        <Field label="Nombre" required error={errores.name}>
          <Input value={v.name} onChange={(e) => set("name")(e.target.value)} maxLength={255} />
        </Field>
        <Field label="Marca" error={errores.brand_id} hint="Vacío: aplica a todas las marcas.">
          <Select value={v.brand_id} onChange={(e) => set("brand_id")(e.target.value)} placeholder="Todas las marcas"
            options={marcas.map((m) => ({ value: m.id, label: m.name }))} />
        </Field>
        <Field label="Prioridad" required error={errores.priority} hint="Menor número gana. Sin prioridad = 100.">
          <Input type="number" min={0} max={999} step={1} value={v.priority} onChange={(e) => set("priority")(e.target.value)} />
        </Field>
        <Field label="Vigente desde" required error={errores.valid_from}>
          <Input type="date" value={v.valid_from} onChange={(e) => set("valid_from")(e.target.value)} />
        </Field>
        <Field label="Vigente hasta" error={errores.valid_to} hint="Vacío: sin fecha de fin.">
          <Input type="date" value={v.valid_to} onChange={(e) => set("valid_to")(e.target.value)} />
        </Field>
        <Field label="Estado" required error={errores.status}>
          <Select value={v.status} onChange={(e) => set("status")(e.target.value)} options={ESTADOS_LISTA} />
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox checked={v.includes_igv} onChange={set("includes_igv")} label="Los precios incluyen IGV" />
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-[13px] font-medium">Canales</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CANALES.map((c) => <Checkbox key={c.value} checked={v.channels.includes(c.value)} onChange={(si) => alternar("channels", c.value, si)} label={c.label} />)}
          </div>
          {errores.channels && <p className="mt-1.5 text-[12.5px] text-bad">{errores.channels}</p>}
        </fieldset>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-[13px] font-medium">Tipos de cliente</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TIPOS_CLIENTE.map((c) => <Checkbox key={c.value} checked={v.customer_types.includes(c.value)} onChange={(si) => alternar("customer_types", c.value, si)} label={c.label} />)}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
