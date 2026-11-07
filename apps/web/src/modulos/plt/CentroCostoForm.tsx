"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, DetailList, Field, Input, Modal, Select, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { AREAS_COSTO, etiqueta, type CentroCosto, type Empresa, type Local, type Marca } from "./tipos";

type Valores = {
  company_id: string; code: string; name: string; area: string; parent_id: string;
  establishment_id: string; brand_id: string; status: string;
};

/**
 * Crear o editar un centro de costo (PLT-07). Con «padre», crea un hijo de ese centro. Un hijo
 * toma el área de su padre.
 */
export function CentroCostoForm({ centro, padre, todos, empresas, locales, marcas, limite, onClose, onGuardado }: {
  centro: CentroCosto | null; padre?: CentroCosto; todos: CentroCosto[]; empresas: Empresa[]; locales: Local[]; marcas: Marca[];
  limite: number; onClose: () => void; onGuardado: () => void;
}) {
  const [v, setV] = useState<Valores>(() => ({
    company_id: centro?.company_id ?? padre?.company_id ?? empresas[0]?.id ?? "", code: centro?.code ?? "", name: centro?.name ?? "",
    area: centro?.area ?? padre?.area ?? "SALES", parent_id: centro?.parent_id ?? padre?.id ?? "",
    establishment_id: centro?.establishment_id ?? "", brand_id: centro?.brand_id ?? "", status: centro?.status ?? "ACTIVE",
  }));
  const [hijos, setHijos] = useState<string[] | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = <K extends keyof Valores>(campo: K) => (valor: Valores[K]) => setV((x) => ({ ...x, [campo]: valor }));

  // No puede depender de sí mismo ni de algo que está debajo de él, ni de un centro en el último nivel.
  const debajo = new Set<string>();
  if (centro) {
    const agregar = (id: string) => todos.filter((c) => c.parent_id === id).forEach((c) => { debajo.add(c.id); agregar(c.id); });
    agregar(centro.id);
  }
  const posibles = todos.filter((c) => c.company_id === v.company_id && c.id !== centro?.id && !debajo.has(c.id) && c.nivel < limite);
  const elegido = todos.find((c) => c.id === v.parent_id);

  useEffect(() => {
    if (!centro) return;
    let vigente = true;
    api<CentroCosto>(`/v1/plt/centros-costo/${centro.id}`).then((c) => vigente && setHijos(c.hijos ?? [])).catch(() => vigente && setHijos([]));
    return () => { vigente = false; };
  }, [centro]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const body = { ...v, parent_id: v.parent_id || null, establishment_id: v.establishment_id || null, brand_id: v.brand_id || null };
      await api(centro ? `/v1/plt/centros-costo/${centro.id}` : "/v1/plt/centros-costo", { method: centro ? "PUT" : "POST", body });
      toast.ok(centro ? "Centro de costo actualizado" : "Centro de costo creado");
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
      title={centro ? `${centro.code} · ${centro.name}` : padre ? `Nuevo centro bajo ${padre.code}` : "Nuevo centro de costo"}
      footer={<>
        <Button onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button type="submit" form="f-centro" variant="primary" loading={guardando}>{centro ? "Guardar cambios" : "Crear centro"}</Button>
      </>}>
      <form id="f-centro" onSubmit={guardar} noValidate className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad sm:col-span-2">{error}</p>}
        {empresas.length > 1 && (
          <Field label="Empresa" required error={errores.company_id} className="sm:col-span-2">
            <Select value={v.company_id} onChange={(e) => setV((x) => ({ ...x, company_id: e.target.value, parent_id: "", establishment_id: "", brand_id: "" }))}
              options={empresas.map((c) => ({ value: c.id, label: `${c.legal_name} · ${c.ruc}` }))} />
          </Field>
        )}
        <Field label="Código" required error={errores.code} hint="De 2 a 12 letras, números o guiones. Por ejemplo VEN-WEB.">
          <Input value={v.code} onChange={(e) => set("code")(e.target.value.toUpperCase().replace(/\s/g, ""))} maxLength={12} className="font-mono uppercase" />
        </Field>
        <Field label="Nombre" required error={errores.name}>
          <Input value={v.name} onChange={(e) => set("name")(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Depende de" error={errores.parent_id} hint={`Vacío: es la raíz de su área. El árbol tiene hasta ${limite} niveles.`}>
          <Select value={v.parent_id} placeholder="Ninguno (raíz)"
            onChange={(e) => { const p = todos.find((c) => c.id === e.target.value); setV((x) => ({ ...x, parent_id: e.target.value, area: p?.area ?? x.area })); }}
            options={posibles.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} />
        </Field>
        <Field label="Área" required error={errores.area} hint={elegido ? "La misma de su padre." : undefined}>
          <Select value={v.area} onChange={(e) => set("area")(e.target.value)} options={AREAS_COSTO} disabled={Boolean(elegido)} />
        </Field>
        <Field label="Local" error={errores.establishment_id} hint="Opcional: si el costo es de un local.">
          <Select value={v.establishment_id} onChange={(e) => set("establishment_id")(e.target.value)} placeholder="Ninguno"
            options={locales.filter((l) => l.company_id === v.company_id).map((l) => ({ value: l.id, label: l.short }))} />
        </Field>
        <Field label="Marca" error={errores.brand_id} hint="Opcional: si el costo es de una marca.">
          <Select value={v.brand_id} onChange={(e) => set("brand_id")(e.target.value)} placeholder="Ninguna"
            options={marcas.filter((m) => m.company_id === v.company_id).map((m) => ({ value: m.id, label: m.name }))} />
        </Field>
        <Field label="Estado" required error={errores.status}>
          <Select value={v.status} onChange={(e) => set("status")(e.target.value)}
            options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} />
        </Field>
        {v.status !== "ACTIVE" && (
          <p className="self-end pb-2 text-[12.5px] text-muted">Un centro inactivo no admite gastos ni costos nuevos. Los ya imputados no cambian.</p>
        )}
        {centro && centro.area !== v.area && hijos?.length ? (
          <p className="text-[12.5px] text-warn sm:col-span-2">Sus centros de abajo ({hijos.join(", ")}) también pasan a {etiqueta(AREAS_COSTO, v.area)}.</p>
        ) : null}
      </form>

      {centro && (
        <section className="mt-6 border-t border-line pt-4">
          <h3 className="mb-3 text-[14px] font-semibold">En el árbol</h3>
          <DetailList items={[
            { label: "Nivel", value: `${centro.nivel} de ${limite}` },
            { label: "Centros de abajo", value: hijos === null ? "…" : hijos.join(", ") || "Ninguno" },
            { label: "Gastos imputados", value: numero(centro.gastos_count) },
          ]} />
        </section>
      )}
    </Modal>
  );
}
