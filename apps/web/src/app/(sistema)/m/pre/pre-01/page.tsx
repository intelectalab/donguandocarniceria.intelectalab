"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardList, Layers, PackageOpen, Play, Plus, Trash2, X } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, FiltroFecha, FiltroSelect, Modal, PageHeader, StatusBadge, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, kg, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Avance, Seccion, Vacio, useDatos } from "@/modulos/pre/comunes";
import { OLA, R, TAREA, hoyLima, sumarDias, type OlaResumen } from "@/modulos/pre/tipos";

type PedidoLibre = { id: string; number: string; cliente: string | null; zona: string | null; marca: string | null; unidades: number; kg: number; estado: string; sin_stock: boolean };
type Grupo = { establishment_id: string; local: string; slot_from: string | null; slot_to: string | null; franja: string; pedidos: PedidoLibre[] };
type Planificador = {
  fecha: string; locales: { id: string; code: string; name: string }[]; grupos: Grupo[]; olas: OlaResumen[];
  cifras: { sin_ola: number; olas: number; borradores: number; en_preparacion: number; listos: number };
};
type OlaDetalle = OlaResumen & {
  tareas: { id: string; order_id: string; pedido: string; cliente: string | null; estado: string; estado_pedido: string; ruta: string | null; parada: number | null; preparador: string | null; avance: number }[];
};

const claveGrupo = (g: Grupo) => `${g.establishment_id}|${g.slot_from ?? ""}`;

/** PRE-01 Planificador de olas: pedidos confirmados por fecha, franja y zona; crea la ola y la libera (los pedidos pasan a EN PREPARACIÓN). */
export default function Planificador() {
  const router = useRouter();
  const { can, marca, local: localSup } = useSesion();
  const [dia, setDia] = useState(hoyLima());
  const [local, setLocal] = useState("");
  const [marcados, setMarcados] = useState<Record<string, string[]>>({});
  const [ocupado, setOcupado] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const est = local || (localSup !== "ALL" ? localSup : "");
  const p = new URLSearchParams({ fecha: dia, ...(est ? { establishment_id: est } : {}), ...(marca !== "ALL" ? { brand: marca } : {}) });
  const { datos: d, error, cargando, recargar } = useDatos<Planificador>(`/v1/pre/planificador?${p}`);
  const gestiona = can("pre.wave.manage");

  async function crear(g: Grupo, liberar: boolean) {
    const ids = marcados[claveGrupo(g)] ?? [];
    if (!ids.length) return;
    setOcupado(claveGrupo(g) + liberar);
    try {
      const w = await api<{ number: string }>("/v1/pre/olas", {
        method: "POST",
        body: { order_ids: ids, establishment_id: g.establishment_id, wave_date: dia, slot_from: g.slot_from, slot_to: g.slot_to, liberar },
      });
      toast.ok(liberar ? `Ola ${w.number} liberada: los pedidos pasan a preparación` : `Ola ${w.number} creada en borrador`);
      setMarcados((m) => ({ ...m, [claveGrupo(g)]: [] }));
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  async function accion(w: OlaResumen, que: "liberar" | "cancelar" | "cerrar") {
    let body: { reason?: string } | undefined;
    if (que === "cancelar") {
      const r = await confirmAction({ title: `Cancelar la ola ${w.number}`, message: "Los pedidos vuelven a quedar sin ola.", confirmLabel: "Cancelar ola", danger: true, reason: { label: "Motivo", optional: true } });
      if (!r) return;
      body = { reason: r.reason };
    }
    if (que === "liberar") {
      const r = await confirmAction({ title: `Liberar la ola ${w.number}`, message: `Sus ${w.pedidos} pedidos pasan a EN PREPARACIÓN y se asignan ruta y parada.`, confirmLabel: "Liberar" });
      if (!r) return;
    }
    setOcupado(w.id + que);
    try {
      await api(`/v1/pre/olas/${w.id}/${que}`, { method: "POST", body: body ?? {} });
      toast.ok(que === "liberar" ? "Ola liberada" : que === "cancelar" ? "Ola cancelada" : "Ola cerrada");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  const c = d?.cifras;
  return (
    <div className="space-y-5">
      <PageHeader description="Agrupa los pedidos confirmados del día en olas por local y franja. Al liberar la ola, los pedidos pasan a preparación con su ruta y parada." />

      <div className="flex flex-wrap items-center gap-2">
        <FiltroFecha etiqueta="Fecha de entrega" value={dia} onChange={(v) => setDia(v || hoyLima())} />
        <Button size="sm" variant={dia === hoyLima() ? "primary" : "secondary"} onClick={() => setDia(hoyLima())}>Hoy</Button>
        <Button size="sm" variant={dia === sumarDias(hoyLima(), 1) ? "primary" : "secondary"} onClick={() => setDia(sumarDias(hoyLima(), 1))}>Mañana</Button>
        {(d?.locales.length ?? 0) > 1 && (
          <FiltroSelect etiqueta="Local" value={local} onChange={setLocal} options={(d?.locales ?? []).map((l) => ({ value: l.id, label: l.name }))} ancho={220} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Confirmados sin ola" icono={ClipboardList} destacada valor={c ? numero(c.sin_ola) : undefined} detalle={`Entrega ${fecha(dia)}`} />
        <Cifra titulo="Olas" icono={Layers} valor={c ? numero(c.olas) : undefined} detalle={c ? `${c.borradores} en borrador` : ""} tono={c && c.borradores ? "warn" : undefined} />
        <Cifra titulo="En preparación" icono={PackageOpen} valor={c ? numero(c.en_preparacion) : undefined} detalle="Armando o pesados" />
        <Cifra titulo="Listos" icono={CheckCircle2} valor={c ? numero(c.listos) : undefined} detalle="Verificados o en ruta" tono={c && c.listos ? "ok" : undefined} />
      </div>

      {error && <Alert tone="bad">{error}</Alert>}

      <Seccion titulo="Pedidos confirmados sin ola">
        {cargando && !d ? <Vacio>Cargando…</Vacio> : !d?.grupos.length ? <Vacio>No hay pedidos confirmados sin ola para esta fecha.</Vacio> : (
          <div className="space-y-4">
            {d.grupos.map((g) => {
              const k = claveGrupo(g);
              const sel = marcados[k] ?? [];
              const todos = sel.length === g.pedidos.length;
              const kgSel = g.pedidos.filter((x) => sel.includes(x.id)).reduce((s, x) => s + Number(x.kg), 0);
              return (
                <div key={k} className="overflow-hidden rounded-xl border border-line">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-2 px-4 py-2.5">
                    <div>
                      <p className="text-[13.5px] font-semibold text-ink">{g.local}</p>
                      <p className="text-[12px] text-muted">Franja {g.franja} · {g.pedidos.length} pedido(s)</p>
                    </div>
                    {gestiona && (
                      <Checkbox checked={todos} onChange={(v) => setMarcados((m) => ({ ...m, [k]: v ? g.pedidos.map((x) => x.id) : [] }))} label="Todos" />
                    )}
                  </div>
                  <ul className="divide-y divide-line">
                    {g.pedidos.map((x) => (
                      <li key={x.id} className="flex items-center gap-3 px-4 py-2.5">
                        {gestiona && (
                          <Checkbox checked={sel.includes(x.id)} label={<span className="sr-only">Elegir {x.number}</span>}
                            onChange={(v) => setMarcados((m) => ({ ...m, [k]: v ? [...sel, x.id] : sel.filter((s) => s !== x.id) }))} />
                        )}
                        <button type="button" onClick={() => router.push(`/m/ped/ped-03?id=${x.id}`)} className="min-w-0 flex-1 cursor-pointer text-left">
                          <span className="block text-[13.5px] font-medium text-ink">{x.number} <span className="font-normal text-muted">· {x.cliente}</span></span>
                          <span className="block text-[12px] text-muted">{x.marca} · {x.zona ?? "sin zona"} · {numero(x.unidades)} u · {kg(x.kg)}</span>
                        </button>
                        {x.sin_stock && <Badge tone="warn">Sin stock</Badge>}
                      </li>
                    ))}
                  </ul>
                  {gestiona && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
                      <span className="text-[12.5px] text-muted">{sel.length ? `${sel.length} elegido(s) · ${kg(kgSel)}` : "Elige los pedidos de la ola"}</span>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" icon={Plus} disabled={!sel.length} loading={ocupado === k + "false"} onClick={() => crear(g, false)}>Crear en borrador</Button>
                        <Button size="sm" variant="primary" icon={Play} disabled={!sel.length} loading={ocupado === k + "true"} onClick={() => crear(g, true)}>Crear y liberar</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Seccion>

      <Seccion titulo="Olas del día">
        {!d?.olas.length ? <Vacio>{cargando ? "Cargando…" : "Aún no hay olas para esta fecha."}</Vacio> : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {d.olas.map((w) => (
              <li key={w.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => setAbierta(w.id)} className="min-w-0 cursor-pointer text-left">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold text-ink">{w.number}</span>
                      <StatusBadge status={w.status} labels={OLA} />
                    </span>
                    <span className="block text-[12px] text-muted">{w.local} · {w.almacen ?? "—"} · franja {w.franja} · {w.pedidos} pedido(s) · {w.verificados} verificado(s)</span>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => router.push(`${R.consolidada}?ola=${w.id}`)}>Lista consolidada</Button>
                    {gestiona && w.status === "DRAFT" && <>
                      <Button size="sm" variant="ghost" icon={X} loading={ocupado === w.id + "cancelar"} onClick={() => accion(w, "cancelar")}>Cancelar</Button>
                      <Button size="sm" variant="primary" icon={Play} loading={ocupado === w.id + "liberar"} onClick={() => accion(w, "liberar")}>Liberar</Button>
                    </>}
                    {gestiona && !["DRAFT", "CANCELLED", "CLOSED"].includes(w.status) && (
                      <Button size="sm" loading={ocupado === w.id + "cerrar"} disabled={w.verificados < w.pedidos} onClick={() => accion(w, "cerrar")}
                        title={w.verificados < w.pedidos ? "Se cierra cuando todos los pedidos están verificados" : undefined}>Cerrar</Button>
                    )}
                  </div>
                </div>
                {w.status !== "DRAFT" && w.status !== "CANCELLED" && <Avance valor={w.avance} />}
                {w.cancel_reason && <p className="text-[12px] text-muted">Motivo: {w.cancel_reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      {abierta && <DetalleOla id={abierta} gestiona={gestiona} onClose={() => setAbierta(null)} onCambio={recargar} />}
    </div>
  );
}

function DetalleOla({ id, gestiona, onClose, onCambio }: { id: string; gestiona: boolean; onClose: () => void; onCambio: () => void }) {
  const router = useRouter();
  const { datos: w, error, recargar } = useDatos<OlaDetalle>(`/v1/pre/olas/${id}`);
  const [ocupado, setOcupado] = useState("");

  async function quitar(taskId: string, pedido: string) {
    const r = await confirmAction({ title: `Sacar ${pedido} de la ola`, message: "El pedido vuelve a la lista de confirmados sin ola.", confirmLabel: "Sacar", danger: true });
    if (!r) return;
    setOcupado(taskId);
    try {
      await api(`/v1/pre/olas/${id}/tareas/${taskId}`, { method: "DELETE" });
      toast.ok("Pedido sacado de la ola");
      recargar();
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  return (
    <Modal open onClose={onClose} title={w ? `Ola ${w.number}` : "Ola"} description={w ? `${w.local} · ${fecha(w.wave_date)} · franja ${w.franja}` : undefined} size="lg">
      {error ? <Alert tone="bad">{error}</Alert> : !w ? <Vacio>Cargando…</Vacio> : w.tareas.length === 0 ? <Vacio>La ola no tiene pedidos.</Vacio> : (
        <ul className="divide-y divide-line">
          {w.tareas.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2.5">
              <button type="button" onClick={() => router.push(`${R.ticket}?id=${t.id}`)} className="min-w-0 flex-1 cursor-pointer text-left">
                <span className="block text-[13.5px] font-medium text-ink">{t.pedido} <span className="font-normal text-muted">· {t.cliente}</span></span>
                <span className="block text-[12px] text-muted">{t.ruta ? `Ruta ${t.ruta} · parada ${t.parada ?? "—"}` : "Sin ruta todavía"}{t.preparador ? ` · ${t.preparador}` : ""}</span>
              </button>
              <span className="flex w-24 shrink-0 flex-col items-end gap-1">
                <StatusBadge status={t.estado} labels={TAREA} />
                <Avance valor={t.avance} />
              </span>
              {gestiona && w.status === "DRAFT" && (
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Sacar ${t.pedido}`} loading={ocupado === t.id} onClick={() => quitar(t.id, t.pedido)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
