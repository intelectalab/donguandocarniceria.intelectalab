"use client";

import { useState } from "react";
import { Field, Input, Select, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { Dialogo } from "./Dialogo";
import { DOCUMENTOS, hoyLima, type ResumenTrabajadores, type Trabajador } from "./tipos";

/**
 * Alta o edición de un trabajador (MAE-02). El documento solo se escribe en el alta: identifica al trabajador
 * (RN-MAE-01). El celular se guarda con código de país.
 */
export function TrabajadorForm({ trabajador, opciones, onClose, onGuardado }: {
  trabajador?: Trabajador; opciones: ResumenTrabajadores; onClose: () => void; onGuardado: (id: string) => void;
}) {
  const nuevo = !trabajador;
  const [v, setV] = useState({
    doc_type: trabajador?.doc_type ?? "DNI", doc_number: trabajador?.doc_number ?? "", full_name: trabajador?.full_name ?? "",
    position: trabajador?.position ?? "", establishment_id: trabajador?.establishment_id ?? opciones.locales[0]?.id ?? "",
    cost_center_id: trabajador?.cost_center_id ?? "", hire_date: trabajador?.hire_date ?? hoyLima(), phone: trabajador?.phone ?? "", email: trabajador?.email ?? "",
  });
  const set = (k: keyof typeof v) => (valor: string) => setV((x) => ({ ...x, [k]: valor }));

  return (
    <Dialogo titulo={nuevo ? "Nuevo trabajador" : `Editar ${trabajador.full_name}`} boton={nuevo ? "Registrar trabajador" : "Guardar"} onClose={onClose}
      enviar={async () => {
        const body = { ...v, phone: v.phone || null, email: v.email || null };
        if (nuevo) {
          const r = await api<{ id: string }>("/v1/mae/trabajadores", { method: "POST", body });
          toast.ok(`${v.full_name} registrado`);
          onGuardado(r.id);
        } else {
          await api(`/v1/mae/trabajadores/${trabajador.id}`, { method: "PUT", body });
          toast.ok("Ficha actualizada");
          onGuardado(trabajador.id);
        }
      }}>
      {(e) => <>
        <Field label="Tipo de documento" required error={e.doc_type}>
          <Select value={v.doc_type} disabled={!nuevo} onChange={(x) => set("doc_type")(x.target.value)} options={DOCUMENTOS} />
        </Field>
        <Field label="Número de documento" required error={e.doc_number} hint={nuevo ? "DNI: 8 dígitos. CE o pasaporte: 6 a 15 letras o dígitos." : undefined}>
          <Input value={v.doc_number} disabled={!nuevo} onChange={(x) => set("doc_number")(x.target.value)} />
        </Field>
        <Field label="Nombre completo" required error={e.full_name} className="sm:col-span-2"><Input value={v.full_name} onChange={(x) => set("full_name")(x.target.value)} /></Field>
        <Field label="Cargo" required error={e.position}>
          <Input value={v.position} list="mae-cargos" onChange={(x) => set("position")(x.target.value)} />
          <datalist id="mae-cargos">{opciones.cargos.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Local" required error={e.establishment_id}>
          <Select value={v.establishment_id} onChange={(x) => set("establishment_id")(x.target.value)} options={opciones.locales.map((l) => ({ value: l.id, label: l.name }))} />
        </Field>
        <Field label="Centro de costo" required error={e.cost_center_id}>
          <Select value={v.cost_center_id} onChange={(x) => set("cost_center_id")(x.target.value)} placeholder="Elige el centro de costo"
            options={opciones.centros.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} />
        </Field>
        <Field label="Fecha de ingreso" required error={e.hire_date}><Input type="date" value={v.hire_date} max={hoyLima()} onChange={(x) => set("hire_date")(x.target.value)} /></Field>
        <Field label="Celular" hint="Se guarda como +51…" error={e.phone}><Input inputMode="tel" placeholder="+51987654321" value={v.phone} onChange={(x) => set("phone")(x.target.value)} /></Field>
        <Field label="Correo" error={e.email}><Input type="email" value={v.email} onChange={(x) => set("email")(x.target.value)} /></Field>
      </>}
    </Dialogo>
  );
}
