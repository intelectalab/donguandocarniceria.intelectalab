"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, Field, Input, PageHeader, Select, Switch, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { TelefoniaApagada, useTelefonia } from "@/modulos/tel/comun";

type Opcion = { value: string; label: string };
type OpcionMenu = { digit: number; tipo: "MARCA" | "SUPERVISORA"; brand_id: string | null; direct_user_id: string | null; etiqueta?: string; grupo?: string | null };
type Menu = {
  id: string | null; name: string; greeting_text: string; after_hours_action: string; status: string; horario: { lun_sab: [string, string]; dom: [string, string] | null };
  opciones: OpcionMenu[]; numeros: string[]; grabacion: boolean;
  listas: { marcas: Opcion[]; sin_grupo: string[]; supervisoras: Opcion[]; fuera_de_horario: Opcion[] }; puede: boolean;
};

const DIGITOS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ value: String(n), label: String(n) }));

/**
 * TEL-04 Menú de voz y horario: el saludo (con el aviso de grabación), una opción por marca y la supervisora, el horario
 * de atención y qué pasa fuera de horario.
 */
export default function MenuDeVoz() {
  const encendida = useTelefonia();
  const [m, setM] = useState<Menu | null>(null);
  const [d, setD] = useState<Menu | null>(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(() => {
    if (!encendida) return;
    api<Menu>("/v1/tel/menu").then((r) => { setM(r); setD(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [encendida]);
  useEffect(() => cargar(), [cargar]);

  if (!encendida) return <div className="grid gap-5"><PageHeader description="Saludo, opciones por marca y horario de la central." /><TelefoniaApagada /></div>;
  if (!m || !d) return error ? <Alert tone="bad">{error}</Alert> : <p className="text-[13px] text-muted">Cargando…</p>;
  const dis = !m.puede;
  const op = (i: number, x: Partial<OpcionMenu>) => setD({ ...d, opciones: d.opciones.map((o, j) => (j === i ? { ...o, ...x } : o)) });
  async function guardar() {
    if (!d) return;
    setEnviando(true);
    try {
      const r = await api<Menu>("/v1/tel/menu", { method: "PUT", body: { name: d.name, greeting_text: d.greeting_text, after_hours_action: d.after_hours_action, horario: d.horario,
        opciones: d.opciones.map((o) => ({ digit: o.digit, tipo: o.tipo, brand_id: o.tipo === "MARCA" ? o.brand_id : null, direct_user_id: o.tipo === "SUPERVISORA" ? o.direct_user_id : null })) } });
      setM(r);
      setD(r);
      toast.ok("Menú guardado");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  const libres = DIGITOS.filter((x) => !d.opciones.some((o) => String(o.digit) === x.value));
  return (
    <div className="grid gap-5">
      <PageHeader description="Lo que escucha el cliente al llamar a la central: el saludo con el aviso de grabación, una opción por marca y la supervisora. Fuera del horario de atención, la llamada deja una tarea de devolverla, va al buzón o se desvía a la supervisora."
        actions={m.puede ? <Button variant="primary" loading={enviando} onClick={guardar}>Guardar menú</Button> : undefined} />
      {!m.puede && <Alert tone="warn">El menú lo cambia el administrador del sistema.</Alert>}
      {m.listas.sin_grupo.length > 0 && <Alert tone="info">Sin grupo de llamada todavía: {m.listas.sin_grupo.join(", ")}. Para ofrecerlas en el menú, créales su grupo en Grupos de llamada.</Alert>}
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <section className="grid content-start gap-4 rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre" required><Input disabled={dis} maxLength={120} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
            <Field label="Fuera de horario" required><Select disabled={dis} value={d.after_hours_action} onChange={(e) => setD({ ...d, after_hours_action: e.target.value })} options={m.listas.fuera_de_horario} /></Field>
            <Field label="Saludo" required className="sm:col-span-2" hint={m.grabacion ? "Con grabación, el saludo incluye el aviso: «Esta llamada puede ser grabada para fines de calidad»." : undefined}>
              <Textarea rows={4} maxLength={1000} disabled={dis} value={d.greeting_text} onChange={(e) => setD({ ...d, greeting_text: e.target.value })} />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[14px] font-semibold text-ink">Opciones</h2>
            {m.puede && libres.length > 0 && <Button size="sm" icon={Plus} onClick={() => setD({ ...d, opciones: [...d.opciones, { digit: Number(libres[0].value), tipo: "MARCA", brand_id: null, direct_user_id: null }] })}>Agregar opción</Button>}
          </div>
          <div className="grid gap-2">
            {d.opciones.map((o, i) => (
              <div key={i} className="grid items-end gap-2 rounded-lg border border-line p-2 sm:grid-cols-[90px_160px_1fr_auto]">
                <Field label="Dígito"><Select disabled={dis} value={String(o.digit)} onChange={(e) => op(i, { digit: Number(e.target.value) })} options={DIGITOS.filter((x) => x.value === String(o.digit) || libres.includes(x))} /></Field>
                <Field label="Lleva a"><Select disabled={dis} value={o.tipo} onChange={(e) => op(i, { tipo: e.target.value as OpcionMenu["tipo"] })} options={[{ value: "MARCA", label: "Una marca" }, { value: "SUPERVISORA", label: "La supervisora" }]} /></Field>
                {o.tipo === "MARCA"
                  ? <Field label="Marca (suena su grupo)"><Select disabled={dis} value={o.brand_id ?? ""} onChange={(e) => op(i, { brand_id: e.target.value })} placeholder="Elige la marca" options={m.listas.marcas} /></Field>
                  : <Field label="Supervisora"><Select disabled={dis} value={o.direct_user_id ?? ""} onChange={(e) => op(i, { direct_user_id: e.target.value })} placeholder="Elige" options={m.listas.supervisoras} /></Field>}
                {m.puede ? <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Quitar la opción ${o.digit}`} title="Quitar" onClick={() => setD({ ...d, opciones: d.opciones.filter((_, j) => j !== i) })} /> : <span />}
              </div>
            ))}
          </div>
          <h2 className="mt-2 text-[14px] font-semibold text-ink">Horario de atención</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Lunes a sábado, desde" required><Input type="time" disabled={dis} value={d.horario.lun_sab[0]} onChange={(e) => setD({ ...d, horario: { ...d.horario, lun_sab: [e.target.value, d.horario.lun_sab[1]] } })} /></Field>
              <Field label="hasta" required><Input type="time" disabled={dis} value={d.horario.lun_sab[1]} onChange={(e) => setD({ ...d, horario: { ...d.horario, lun_sab: [d.horario.lun_sab[0], e.target.value] } })} /></Field>
            </div>
            <div className="grid gap-2">
              <Switch checked={d.horario.dom !== null} disabled={dis} label={d.horario.dom ? "Se atiende el domingo" : "Domingo cerrado"} onChange={(v) => setD({ ...d, horario: { ...d.horario, dom: v ? ["09:00", "14:00"] : null } })} />
              {d.horario.dom && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Domingo, desde"><Input type="time" disabled={dis} value={d.horario.dom[0]} onChange={(e) => setD({ ...d, horario: { ...d.horario, dom: [e.target.value, d.horario.dom![1]] } })} /></Field>
                  <Field label="hasta"><Input type="time" disabled={dis} value={d.horario.dom[1]} onChange={(e) => setD({ ...d, horario: { ...d.horario, dom: [d.horario.dom![0], e.target.value] } })} /></Field>
                </div>
              )}
            </div>
          </div>
          <p className="text-[12px] text-muted">Los feriados la central está cerrada.</p>
        </section>
        <div className="grid content-start gap-4">
          <section className="grid gap-2 rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="text-[14px] font-semibold text-ink">Así lo escucha el cliente</h2>
            <p className="rounded-lg bg-surface-2 p-3 text-[12.5px] italic">«{m.greeting_text}»</p>
            <ul className="grid gap-1 text-[12.5px]">
              {m.opciones.map((o) => <li key={o.digit}><b className="tabular-nums">{o.digit}</b> → {o.etiqueta}{o.grupo ? <span className="text-muted"> · {o.grupo}</span> : null}</li>)}
            </ul>
          </section>
          <section className="grid gap-1 rounded-xl border border-line bg-surface p-4 text-[12.5px] shadow-card">
            <h2 className="text-[14px] font-semibold text-ink">Horario</h2>
            <p>Lunes a sábado: <b>{m.horario.lun_sab.join(" a ")}</b></p>
            <p>Domingo: <b>{m.horario.dom ? m.horario.dom.join(" a ") : "cerrado"}</b></p>
            <p>Feriados: <b>cerrado</b></p>
            <p>Fuera de horario: <b>{m.listas.fuera_de_horario.find((x) => x.value === m.after_hours_action)?.label}</b></p>
            {m.numeros.length > 0 && <p className="mt-1 text-muted">Lo usan: {m.numeros.join(", ")}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
