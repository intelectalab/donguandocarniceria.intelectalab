"use client";

import { useState, type FormEvent } from "react";
import { Button, Field, Input, Modal, Select, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { UbigeoInput } from "./UbigeoInput";
import { REGIMENES, problemaRuc, type Empresa } from "./tipos";

const VACIA = {
  legal_name: "", trade_name: "", ruc: "", tax_regime: "MYPE", fiscal_address: "", fiscal_ubigeo: "",
  default_currency: "PEN", timezone: "America/Lima", status: "ACTIVE",
};

/** Crear o editar una empresa (PLT-03). Se monta al abrir: el formulario empieza limpio. */
export function EmpresaForm({ empresa, onClose, onGuardada }: { empresa: Empresa | null; onClose: () => void; onGuardada: () => void }) {
  const [v, setV] = useState(() => empresa
    ? { ...VACIA, ...Object.fromEntries(Object.keys(VACIA).map((k) => [k, String(empresa[k as keyof Empresa] ?? "")])) }
    : VACIA);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = (campo: keyof typeof VACIA) => (valor: string) => setV((x) => ({ ...x, [campo]: valor }));

  const avisoRuc = v.ruc.length === 11 ? problemaRuc(v.ruc) : null;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api(empresa ? `/v1/plt/empresas/${empresa.id}` : "/v1/plt/empresas", { method: empresa ? "PUT" : "POST", body: v });
      toast.ok(empresa ? "Empresa actualizada" : "Empresa creada");
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
    <Modal open onClose={onClose} dismissable={!guardando} size="lg"
      title={empresa ? empresa.legal_name : "Nueva empresa"}
      footer={<>
        <Button onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button type="submit" form="f-empresa" variant="primary" loading={guardando}>{empresa ? "Guardar cambios" : "Crear empresa"}</Button>
      </>}>
      <form id="f-empresa" onSubmit={guardar} noValidate className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad sm:col-span-2">{error}</p>}
        <Field label="Razón social" required error={errores.legal_name} className="sm:col-span-2" hint="Tal como figura en la ficha RUC.">
          <Input value={v.legal_name} onChange={(e) => set("legal_name")(e.target.value)} maxLength={255} />
        </Field>
        <Field label="RUC" required error={errores.ruc ?? avisoRuc ?? undefined}
          hint={v.ruc.length === 11 && !avisoRuc ? "RUC válido." : "11 dígitos; empieza en 10, 15, 17 o 20."}>
          <Input value={v.ruc} onChange={(e) => set("ruc")(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={11} className="font-mono" />
        </Field>
        <Field label="Nombre comercial" error={errores.trade_name} hint="Si lo dejas vacío, se usa la razón social.">
          <Input value={v.trade_name} onChange={(e) => set("trade_name")(e.target.value)} maxLength={255} />
        </Field>
        <Field label="Régimen tributario" required error={errores.tax_regime}>
          <Select value={v.tax_regime} onChange={(e) => set("tax_regime")(e.target.value)} options={REGIMENES} />
        </Field>
        <Field label="Estado" required error={errores.status}>
          <Select value={v.status} onChange={(e) => set("status")(e.target.value)}
            options={[{ value: "ACTIVE", label: "Activa" }, { value: "PREPARING", label: "En preparación" }, { value: "INACTIVE", label: "Inactiva" }]} />
        </Field>
        <Field label="Domicilio fiscal" required error={errores.fiscal_address} className="sm:col-span-2">
          <Input value={v.fiscal_address} onChange={(e) => set("fiscal_address")(e.target.value)} maxLength={255} />
        </Field>
        <Field label="Ubigeo del domicilio fiscal" error={errores.fiscal_ubigeo}>
          <UbigeoInput value={v.fiscal_ubigeo} onChange={set("fiscal_ubigeo")} conocido={empresa ? { code: empresa.fiscal_ubigeo, district: empresa.fiscal_district } : undefined} />
        </Field>
        <Field label="Moneda" required error={errores.default_currency}>
          <Select value={v.default_currency} onChange={(e) => set("default_currency")(e.target.value)}
            options={[{ value: "PEN", label: "Soles (PEN)" }, { value: "USD", label: "Dólares (USD)" }]} />
        </Field>
        <Field label="Zona horaria" error={errores.timezone}>
          <Select value={v.timezone} onChange={(e) => set("timezone")(e.target.value)} options={[{ value: "America/Lima", label: "Hora de Lima (UTC−5)" }]} />
        </Field>
      </form>
    </Modal>
  );
}
