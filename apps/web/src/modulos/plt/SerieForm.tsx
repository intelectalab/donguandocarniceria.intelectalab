"use client";

import { useState, type FormEvent } from "react";
import { Button, Checkbox, Field, Input, Modal, Select, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { FORMATO_SERIE, MAXIMO_SERIE, TIPOS_DOCUMENTO, problemaSerie, type Empresa, type Local, type Marca } from "./tipos";

type Valores = {
  company_id: string; doc_type: string; series: string; is_electronic: boolean; establishment_id: string;
  brand_id: string; next_number: string; note: string;
};

/**
 * Crear una serie (PLT-08). Una serie no se edita después: su correlativo lo lleva el sistema al
 * emitir, y si deja de usarse se desactiva.
 */
export function SerieForm({ empresas, locales, marcas, onClose, onGuardada }:
  { empresas: Empresa[]; locales: Local[]; marcas: Marca[]; onClose: () => void; onGuardada: () => void }) {
  const [v, setV] = useState<Valores>(() => ({
    company_id: empresas[0]?.id ?? "", doc_type: "RECEIPT", series: "", is_electronic: true,
    establishment_id: "", brand_id: "", next_number: "1", note: "",
  }));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = <K extends keyof Valores>(campo: K) => (valor: Valores[K]) => setV((x) => ({ ...x, [campo]: valor }));
  const puedeSerElectronica = Boolean(FORMATO_SERIE[v.doc_type]);
  const aviso = problemaSerie(v.series, v.doc_type, v.is_electronic);
  const localesEmpresa = locales.filter((l) => l.company_id === v.company_id);
  const marcasEmpresa = marcas.filter((m) => m.company_id === v.company_id && m.status === "ACTIVE");

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api("/v1/plt/series", {
        method: "POST",
        body: { ...v, next_number: Number(v.next_number), establishment_id: v.establishment_id || null, brand_id: v.brand_id || null, note: v.note || null },
      });
      toast.ok(`Serie ${v.series} creada`);
      onGuardada();
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} size="lg" title="Nueva serie"
      footer={<>
        <Button onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button type="submit" form="f-serie" variant="primary" loading={guardando}>Crear serie</Button>
      </>}>
      <form id="f-serie" onSubmit={guardar} noValidate className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad sm:col-span-2">{error}</p>}
        {empresas.length > 1 && (
          <Field label="Empresa" required error={errores.company_id} className="sm:col-span-2">
            <Select value={v.company_id} onChange={(e) => setV((x) => ({ ...x, company_id: e.target.value, establishment_id: "", brand_id: "" }))}
              options={empresas.map((c) => ({ value: c.id, label: `${c.legal_name} · ${c.ruc}` }))} />
          </Field>
        )}
        <Field label="Tipo de documento" required error={errores.doc_type}>
          <Select value={v.doc_type} options={TIPOS_DOCUMENTO}
            onChange={(e) => setV((x) => ({ ...x, doc_type: e.target.value, is_electronic: Boolean(FORMATO_SERIE[e.target.value]) }))} />
        </Field>
        <Field label="Serie" required error={errores.series ?? aviso ?? undefined}
          hint={FORMATO_SERIE[v.doc_type] && v.is_electronic ? FORMATO_SERIE[v.doc_type].ejemplo : "De 2 a 4 letras o números."}>
          <Input value={v.series} onChange={(e) => set("series")(e.target.value.toUpperCase().replace(/\s/g, ""))} maxLength={4} className="font-mono uppercase" />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox checked={v.is_electronic} onChange={set("is_electronic")} disabled={!puedeSerElectronica}
            label="Electrónica" hint={puedeSerElectronica ? "Se envía a SUNAT a través del proveedor de facturación." : "Este tipo de documento es interno: no se envía a SUNAT."} />
          {errores.is_electronic && <p className="mt-1 text-[12.5px] text-bad">{errores.is_electronic}</p>}
        </div>
        <Field label="Local" error={errores.establishment_id} hint="Vacío: la serie es de toda la empresa.">
          <Select value={v.establishment_id} onChange={(e) => set("establishment_id")(e.target.value)} placeholder="Toda la empresa"
            options={localesEmpresa.map((l) => ({ value: l.id, label: l.short }))} />
        </Field>
        <Field label="Marca" error={errores.brand_id} hint="Vacío: la usan todas las marcas.">
          <Select value={v.brand_id} onChange={(e) => set("brand_id")(e.target.value)} placeholder="Todas las marcas"
            options={marcasEmpresa.map((m) => ({ value: m.id, label: m.name }))} />
        </Field>
        <Field label="Correlativo siguiente" required error={errores.next_number}
          hint="1 para una serie nueva. Si viene de otro sistema, el número que sigue al último emitido.">
          <Input type="number" min={1} max={MAXIMO_SERIE} value={v.next_number} onChange={(e) => set("next_number")(e.target.value)} className="tabular-nums" />
        </Field>
        <Field label="Nota" error={errores.note}>
          <Input value={v.note} onChange={(e) => set("note")(e.target.value)} maxLength={255} placeholder="Mostrador Local 1, feria de agosto…" />
        </Field>
      </form>
    </Modal>
  );
}
