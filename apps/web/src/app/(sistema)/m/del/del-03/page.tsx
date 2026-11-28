"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, MessageCircle, Printer, Save, Shuffle, Trash2, Truck, Undo2 } from "lucide-react";
import { Alert, Badge, Button, Field, FiltroFecha, MapView, Modal, PageHeader, Select, StatusBadge, confirmAction, toast } from "@/components/ui";
import { ApiError, api, mensajeDe } from "@/lib/api";
import { fechaHora, kg, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Escaner, sonar } from "@/modulos/pre/Escaner";
import { Avance, Seccion, TarjetaRuta, Vacio, hoyLima, useDatos } from "@/modulos/del/comunes";
import { PARADA, PEDIDO, R, hora, type Hoja, type Parada, type RutaResumen } from "@/modulos/del/tipos";

/** DEL-03 Hoja de ruta: paradas en orden (editable), bolsas, cobro y teléfono enmascarado; carga por escaneo, salida y vuelta. */
export default function HojaDeRuta() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id");
  return id ? <Detalle id={id} /> : <Lista />;
}

function Lista() {
  const router = useRouter();
  const [dia, setDia] = useState(hoyLima());
  const { datos, error, cargando } = useDatos<{ data: RutaResumen[] }>(`/v1/del/rutas?fecha=${dia}`);
  return (
    <div className="space-y-5">
      <PageHeader description="Elige la ruta para ver sus paradas en orden, cargar sus bolsas por escaneo y marcar la salida." />
      <FiltroFecha etiqueta="Fecha" value={dia} onChange={(v) => setDia(v || hoyLima())} />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.data.length ? <Vacio>No hay rutas para esta fecha.</Vacio> : (
        <div className="grid gap-3 md:grid-cols-2">{datos.data.map((r) => <TarjetaRuta key={r.id} r={r} onClick={() => router.push(`${R.hoja}?id=${r.id}`)} />)}</div>
      )}
    </div>
  );
}

function Detalle({ id }: { id: string }) {
  const router = useRouter();
  const { can } = useSesion();
  const { datos: h, error, cargando, recargar, poner } = useDatos<Hoja>(`/v1/del/rutas/${id}`);
  const [orden, setOrden] = useState<string[] | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mover, setMover] = useState<Parada | null>(null);
  const planifica = can("del.route.plan");

  if (cargando) return <Vacio>Cargando…</Vacio>;
  if (error || !h) return <Alert tone="bad">{error || "No se encontró la ruta."}</Alert>;
  const r = h.ruta;
  const editable = ["PLANNED", "LOADING"].includes(r.status);
  const abiertas = h.paradas.filter((p) => ["PENDING", "ARRIVED"].includes(p.status));
  const cerradas = h.paradas.filter((p) => !["PENDING", "ARRIVED"].includes(p.status));
  const enOrden = orden ? orden.map((x) => abiertas.find((p) => p.id === x)!).filter(Boolean) : abiertas;

  async function accion(url: string, body: object, ok: string) {
    setOcupado(true);
    try {
      const x = await api<Hoja>(url, { method: "POST", body });
      poner(x);
      toast.ok(ok);
    } catch (e) { toast.error(mensajeDe(e)); } finally { setOcupado(false); }
  }

  async function cargar(code: string) {
    setOcupado(true);
    try {
      const x = await api<Hoja & { ok: boolean; message: string }>(`/v1/del/rutas/${id}/cargar`, { method: "POST", body: { code } });
      poner(x);
      sonar(x.ok);
      setAviso({ ok: x.ok, texto: x.message });
    } catch (e) {
      sonar(false);
      setAviso({ ok: false, texto: mensajeDe(e) });
    } finally { setOcupado(false); }
  }

  function subir(i: number, d: -1 | 1) {
    const ids = enOrden.map((p) => p.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrden(ids);
  }

  async function avisar(p: Parada) {
    try {
      const x = await api<{ url: string }>(`/v1/del/paradas/${p.id}/aviso`, { method: "POST", body: { origin: window.location.origin } });
      window.open(x.url, "_blank", "noopener");
    } catch (e) { toast.error(mensajeDe(e)); }
  }

  async function odometro(titulo: string, actual: number | null) {
    if (r.mode === "THIRD_PARTY") return { ok: true, valor: null as number | null };
    const c = await confirmAction({ title: titulo, message: `Odómetro del vehículo${actual !== null ? ` (último: ${actual} km)` : ""}. Déjalo vacío para usar el último.`, confirmLabel: "Confirmar", reason: { label: "Odómetro (km)", optional: true } });
    if (!c) return { ok: false, valor: null };
    const n = c.reason?.trim() ? Number(c.reason.replace(",", ".")) : null;
    if (n !== null && !Number.isFinite(n)) { toast.error("Escribe el odómetro en números."); return { ok: false, valor: null }; }
    return { ok: true, valor: n };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push(R.hoja)}>Rutas</Button>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={Printer} onClick={() => window.print()}>Imprimir</Button>
          {["IN_ROUTE", "RETURNED", "SETTLED"].includes(r.status) && <Button size="sm" onClick={() => router.push(`${R.mapa}?fecha=${r.route_date}`)}>Ver en el mapa</Button>}
          {r.status === "RETURNED" && r.mode !== "THIRD_PARTY" && <Button size="sm" variant="primary" onClick={() => router.push(`${R.liquidacion}?ruta=${r.id}`)}>Liquidar</Button>}
        </div>
      </div>

      <Seccion>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-[17px] font-bold text-ink"><Truck size={20} className="text-primary" />{r.code}</p>
            <p className="text-[12.5px] text-muted">{r.local_nombre} · {r.route_date.split("-").reverse().join("/")} · {r.franja ?? "sin franja"}</p>
            <p className="mt-1 text-[13px] text-ink">{r.mode === "THIRD_PARTY" ? (r.empresa ?? "Sin empresa") : `${r.plate ?? "Sin vehículo"} · ${r.repartidor ?? "sin repartidor"}`}</p>
          </div>
          <StatusBadge status={r.status} labels={{ PLANNED: ["Planificada", "neutral"], LOADING: ["Cargando", "info"], IN_ROUTE: ["En ruta", "primary"], RETURNED: ["De vuelta", "warn"], SETTLED: ["Liquidada", "ok"], CANCELLED: ["Cancelada", "bad"] }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
          <span><b>{r.paradas}</b> paradas</span><span><b>{kg(r.kg)}</b></span><span>{r.planned_km.toFixed(1)} km</span><span>Cobrar <b>{soles(r.cobrar)}</b></span>
        </div>
        {r.avisos.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{r.avisos.map((a) => <Badge key={a.msg} tone={a.level === "bad" ? "bad" : "warn"}>{a.msg}</Badge>)}</div>}
      </Seccion>

      {editable && (
        <Seccion titulo={`Carga del vehículo · ${r.cargadas} de ${r.bolsas} bolsas`}>
          <Avance valor={r.bolsas ? (r.cargadas / r.bolsas) * 100 : 0} />
          {(can("del.route.drive") || planifica) && r.bolsas > r.cargadas && (
            <div className="mt-3"><Escaner onLeer={cargar} ocupado={ocupado} placeholder="Escanea la bolsa (de la última parada a la primera)" /></div>
          )}
          {aviso && <div className={`mt-3 rounded-lg px-3 py-2 text-[13.5px] ${aviso.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`} role="status">{aviso.texto}</div>}
          {!h.puede_salir.ok && h.puede_salir.faltas.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-[13px] text-muted">{h.puede_salir.faltas.map((f) => <li key={f}>{f}</li>)}</ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {planifica && <Button size="sm" variant="secondary" onClick={() => router.push(R.asignacion)}>Asignación</Button>}
            <Button variant="primary" disabled={!h.puede_salir.ok || ocupado} onClick={async () => {
              const o = await odometro(`Salida de ${r.code}`, r.odometro_vehiculo);
              if (o.ok) await accion(`/v1/del/rutas/${id}/salir`, { odometer: o.valor }, "La ruta salió: los clientes reciben el aviso «va en camino».");
            }}>Marcar EN RUTA</Button>
          </div>
        </Seccion>
      )}
      {r.status === "IN_ROUTE" && (can("del.route.drive") || planifica) && h.paradas.every((p) => !["PENDING", "ARRIVED"].includes(p.status)) && (
        <Alert tone="info" title="Todas las paradas están cerradas">
          <Button className="mt-2" variant="primary" icon={Undo2} onClick={async () => {
            const o = await odometro(`Vuelta de ${r.code}`, r.odometer_start);
            if (o.ok) await accion(`/v1/del/rutas/${id}/volver`, { odometer: o.valor }, "La ruta volvió al local.");
          }}>Marcar vuelta al local</Button>
        </Alert>
      )}

      <Seccion titulo="Paradas" acciones={editable && planifica && (
        <>
          <Button size="sm" icon={Shuffle} onClick={() => accion(`/v1/del/rutas/${id}/ordenar`, {}, "Orden sugerido recalculado.")}>Orden sugerido</Button>
          {orden && <Button size="sm" variant="primary" icon={Save} onClick={async () => { await accion(`/v1/del/rutas/${id}/ordenar`, { stop_ids: orden }, "Orden guardado."); setOrden(null); }}>Guardar orden</Button>}
        </>
      )}>
        {!h.paradas.length ? <Vacio>La ruta no tiene paradas. Agrégalas desde el Planificador.</Vacio> : (
          <ol className="divide-y divide-line">
            {[...cerradas, ...enOrden].map((p) => {
              const i = enOrden.findIndex((x) => x.id === p.id);
              return (
                <li key={p.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] font-bold text-ink">{i >= 0 && orden ? i + 1 + cerradas.length : p.seq}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-semibold text-ink">{p.pedido}</span>
                        <StatusBadge status={p.status} labels={PARADA} />
                        {editable && !["READY", "NOT_DELIVERED"].includes(p.order_status) && <StatusBadge status={p.order_status} labels={PEDIDO} />}
                      </div>
                      <p className="text-[13px] text-ink">{p.cliente}</p>
                      <p className="text-[12.5px] text-muted">{p.direccion}{p.distrito ? `, ${p.distrito}` : ""}{p.referencia ? ` · ${p.referencia}` : ""}</p>
                      <p className="text-[12.5px] text-muted">
                        {p.franja ?? "sin franja"} · llega ~{hora(p.eta)} · {p.bolsas.length} bolsa(s) · {kg(p.kg)} · tel. {p.telefono}
                        {p.pendiente > 0 ? <> · <b className="text-ink">cobrar {soles(p.pendiente)}</b></> : p.cobrar > 0 ? ` · cobrado ${soles(p.cobrado)}` : ""}
                      </p>
                      {p.bolsas.length > 0 && editable && (
                        <p className="mt-1 flex flex-wrap gap-1">{p.bolsas.map((b) => <Badge key={b.label} tone={["LOADED", "DELIVERED"].includes(b.status) ? "ok" : "neutral"}>{b.label}</Badge>)}</p>
                      )}
                      {p.motivo && <p className="text-[12.5px] text-bad">{p.motivo}</p>}
                      {p.pod_distance_m !== null && <p className="text-[12px] text-muted">Prueba a {Math.round(p.pod_distance_m)} m del pin · {fechaHora(p.closed_at)}</p>}
                      {planifica && p.codigo && ["PENDING", "ARRIVED"].includes(p.status) && <p className="text-[12px] text-muted">Código de entrega: <b className="font-mono text-ink">{p.codigo}</b></p>}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 pl-11 print:hidden">
                    {editable && planifica && i >= 0 && (
                      <>
                        <Button size="sm" variant="ghost" icon={ArrowUp} aria-label="Subir" disabled={i === 0} onClick={() => subir(i, -1)} />
                        <Button size="sm" variant="ghost" icon={ArrowDown} aria-label="Bajar" disabled={i === enOrden.length - 1} onClick={() => subir(i, 1)} />
                        <Button size="sm" variant="ghost" onClick={() => setMover(p)}>Mover</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={async () => {
                          const c = await confirmAction({ title: `Quitar ${p.pedido} de la ruta`, danger: true, confirmLabel: "Quitar", reason: { label: "Motivo", optional: true } });
                          if (c) await accion(`/v1/del/paradas/${p.id}/quitar`, { reason: c.reason || null }, "Parada quitada.");
                        }}>Quitar</Button>
                      </>
                    )}
                    {r.status === "IN_ROUTE" && ["PENDING", "ARRIVED"].includes(p.status) && (can("del.route.plan") || can("del.tracking.view")) && (
                      <Button size="sm" icon={MessageCircle} onClick={() => void avisar(p)}>Aviso «va en camino»</Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Seccion>

      {h.paradas.length > 0 && (
        <Seccion titulo="Mapa de la ruta">
          <MapView height={260} points={[{ id: "local", lat: h.local[0], lng: h.local[1], label: "Local" }, ...h.paradas.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: String(p.seq), title: `${p.pedido} · ${p.cliente ?? ""}`, muted: !["PENDING", "ARRIVED"].includes(p.status) }))]} />
        </Seccion>
      )}

      {h.eventos.length > 0 && (
        <Seccion titulo="Bitácora de la ruta">
          <ul className="space-y-1 text-[12.5px]">
            {h.eventos.map((e) => <li key={e.id} className="text-muted"><span className="text-ink">{fechaHora(e.occurred_at)}</span> · {e.event_type}{e.notes ? ` · ${e.notes}` : ""}{e.usuario ? ` · ${e.usuario}` : ""}</li>)}
          </ul>
        </Seccion>
      )}

      {mover && <Mover p={mover} ruta={r} onClose={() => setMover(null)} onListo={() => { setMover(null); recargar(); }} />}
    </div>
  );
}

function Mover({ p, ruta, onClose, onListo }: { p: Parada; ruta: Hoja["ruta"]; onClose: () => void; onListo: () => void }) {
  const { datos } = useDatos<{ data: RutaResumen[] }>(`/v1/del/rutas?fecha=${ruta.route_date}&establishment_id=${ruta.establishment_id}`);
  const [destino, setDestino] = useState("");
  const otras = (datos?.data ?? []).filter((x) => x.id !== ruta.id && ["PLANNED", "LOADING"].includes(x.status));
  return (
    <Modal open onClose={onClose} title={`Mover ${p.pedido}`} size="sm" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={!destino} onClick={async () => {
          try { await api(`/v1/del/paradas/${p.id}/mover`, { method: "POST", body: { route_id: destino } }); toast.ok("Parada movida."); onListo(); }
          catch (e) { toast.error(e instanceof ApiError ? e.message : mensajeDe(e)); }
        }}>Mover</Button>
      </>
    }>
      {!otras.length ? <Vacio>No hay otra ruta del día que aún no salga.</Vacio> : (
        <Field label="Ruta de destino">
          <Select value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Elige la ruta" options={otras.map((x) => ({ value: x.id, label: `${x.code} · ${x.paradas} parada(s)` }))} />
        </Field>
      )}
    </Modal>
  );
}
