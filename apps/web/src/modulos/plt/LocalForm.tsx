"use client";

import { useState, type FormEvent } from "react";
import { Button, Checkbox, Field, Input, MapPicker, Modal, Select, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { UbigeoInput } from "./UbigeoInput";
import { TIPOS_LOCAL, type Empresa, type Local } from "./tipos";

type Valores = {
  company_id: string; code: string; short: string; name: string; est_type: string; sunat_code: string;
  address: string; ubigeo: string; lat: string; lng: string; has_counter: boolean; status: string;
};

/** Crear o editar un local (PLT-04). Se monta al abrir. */
export function LocalForm({ local, empresas, otros, onClose, onGuardado }:
  { local: Local | null; empresas: Empresa[]; otros: Local[]; onClose: () => void; onGuardado: () => void }) {
  const [v, setV] = useState<Valores>(() => ({
    company_id: local?.company_id ?? empresas[0]?.id ?? "", code: local?.code ?? "", short: local?.short ?? "",
    name: local?.name ?? "", est_type: local?.est_type ?? "STORE", sunat_code: local?.sunat_code ?? "",
    address: local?.address ?? "", ubigeo: local?.ubigeo ?? "", lat: local?.lat?.toString() ?? "", lng: local?.lng?.toString() ?? "",
    has_counter: local?.has_counter ?? false, status: local?.status ?? "ACTIVE",
  }));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = <K extends keyof Valores>(campo: K) => (valor: Valores[K]) => setV((x) => ({ ...x, [campo]: valor }));
  const pin = v.lat !== "" && v.lng !== "" && !Number.isNaN(Number(v.lat)) && !Number.isNaN(Number(v.lng))
    ? { lat: Number(v.lat), lng: Number(v.lng) } : null;
  const referencias = otros
    .filter((o) => o.id !== local?.id && o.lat !== null && o.lng !== null)
    .map((o) => ({ lat: o.lat!, lng: o.lng!, label: o.code, title: o.name }));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const body = { ...v, ubigeo: v.ubigeo || null, lat: v.lat === "" ? null : Number(v.lat), lng: v.lng === "" ? null : Number(v.lng) };
      await api(local ? `/v1/plt/locales/${local.id}` : "/v1/plt/locales", { method: local ? "PUT" : "POST", body });
      toast.ok(local ? "Local actualizado" : "Local creado");
      onGuardado();
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} size="lg"
      title={local ? local.name : "Nuevo local"}
      footer={<>
        <Button onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button type="submit" form="f-local" variant="primary" loading={guardando}>{local ? "Guardar cambios" : "Crear local"}</Button>
      </>}>
      <form id="f-local" onSubmit={guardar} noValidate className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad sm:col-span-2">{error}</p>}
        <Field label="Empresa" required error={errores.company_id} className="sm:col-span-2">
          <Select value={v.company_id} onChange={(e) => set("company_id")(e.target.value)}
            options={empresas.map((c) => ({ value: c.id, label: `${c.legal_name} · ${c.ruc}` }))} />
        </Field>
        <Field label="Código interno" required error={errores.code} hint="De 1 a 6 letras o números (L1, AQP…).">
          <Input value={v.code} onChange={(e) => set("code")(e.target.value.toUpperCase())} maxLength={6} className="font-mono uppercase" />
        </Field>
        <Field label="Nombre corto" required error={errores.short} hint="Es el que aparece en los selectores.">
          <Input value={v.short} onChange={(e) => set("short")(e.target.value)} maxLength={40} />
        </Field>
        <Field label="Nombre" required error={errores.name} className="sm:col-span-2">
          <Input value={v.name} onChange={(e) => set("name")(e.target.value)} maxLength={255} placeholder="Local 1 · Surco (producción y mostrador)" />
        </Field>
        <Field label="Tipo" required error={errores.est_type}>
          <Select value={v.est_type} onChange={(e) => set("est_type")(e.target.value)} options={TIPOS_LOCAL} />
        </Field>
        <Field label="Código anexo SUNAT" required error={errores.sunat_code} hint="4 dígitos; 0000 es el domicilio fiscal.">
          <Input value={v.sunat_code} onChange={(e) => set("sunat_code")(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={4} className="font-mono" />
        </Field>
        <Field label="Dirección" required error={errores.address} className="sm:col-span-2">
          <Input value={v.address} onChange={(e) => set("address")(e.target.value)} maxLength={255} />
        </Field>
        <Field label="Ubigeo" error={errores.ubigeo}>
          <UbigeoInput value={v.ubigeo} onChange={set("ubigeo")} conocido={local ? { code: local.ubigeo, district: local.district } : undefined} />
        </Field>
        <Field label="Estado" required error={errores.status}>
          <Select value={v.status} onChange={(e) => set("status")(e.target.value)} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} />
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[12.5px] font-medium text-muted">Ubicación</p>
          <MapPicker value={pin} references={referencias}
            onChange={(p) => setV((x) => ({ ...x, lat: String(p.lat), lng: String(p.lng) }))} />
        </div>
        <Field label="Latitud" error={errores.lat}>
          <Input type="number" step="0.00001" value={v.lat} onChange={(e) => set("lat")(e.target.value)} placeholder="-12.13760" />
        </Field>
        <Field label="Longitud" error={errores.lng}>
          <Input type="number" step="0.00001" value={v.lng} onChange={(e) => set("lng")(e.target.value)} placeholder="-76.99210" />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox checked={v.has_counter} onChange={set("has_counter")} label="Tiene mostrador (POS)"
            hint="Solo los locales con mostrador abren turnos de caja y venden en el POS." />
        </div>
      </form>
    </Modal>
  );
}
