"use client";

import { useEffect, useState } from "react";
import { Field, Input, Select, Textarea, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { Dialogo } from "./Dialogo";
import { DOCUMENTOS, TIPOS_CLIENTE, type FichaCliente } from "./tipos";

/** Editar los datos del cliente (CLI-02). El celular se guarda en E.164 (RN-CLI-01); cambiar el documento borra su validación. */
export function ClienteForm({ cliente, onClose, onGuardado }: { cliente: FichaCliente; onClose: () => void; onGuardado: () => void }) {
  const [v, setV] = useState({
    full_name: cliente.full_name, trade_name: cliente.trade_name ?? "", customer_type: cliente.customer_type,
    phone: cliente.phone ?? "", phone_alt: cliente.phone_alt ?? "", email: cliente.email ?? "",
    doc_type: cliente.doc_type, doc_number: cliente.doc_number ?? "", seller_user_id: cliente.seller_user_id ?? "", notes: cliente.notes ?? "",
  });
  const [vendedoras, setVendedoras] = useState<{ id: string; name: string }[]>([]);
  const set = (k: keyof typeof v) => (valor: string) => setV((x) => ({ ...x, [k]: valor }));

  useEffect(() => {
    let vigente = true;
    api<{ opciones: { vendedoras: { id: string; name: string }[] } }>("/v1/cli/clientes/resumen").then((r) => vigente && setVendedoras(r.opciones.vendedoras)).catch(() => {});
    return () => { vigente = false; };
  }, []);

  const cambiaDoc = v.doc_type !== cliente.doc_type || (v.doc_number || null) !== cliente.doc_number;

  return (
    <Dialogo titulo={`Editar ${cliente.nombre}`} boton="Guardar" onClose={onClose}
      aviso={cambiaDoc && cliente.doc_validated_at ? "Cambiaste el documento: al guardar se borra su validación y hay que validarlo de nuevo (CLI-04)." : undefined}
      enviar={async () => {
        await api(`/v1/cli/clientes/${cliente.id}`, { method: "PUT", body: { ...v, doc_number: v.doc_type === "NONE" ? null : v.doc_number, seller_user_id: v.seller_user_id || null } });
        toast.ok("Cliente actualizado");
        onGuardado();
      }}>
      {(e) => <>
        <Field label="Nombre o razón social" required error={e.full_name} className="sm:col-span-2"><Input value={v.full_name} onChange={(x) => set("full_name")(x.target.value)} /></Field>
        <Field label="Nombre comercial" error={e.trade_name}><Input value={v.trade_name} onChange={(x) => set("trade_name")(x.target.value)} /></Field>
        <Field label="Tipo" required error={e.customer_type}><Select value={v.customer_type} onChange={(x) => set("customer_type")(x.target.value)} options={TIPOS_CLIENTE} /></Field>
        <Field label="Celular principal" hint="Se guarda como +51…" error={e.phone}><Input inputMode="tel" value={v.phone} onChange={(x) => set("phone")(x.target.value)} /></Field>
        <Field label="Celular alterno" error={e.phone_alt}><Input inputMode="tel" value={v.phone_alt} onChange={(x) => set("phone_alt")(x.target.value)} /></Field>
        <Field label="Correo" error={e.email} className="sm:col-span-2"><Input type="email" value={v.email} onChange={(x) => set("email")(x.target.value)} /></Field>
        <Field label="Documento" required error={e.doc_type}><Select value={v.doc_type} onChange={(x) => set("doc_type")(x.target.value)} options={DOCUMENTOS} /></Field>
        <Field label="Número" error={e.doc_number}><Input value={v.doc_number} disabled={v.doc_type === "NONE"} onChange={(x) => set("doc_number")(x.target.value)} /></Field>
        <Field label="Vendedora asignada" error={e.seller_user_id} className="sm:col-span-2">
          <Select value={v.seller_user_id} onChange={(x) => set("seller_user_id")(x.target.value)} placeholder="Sin vendedora" options={vendedoras.map((u) => ({ value: u.id, label: u.name }))} />
        </Field>
        <Field label="Notas" error={e.notes} className="sm:col-span-2"><Textarea value={v.notes} onChange={(x) => set("notes")(x.target.value)} /></Field>
      </>}
    </Dialogo>
  );
}
