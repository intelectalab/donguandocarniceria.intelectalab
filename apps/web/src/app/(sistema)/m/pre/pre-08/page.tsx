"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertOctagon, ArrowLeft, CheckCircle2, Truck } from "lucide-react";
import { Alert, Badge, Button, FiltroFecha, PageHeader, StatusBadge } from "@/components/ui";
import { ApiError, api, mensajeDe } from "@/lib/api";
import { useSesion } from "@/lib/sesion";
import { Avance, Seccion, Vacio, useDatos } from "@/modulos/pre/comunes";
import { Escaner, sonar } from "@/modulos/pre/Escaner";
import { R, RESULTADOS, TAREA, hoyLima, nombreBolsa } from "@/modulos/pre/tipos";

type Ruta = { route_key: string; ruta: string; total: number; cargadas: number; pedidos: number; sin_bolsas: number };
type BolsaCarga = {
  id: string; label_code: string; parcel_no: number; parcel_count: number; parcel_type: string; route_code: string | null; stop_seq: number | null;
  status: string; loaded_at: string | null; number: string; task_status: string; task_id: string; leyenda: string; cliente: string | null;
};
type Carga = { route_key: string; ruta: string; bolsas: BolsaCarga[]; total: number; cargadas: number; sin_bolsas: { task_id: string; pedido: string; parada: number | null; estado: string }[] };
type Lectura = { result: string; ok: boolean; message: string; resultado?: string; carga: Carga };

/** PRE-08 Carga del vehículo: escaneo de cada bolsa al subirla; ruta correcta y orden inverso de paradas; avance de la carga por ruta. */
export default function CargaVehiculo() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const ruta = useSearchParams().get("ruta") ?? "";
  return ruta ? <CargarRuta clave={ruta} /> : <Rutas />;
}

function Rutas() {
  const router = useRouter();
  const [dia, setDia] = useState(hoyLima());
  const { datos, error, cargando } = useDatos<Ruta[]>(`/v1/pre/rutas?fecha=${dia}`);
  return (
    <div className="space-y-5">
      <PageHeader description="Elige la ruta del vehículo y escanea cada bolsa al subirla: primero las de la última parada, para que la primera quede a la mano." />
      <FiltroFecha etiqueta="Fecha de entrega" value={dia} onChange={(v) => setDia(v || hoyLima())} />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.length ? <Vacio>No hay pedidos con ruta para esta fecha.</Vacio> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {datos.map((r) => (
            <li key={r.route_key}>
              <button type="button" onClick={() => router.push(`${R.carga}?ruta=${encodeURIComponent(r.route_key)}`)}
                className="w-full cursor-pointer rounded-xl border border-line bg-surface p-4 text-left shadow-card hover:border-primary">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-semibold text-ink">{r.ruta}</span>
                  {r.total > 0 && r.cargadas === r.total && !r.sin_bolsas ? <Badge tone="ok">Cargada</Badge> : <Badge>{r.cargadas} de {r.total}</Badge>}
                </span>
                <span className="mt-1 block text-[12.5px] text-muted">{r.pedidos} pedido(s) · {r.total} bolsa(s){r.sin_bolsas ? ` · ${r.sin_bolsas} sin bolsas aún` : ""}</span>
                <span className="mt-2 block"><Avance valor={r.total ? (r.cargadas / r.total) * 100 : 0} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CargarRuta({ clave }: { clave: string }) {
  const router = useRouter();
  const { can } = useSesion();
  const { datos, error, cargando, poner } = useDatos<Carga>(`/v1/pre/carga?route_key=${encodeURIComponent(clave)}`);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; titulo: string; texto: string; codigo: string } | null>(null);

  async function leer(codigo: string) {
    setOcupado(true);
    try {
      const r = await api<Lectura>("/v1/pre/carga/escanear", { method: "POST", body: { route_key: clave, code: codigo, device: "WEB" } });
      poner(r.carga);
      sonar(r.ok);
      setAviso({ ok: r.ok, titulo: r.ok ? "Cargada" : (r.resultado ?? RESULTADOS[r.result]?.[0] ?? "Bloqueada"), texto: r.message, codigo });
    } catch (e) {
      sonar(false);
      setAviso({ ok: false, titulo: e instanceof ApiError && e.status === 422 ? "Bloqueada" : "Error", texto: mensajeDe(e), codigo });
    } finally {
      setOcupado(false);
    }
  }

  if (cargando) return <Vacio>Cargando…</Vacio>;
  if (error || !datos) return <Alert tone="bad">{error || "No se encontró la ruta."}</Alert>;
  const siguiente = datos.bolsas.find((b) => b.status !== "LOADED");
  const completa = datos.total > 0 && datos.cargadas === datos.total && datos.sin_bolsas.length === 0;
  // Un pedido de una parada posterior sin bolsas va antes que la siguiente bolsa (RN-PRE-08).
  const antes = siguiente ? datos.sin_bolsas.find((x) => (x.parada ?? 0) > (siguiente.stop_seq ?? 0)) : undefined;

  return (
    <div className="mx-auto max-w-[720px] space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push(R.carga)}>Otra ruta</Button>
      <Seccion>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><Truck size={20} className="text-primary" /><span className="text-[16px] font-bold text-ink">{datos.ruta}</span></div>
          <span className="text-[14px] font-semibold text-ink">{datos.cargadas} de {datos.total} bolsas</span>
        </div>
        <div className="mt-2"><Avance valor={datos.total ? (datos.cargadas / datos.total) * 100 : 0} /></div>
        {antes ? (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[13.5px] text-ink">
            Espera: <b>{antes.pedido}</b> (parada {antes.parada ?? "—"}) aún no tiene bolsas y se carga antes.
          </p>
        ) : !siguiente && datos.sin_bolsas.length > 0 ? (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[13.5px] text-ink">
            Faltan {datos.sin_bolsas.length} pedido(s) sin bolsas para completar la ruta.
          </p>
        ) : siguiente && (
          <p className="mt-3 rounded-lg bg-primary-soft px-3 py-2 text-[13.5px] text-ink">
            Sigue: <b>{siguiente.number}</b> · bolsa {siguiente.parcel_no} de {siguiente.parcel_count} · parada {siguiente.stop_seq ?? "—"}
            {!["VERIFIED", "LOADED"].includes(siguiente.task_status) && <span className="text-bad"> (aún no verificado)</span>}
          </p>
        )}
      </Seccion>

      {completa ? (
        <Alert tone="ok" title="Ruta cargada">Todas las bolsas de la ruta están en el vehículo.</Alert>
      ) : can("pre.load.scan") ? (
        <Seccion><Escaner onLeer={leer} ocupado={ocupado} placeholder="Escanea la bolsa (BOL-…)" /></Seccion>
      ) : (
        <Alert tone="info">Tu rol solo mira la carga.</Alert>
      )}

      {aviso && (
        <div role="status" aria-live="assertive" className={`rounded-xl border-2 p-4 ${aviso.ok ? "border-ok bg-ok-soft" : "border-bad bg-bad-soft"}`}>
          <div className="flex items-start gap-3">
            {aviso.ok ? <CheckCircle2 size={28} className="shrink-0 text-ok" /> : <AlertOctagon size={28} className="shrink-0 text-bad" />}
            <div className="min-w-0">
              <p className={`text-[18px] font-bold ${aviso.ok ? "text-ok" : "text-bad"}`}>{aviso.titulo}</p>
              <p className="text-[14px] text-ink">{aviso.texto}</p>
              <p className="mt-1 font-mono text-[12px] text-muted">{aviso.codigo}</p>
            </div>
          </div>
        </div>
      )}

      {datos.sin_bolsas.length > 0 && (
        <Seccion titulo="Pedidos de la ruta sin bolsas todavía">
          <ul className="divide-y divide-line">
            {datos.sin_bolsas.map((x) => (
              <li key={x.task_id}>
                <button type="button" onClick={() => router.push(`${R.ticket}?id=${x.task_id}`)} className="flex w-full cursor-pointer items-center justify-between gap-2 py-2 text-left text-[13.5px]">
                  <span className="text-ink">{x.pedido} · parada {x.parada ?? "—"}</span>
                  <StatusBadge status={x.estado} labels={TAREA} />
                </button>
              </li>
            ))}
          </ul>
        </Seccion>
      )}

      <Seccion titulo="Orden de carga (de la última parada a la primera)">
        {datos.bolsas.length === 0 ? <Vacio>La ruta no tiene bolsas.</Vacio> : (
          <ol className="divide-y divide-line">
            {datos.bolsas.map((b) => (
              <li key={b.id} className={`flex items-center justify-between gap-3 py-2.5 ${b.status === "LOADED" ? "opacity-60" : ""}`}>
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] font-bold text-ink">{b.stop_seq ?? "—"}</span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-ink">{b.number} · {nombreBolsa(b.parcel_type).toLowerCase()} {b.parcel_no} de {b.parcel_count}</span>
                    <span className="block truncate text-[12px] text-muted">{b.cliente} · <span className="font-mono">{b.label_code}</span></span>
                  </span>
                </span>
                {b.status === "LOADED" ? <Badge tone="ok">Cargada</Badge> : <StatusBadge status={b.task_status} labels={TAREA} />}
              </li>
            ))}
          </ol>
        )}
      </Seccion>
    </div>
  );
}
