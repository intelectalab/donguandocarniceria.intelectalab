"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, DetailList, Field, Input, Modal, Select, Textarea, confirmAction, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { AMBITOS_PARAMETRO, TIPOS_PARAMETRO, formatoParametro, sinCodigos, type CambioParametro, type Local, type Marca, type Parametro } from "./tipos";

type Detalle = Parametro & {
  module_name: string;
  ambitos: { scope: string; scope_id: string; value: string; reason: string; nombre: string | null }[];
  historial: CambioParametro[];
};

/**
 * Ficha de un parámetro (PLT-10): su definición, el valor que rige, los valores por local o marca
 * y su historial. Quien tiene el permiso cambia el valor, con motivo, o quita un valor propio.
 */
export function ParametroEditor({ clave, onClose, onCambio }: { clave: string; onClose: () => void; onCambio: () => void }) {
  const { can } = useSesion();
  const [d, setD] = useState<Detalle | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const puede = can("plt.parameter.edit") || (clave.startsWith("seg_") && can("seg.policy.edit"));

  useEffect(() => {
    let vigente = true;
    api<Detalle>(`/v1/plt/parametros/${clave}`).then((r) => vigente && setD(r)).catch((err) => vigente && setError(mensajeDe(err)));
    return () => { vigente = false; };
  }, [clave, version]);

  const recargar = () => { setVersion((v) => v + 1); onCambio(); };
  const fmt = (v: string | null) => (d ? formatoParametro(v, d.value_type, d.unit, d.options) : "");

  async function quitar(scope: string, scopeId: string | null, nombre: string) {
    const r = await confirmAction({
      title: scope === "TENANT" ? "Volver al valor por defecto" : `Quitar el valor de ${nombre}`,
      message: scope === "TENANT" ? `Rige otra vez el valor por defecto: ${fmt(d?.default_value ?? null)}.` : "Rige otra vez el valor de la empresa.",
      confirmLabel: "Quitar", reason: { label: "Motivo", min: 10 },
    });
    if (!r) return;
    try {
      await api(`/v1/plt/parametros/${clave}/quitar`, { method: "POST", body: { reason: r.reason, scope, scope_id: scopeId } });
      toast.ok("Valor quitado y registrado en el historial");
      recargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    }
  }

  const rango = d && (d.min_value !== null || d.max_value !== null)
    ? `${d.min_value ?? "—"} a ${d.max_value ?? "—"}${d.unit ? ` ${d.unit}` : ""}` : "—";

  return (
    <Modal open onClose={onClose} size="lg" title={clave} footer={<Button onClick={onClose}>Cerrar</Button>}>
      {error ? <p role="alert" className="text-[13.5px] text-bad">{error}</p> : !d ? <p className="text-[13px] text-muted">Cargando…</p> : (<>
        <DetailList items={[
          { label: "Módulo", value: `${d.module_code} · ${d.module_name}` },
          { label: "Descripción", value: sinCodigos(d.description) },
          { label: "Valor que rige", value: <b>{fmt(d.value)}</b> },
          { label: "Sale de", value: d.source === "TENANT" ? "El valor propio de la empresa" : "El valor por defecto" },
          { label: "Por defecto", value: fmt(d.default_value) },
          { label: "Tipo", value: TIPOS_PARAMETRO[d.value_type] },
          { label: "Rango", value: rango },
          { label: "Se puede fijar para", value: d.allowed_scopes.map((s) => AMBITOS_PARAMETRO[s]).join(", ") },
        ]} />

        {puede && <FormCambio key={`${d.value}-${d.historial.length}`} d={d} onGuardado={recargar} />}

        {(d.ambitos.length > 0 || (puede && d.source === "TENANT")) && (
          <section className="mt-6 border-t border-line pt-4">
            <h3 className="mb-1 text-[14px] font-semibold">Valores propios</h3>
            <p className="mb-2 text-[12.5px] text-muted">El de una marca o un local gana al de la empresa, y el de la empresa al valor por defecto.</p>
            <ul className="divide-y divide-line text-[13px]">
              {d.source === "TENANT" && (
                <li className="flex items-center justify-between gap-3 py-2">
                  <span>Empresa: <b>{fmt(d.value)}</b></span>
                  {puede && <Button size="sm" variant="ghost" onClick={() => quitar("TENANT", null, "la empresa")}>Volver al por defecto</Button>}
                </li>
              )}
              {d.ambitos.map((a) => (
                <li key={`${a.scope}-${a.scope_id}`} className="flex items-center justify-between gap-3 py-2">
                  <span>{AMBITOS_PARAMETRO[a.scope]} {a.nombre}: <b>{fmt(a.value)}</b></span>
                  {puede && <Button size="sm" variant="ghost" onClick={() => quitar(a.scope, a.scope_id, a.nombre ?? "")}>Quitar</Button>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-6 border-t border-line pt-4">
          <h3 className="mb-3 text-[14px] font-semibold">Historial</h3>
          {d.historial.length ? (
            <ol className="relative space-y-4 border-l border-line pl-5">
              {d.historial.map((h) => (
                <li key={h.id} className="relative">
                  <span aria-hidden="true" className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-primary" />
                  <p className="text-[13.5px] font-semibold">{fmt(h.old_value)} → {fmt(h.new_value)}</p>
                  <p className="text-[12px] text-muted">
                    {fechaHora(h.changed_at)} · {h.changed_by}{h.scope !== "TENANT" ? ` · ${AMBITOS_PARAMETRO[h.scope]} ${h.ambito_nombre ?? ""}` : ""}
                  </p>
                  <p className="mt-0.5 text-[13px]">{h.reason}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-muted">Sin cambios: rige el valor por defecto.</p>
          )}
        </section>
      </>)}
    </Modal>
  );
}

/** Nuevo valor, ámbito y motivo. El control depende del tipo del parámetro. */
function FormCambio({ d, onGuardado }: { d: Detalle; onGuardado: () => void }) {
  const inicial = d.value_type === "JSON" && d.value ? JSON.stringify(JSON.parse(d.value)) : d.value ?? "";
  const [valor, setValor] = useState(inicial);
  const [ambito, setAmbito] = useState("TENANT");
  const [ambitoId, setAmbitoId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const varios = d.allowed_scopes.length > 1;
  const locales = useListado<Local>("/v1/plt/locales", { porPagina: 100 }).filas;
  const marcas = useListado<Marca>("/v1/plt/marcas", { porPagina: 100, orden: "sort_order" }).filas;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    setErrores({});
    try {
      await api(`/v1/plt/parametros/${d.key}`, {
        method: "PUT", body: { value: valor, reason: motivo, scope: ambito, scope_id: ambito === "TENANT" ? null : ambitoId || null },
      });
      toast.ok("Parámetro actualizado y registrado en el historial");
      setMotivo("");
      onGuardado();
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  const etiqueta = `Nuevo valor${d.unit && !["BOOL", "LIST"].includes(d.value_type) ? ` (${d.unit})` : ""}`;
  return (
    <form onSubmit={guardar} noValidate className="mt-6 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
      <h3 className="text-[14px] font-semibold sm:col-span-2">Cambiar el valor</h3>
      {error && <p role="alert" className="rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad sm:col-span-2">{error}</p>}
      <Field label={etiqueta} required error={errores.value} className={d.value_type === "JSON" || d.value_type === "TEXT" ? "sm:col-span-2" : ""}
        hint={d.value_type === "JSON" ? "Por ejemplo [1, 5, 15]." : d.min_value !== null || d.max_value !== null ? `Entre ${d.min_value ?? "—"} y ${d.max_value ?? "—"}.` : undefined}>
        {d.value_type === "BOOL" ? (
          <Select value={valor} onChange={(e) => setValor(e.target.value)} options={[{ value: "true", label: "Sí" }, { value: "false", label: "No" }]} />
        ) : d.value_type === "LIST" ? (
          <Select value={valor} onChange={(e) => setValor(e.target.value)} options={(d.options ?? []).map(([v, l]) => ({ value: v, label: l }))} />
        ) : d.value_type === "JSON" ? (
          <Textarea value={valor} onChange={(e) => setValor(e.target.value)} rows={2} className="font-mono" />
        ) : d.value_type === "TIME" ? (
          <Input type="time" value={valor} onChange={(e) => setValor(e.target.value)} />
        ) : d.value_type === "TEXT" ? (
          <Input value={valor} onChange={(e) => setValor(e.target.value)} maxLength={500} />
        ) : (
          <Input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} className="tabular-nums" />
        )}
      </Field>
      {varios && (
        <Field label="Para" required hint="Un valor por local o marca gana al de la empresa.">
          <Select value={ambito} onChange={(e) => { setAmbito(e.target.value); setAmbitoId(""); }}
            options={d.allowed_scopes.map((s) => ({ value: s, label: s === "TENANT" ? "Toda la empresa" : s === "BRAND" ? "Una marca" : "Un local" }))} />
        </Field>
      )}
      {ambito !== "TENANT" && (
        <Field label={ambito === "BRAND" ? "Marca" : "Local"} required>
          <Select value={ambitoId} onChange={(e) => setAmbitoId(e.target.value)} placeholder={ambito === "BRAND" ? "Elige la marca" : "Elige el local"}
            options={ambito === "BRAND" ? marcas.map((m) => ({ value: m.id, label: m.name })) : locales.map((l) => ({ value: l.id, label: l.short }))} />
        </Field>
      )}
      <Field label="Motivo" required error={errores.reason} className="sm:col-span-2" hint="Queda en el historial. Lo ya calculado no se recalcula.">
        <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={255} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" loading={guardando}>Guardar cambio</Button>
      </div>
    </form>
  );
}
