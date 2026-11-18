"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import { Alert, Badge, Button, Field, IconButton, Input, Modal, Select, StatusBadge, Switch, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio } from "@/modulos/ped/Seccion";
import { DIAS, ESTADOS, hoyLima, sumarDias } from "@/modulos/ped/tipos";

type Celda = { fecha: string; atiende: boolean; ocupados: number };
type Franja = {
  id: string; name: string; local: string; establishment_id: string; zona: string | null; zone_id: string | null; slot_from: string; slot_to: string;
  cutoff: string; capacity: number; weekdays: string[]; status: string; dias: Celda[];
};
type Calendario = { fechas: string[]; franjas: Franja[]; locales: { id: string; name: string }[]; zonas: { id: string; name: string; establishment_id: string }[] };
type PedidoCelda = { id: string; number: string; status: string; estimated_total: string; cliente: string | null; zona: string | null };
type Form = { id?: string; establishment_id: string; zone_id: string; name: string; slot_from: string; slot_to: string; cutoff: string; capacity: string; weekdays: number[]; activa: boolean };

const VACIA: Form = { establishment_id: "", zone_id: "", name: "", slot_from: "09:00", slot_to: "12:00", cutoff: "08:00", capacity: "10", weekdays: [1, 2, 3, 4, 5, 6], activa: true };

/** PED-06 Franjas de entrega: calendario por local y zona con cupo, ocupación y hora de corte. */
export default function Franjas() {
  const router = useRouter();
  const { puede, local: localSup } = useSesion();
  const [local, setLocal] = useState(localSup !== "ALL" ? localSup : "");
  const [desde, setDesde] = useState(hoyLima());
  const [cal, setCal] = useState<Calendario | null>(null);
  const [version, setVersion] = useState(0);
  const [celda, setCelda] = useState<{ f: Franja; dia: string; pedidos: PedidoCelda[] | null } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const admin = puede("PED", "A");

  useEffect(() => {
    let vigente = true;
    const p = new URLSearchParams({ desde, dias: "7" });
    if (local) p.set("establishment_id", local);
    api<Calendario>(`/v1/ped/franjas?${p}`).then((c) => vigente && setCal(c)).catch((e) => toast.error(mensajeDe(e)));
    return () => { vigente = false; };
  }, [local, desde, version]);

  const abrirCelda = useCallback((f: Franja, dia: string) => {
    setCelda({ f, dia, pedidos: null });
    api<PedidoCelda[]>(`/v1/ped/franjas/${f.id}/pedidos?fecha=${dia}`).then((p) => setCelda({ f, dia, pedidos: p })).catch(() => setCelda({ f, dia, pedidos: [] }));
  }, []);

  async function guardar() {
    if (!form) return;
    setGuardando(true);
    setError("");
    try {
      const body = { establishment_id: form.establishment_id, zone_id: form.zone_id || null, name: form.name || null, slot_from: form.slot_from, slot_to: form.slot_to,
        cutoff: form.cutoff, capacity: Number(form.capacity), weekdays: form.weekdays, status: form.activa ? "ACTIVE" : "INACTIVE" };
      await api(form.id ? `/v1/ped/franjas/${form.id}` : "/v1/ped/franjas", { method: form.id ? "PUT" : "POST", body });
      toast.ok("Franja guardada");
      setForm(null);
      setVersion((n) => n + 1);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  const hoy = hoyLima();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full sm:w-[220px]">
            <Select aria-label="Local" value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Todos los locales" options={(cal?.locales ?? []).map((l) => ({ value: l.id, label: l.name }))} />
          </div>
          <div className="flex items-center gap-1">
            <IconButton icon={ChevronLeft} label="Semana anterior" onClick={() => setDesde(sumarDias(desde, -7))} />
            <Input type="date" aria-label="Desde" value={desde} onChange={(e) => e.target.value && setDesde(e.target.value)} className="w-[150px]" />
            <IconButton icon={ChevronRight} label="Semana siguiente" onClick={() => setDesde(sumarDias(desde, 7))} />
            {desde !== hoy && <Button variant="ghost" size="sm" onClick={() => setDesde(hoy)}>Hoy</Button>}
          </div>
        </div>
        {admin && <Button variant="primary" icon={Plus} onClick={() => { setError(""); setForm({ ...VACIA, establishment_id: local }); }}>Nueva franja</Button>}
      </div>

      <Seccion>
        {!cal ? <Vacio>Cargando…</Vacio> : cal.franjas.length === 0 ? <Vacio>No hay franjas para este local.</Vacio> : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[640px] border-separate border-spacing-1 text-[12.5px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-[170px] bg-surface text-left font-medium text-muted">Franja</th>
                  {cal.fechas.map((f) => (
                    <th key={f} className={`font-medium ${f === hoy ? "text-primary" : "text-muted"}`}>{DIAS[new Date(`${f}T12:00:00`).getDay()]} {f.slice(8)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cal.franjas.map((f) => (
                  <tr key={f.id} className={f.status !== "ACTIVE" ? "opacity-50" : ""}>
                    <td className="sticky left-0 z-10 w-[170px] max-w-[170px] bg-surface pr-2 align-top">
                      <div className="flex items-start gap-1">
                        <div className="min-w-0">
                          <div className="font-medium whitespace-nowrap text-ink">{f.slot_from}–{f.slot_to}</div>
                          <div className="text-[11.5px] text-muted">{f.local}{f.zona ? ` · ${f.zona}` : ""} · corte {f.cutoff} · cupo {f.capacity}</div>
                          {f.status !== "ACTIVE" && <Badge>Inactiva</Badge>}
                        </div>
                        {admin && (
                          <IconButton icon={Pencil} label="Editar franja" onClick={() => {
                            setError("");
                            setForm({ id: f.id, establishment_id: f.establishment_id, zone_id: f.zone_id ?? "", name: f.name ?? "", slot_from: f.slot_from, slot_to: f.slot_to,
                              cutoff: f.cutoff, capacity: String(f.capacity), weekdays: f.weekdays.map(Number), activa: f.status === "ACTIVE" });
                          }} />
                        )}
                      </div>
                    </td>
                    {f.dias.map((c) => {
                      const pct = f.capacity ? c.ocupados / f.capacity : 0;
                      const tono = !c.atiende ? "bg-surface-2 text-muted" : pct >= 1 ? "bg-bad-soft text-bad" : pct >= 0.8 ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok";
                      return (
                        <td key={c.fecha} className="p-0">
                          <button type="button" disabled={!c.atiende} onClick={() => abrirCelda(f, c.fecha)}
                            className={`h-12 w-full cursor-pointer rounded-lg text-center font-semibold disabled:cursor-default ${tono}`}>
                            {c.atiende ? `${c.ocupados}/${f.capacity}` : "—"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[12px] text-muted">Verde: con cupo · amarillo: casi llena · rojo: llena. Cuentan los pedidos confirmados en adelante. Pulsa una celda para ver sus pedidos.</p>
      </Seccion>

      <Modal open={Boolean(celda)} onClose={() => setCelda(null)} title={celda ? `${celda.f.slot_from}–${celda.f.slot_to} · ${fecha(celda.dia)}` : ""}
        description={celda ? `${celda.f.local}${celda.f.zona ? ` · ${celda.f.zona}` : ""}` : undefined}>
        {!celda?.pedidos ? <Vacio>Cargando…</Vacio> : celda.pedidos.length === 0 ? <Vacio>Sin pedidos en esta franja.</Vacio> : (
          <ul className="divide-y divide-line">
            {celda.pedidos.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => router.push(`/m/ped/ped-03?id=${p.id}`)} className="flex w-full cursor-pointer items-center justify-between gap-2 py-2.5 text-left hover:bg-surface-2">
                  <span><span className="block text-[13.5px] font-medium text-ink">{p.number} · {p.cliente}</span><span className="text-[12px] text-muted">{p.zona ?? ""}</span></span>
                  <span className="flex items-center gap-2 text-[13px]">{soles(p.estimated_total)} <StatusBadge status={p.status} labels={ESTADOS} /></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? "Editar franja" : "Nueva franja"}
        footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button><Button variant="primary" loading={guardando} onClick={guardar}>Guardar</Button></>}>
        {form && (
          <div className="space-y-4">
            {error && <Alert tone="bad">{error}</Alert>}
            <Field label="Local" required>
              <Select value={form.establishment_id} onChange={(e) => setForm({ ...form, establishment_id: e.target.value, zone_id: "" })} placeholder="Elige"
                options={(cal?.locales ?? []).map((l) => ({ value: l.id, label: l.name }))} />
            </Field>
            <Field label="Zona" hint="Vacío: vale para todas las zonas del local.">
              <Select value={form.zone_id} onChange={(e) => setForm({ ...form, zone_id: e.target.value })} placeholder="Todas las zonas"
                options={(cal?.zonas ?? []).filter((z) => z.establishment_id === form.establishment_id).map((z) => ({ value: z.id, label: z.name }))} />
            </Field>
            <Field label="Nombre" hint="Opcional, por ejemplo «Mañana»."><Input value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Desde" required><Input type="time" value={form.slot_from} onChange={(e) => setForm({ ...form, slot_from: e.target.value })} /></Field>
              <Field label="Hasta" required><Input type="time" value={form.slot_to} onChange={(e) => setForm({ ...form, slot_to: e.target.value })} /></Field>
              <Field label="Corte" required><Input type="time" value={form.cutoff} onChange={(e) => setForm({ ...form, cutoff: e.target.value })} /></Field>
            </div>
            <Field label="Cupo (pedidos)" required><Input type="number" min="1" max="999" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field>
            <Field label="Días que atiende" required>
              <div className="flex flex-wrap gap-1.5">
                {DIAS.map((n, i) => {
                  const on = form.weekdays.includes(i);
                  return (
                    <button key={n} type="button" onClick={() => setForm({ ...form, weekdays: on ? form.weekdays.filter((x) => x !== i) : [...form.weekdays, i].sort() })}
                      className={`cursor-pointer rounded-full border px-3 py-1 text-[12.5px] ${on ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-ink"}`}>{n}</button>
                  );
                })}
              </div>
            </Field>
            <div className="flex items-center gap-2 text-[13.5px] text-ink"><Switch checked={form.activa} onChange={(v) => setForm({ ...form, activa: v })} label="Franja activa" />Franja activa</div>
            <p className="text-[12px] text-muted">La hora de corte es el límite para tomar pedidos de ese mismo día en la franja.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
