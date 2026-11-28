"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Wallet } from "lucide-react";
import { Alert, Button, Cifra, Field, Input, PageHeader, StatusBadge, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dato, Seccion, Vacio, useDatos } from "@/modulos/del/comunes";
import { LIQUIDACION, R, RUTA, type Esperado, type Liquidacion } from "@/modulos/del/tipos";

type Lista = {
  por_liquidar: { id: string; code: string; route_date: string; returned_at: string | null; repartidor: string | null; esperado: Esperado }[];
  liquidaciones: (Liquidacion & { ruta: string; repartidor: string | null; recibido_por: string | null; aprobado_por: string | null; route_ref: string })[];
};
type Detalle = { ruta: { id: string; code: string; status: string; mode: string; route_date: string; repartidor: string | null; es_mia: boolean }; esperado: Esperado; liquidacion: Liquidacion | null };

/** DEL-06 Liquidación: al volver, efectivo y cobros digitales esperados, gastos, efectivo contado y diferencia (RN-DEL-10, RN-CAJ-10). */
export default function Liquidaciones() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const ruta = useSearchParams().get("ruta");
  return ruta ? <Una id={ruta} /> : <Todas />;
}

function Todas() {
  const router = useRouter();
  const { datos, error, cargando } = useDatos<Lista>("/v1/del/liquidaciones");
  return (
    <div className="space-y-5">
      <PageHeader description="Las rutas que volvieron se liquidan con el efectivo que entrega el repartidor. La recibe otra persona; si hay diferencia, lleva motivo y la aprueba alguien distinto." />
      {error && <Alert tone="bad">{error}</Alert>}
      <Seccion titulo="Por liquidar">
        {cargando ? <Vacio>Cargando…</Vacio> : !datos?.por_liquidar.length ? <Vacio>No hay rutas de vuelta por liquidar.</Vacio> : (
          <ul className="divide-y divide-line">
            {datos.por_liquidar.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => router.push(`${R.liquidacion}?ruta=${r.id}`)} className="flex w-full cursor-pointer items-center justify-between gap-3 py-2.5 text-left">
                  <span><span className="block text-[14px] font-semibold text-ink">{r.code}</span><span className="text-[12.5px] text-muted">{r.repartidor} · volvió {fechaHora(r.returned_at)}</span></span>
                  <span className="text-right text-[13px]"><b>{soles(r.esperado.efectivo)}</b><span className="block text-[12px] text-muted">efectivo esperado</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
      <Seccion titulo="Liquidaciones de los últimos 30 días">
        {!datos?.liquidaciones.length ? <Vacio>Sin liquidaciones.</Vacio> : (
          <ul className="divide-y divide-line">
            {datos.liquidaciones.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => router.push(`${R.liquidacion}?ruta=${l.route_ref}`)} className="flex w-full cursor-pointer items-center justify-between gap-3 py-2.5 text-left">
                  <span><span className="block text-[14px] font-semibold text-ink">{l.number} · {l.ruta}</span><span className="text-[12.5px] text-muted">{l.repartidor} · recibió {l.recibido_por}</span></span>
                  <span className="flex flex-col items-end gap-1"><StatusBadge status={l.status} labels={LIQUIDACION} />{Math.abs(l.difference) > 0.004 && <span className="text-[12px] text-bad">{soles(l.difference)}</span>}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
    </div>
  );
}

function Una({ id }: { id: string }) {
  const router = useRouter();
  const { me, puede } = useSesion();
  const { datos, error, cargando, recargar } = useDatos<Detalle>(`/v1/del/rutas/${id}/liquidacion`);
  const [contado, setContado] = useState("");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  if (cargando) return <Vacio>Cargando…</Vacio>;
  if (error || !datos) return <Alert tone="bad">{error || "No se encontró la ruta."}</Alert>;
  const { ruta: r, esperado: e, liquidacion: l } = datos;
  const dif = contado === "" ? 0 : Math.round((Number(contado) - e.efectivo) * 100) / 100;
  const puedeRegistrar = r.status === "RETURNED" && !l && !r.es_mia && puede("DEL", "E");
  return (
    <div className="mx-auto max-w-[720px] space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.back()}>Volver</Button>
      <Seccion>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[17px] font-bold text-ink">{r.code}</span>
          <StatusBadge status={r.status} labels={RUTA} />
        </div>
        <p className="text-[13px] text-muted">{r.repartidor} · {r.route_date.split("-").reverse().join("/")}</p>
      </Seccion>
      <div className="grid grid-cols-2 gap-3">
        <Cifra titulo="Efectivo a entregar" valor={soles(e.efectivo)} detalle={`Cobrado ${soles(e.cobrado_efectivo)} − gastos ${soles(e.gastos_ruta)}`} icono={Wallet} destacada />
        <Cifra titulo="Cobros digitales" valor={soles(e.digital)} detalle="Yape, Plin y POS: van a las cuentas de la empresa" />
      </div>
      {e.por_reembolsar > 0 && <Alert tone="info">El repartidor pagó {soles(e.por_reembolsar)} con su dinero: se le reembolsa aparte.</Alert>}
      <Seccion titulo="Cobros de la ruta">
        {!e.cobros.length ? <Vacio>Sin cobros contra entrega.</Vacio> : e.cobros.map((c) => <Dato key={c.id} label={`${c.number} · parada ${c.seq ?? "—"} · ${c.medio_nombre}${c.reference ? ` (${c.reference})` : ""}`}>{soles(c.amount)}</Dato>)}
      </Seccion>
      {e.gastos.length > 0 && (
        <Seccion titulo="Gastos del repartidor">{e.gastos.map((g) => <Dato key={g.id} label={`${g.number} · ${g.category}${g.paid_with === "OWN" ? " (con su dinero)" : ""}`}>{soles(g.amount)}</Dato>)}</Seccion>
      )}
      {l ? (
        <Seccion titulo={`Liquidación ${l.number}`}>
          <Dato label="Estado"><StatusBadge status={l.status} labels={LIQUIDACION} /></Dato>
          <Dato label="Efectivo esperado">{soles(l.expected_cash)}</Dato>
          <Dato label="Efectivo entregado">{soles(l.delivered_cash)}</Dato>
          <Dato label="Diferencia"><span className={Math.abs(l.difference) > 0.004 ? "text-bad" : ""}>{soles(l.difference)}</span></Dato>
          {l.difference_reason && <Dato label="Motivo">{l.difference_reason}</Dato>}
          {l.status === "WITH_DIFFERENCE" && puede("DEL", "A") && l.settled_by !== me.user.id && (
            <Button className="mt-3" variant="primary" loading={ocupado} onClick={async () => {
              setOcupado(true);
              try { await api(`/v1/del/liquidaciones/${l.id}/aprobar`, { method: "POST", body: {} }); toast.ok("Liquidación aprobada: la ruta queda liquidada."); recargar(); }
              catch (x) { toast.error(mensajeDe(x)); } finally { setOcupado(false); }
            }}>Aprobar la diferencia</Button>
          )}
        </Seccion>
      ) : puedeRegistrar ? (
        <Seccion titulo="Recibir el efectivo">
          <div className="space-y-3">
            <Field label="Efectivo contado (S/)" required><Input type="number" inputMode="decimal" min={0} step="0.1" value={contado} onChange={(x) => setContado(x.target.value)} /></Field>
            {contado !== "" && <p className={`text-[14px] ${Math.abs(dif) > 0.004 ? "text-bad" : "text-ok"}`}>Diferencia {soles(dif)}</p>}
            {Math.abs(dif) > 0.004 && <Field label="Motivo de la diferencia" required><Textarea value={motivo} onChange={(x) => setMotivo(x.target.value)} /></Field>}
            <Button variant="primary" loading={ocupado} disabled={contado === "" || (Math.abs(dif) > 0.004 && motivo.trim().length < 5)} onClick={async () => {
              setOcupado(true);
              try { await api(`/v1/del/rutas/${r.id}/liquidar`, { method: "POST", body: { counted_cash: Number(contado), reason: motivo.trim() || null } }); toast.ok("Liquidación registrada."); recargar(); }
              catch (x) { toast.error(mensajeDe(x)); } finally { setOcupado(false); }
            }}>Registrar liquidación</Button>
          </div>
        </Seccion>
      ) : r.status === "RETURNED" && r.es_mia ? (
        <Alert tone="info">Entrega el efectivo en caja o a coordinación: ellos registran la liquidación.</Alert>
      ) : r.status === "IN_ROUTE" ? <Alert tone="info">La ruta sigue en curso.</Alert> : null}
    </div>
  );
}
