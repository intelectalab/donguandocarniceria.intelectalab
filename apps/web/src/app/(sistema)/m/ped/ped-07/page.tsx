"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Phone, Send } from "lucide-react";
import { Alert, Button, StatusBadge, Tabs, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, kg, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio } from "@/modulos/ped/Seccion";
import { usePedido } from "@/modulos/ped/usePedido";
import { ESTADOS, PESO, RESPUESTAS, celular, franjaTexto, type LineaPeso } from "@/modulos/ped/tipos";

type Aviso = { id: string; channel: string; message: string; sent_at: string; customer_response: string; responded_at: string | null; estimated_total: string; final_total: string; diff_pct: string };
type Fila = {
  id: string; number: string; status: string; delivery_date: string | null; slot_from: string | null; slot_to: string | null; estimated_total: string; final_total: string | null;
  weight_diff_status: string; cliente: string | null; celular: string | null; marca: string | null; diferencia_pct: number | null; avisos: Aviso[];
};
type Ficha = { evaluacion: { completo: boolean; estado: string; lineas: LineaPeso[] }; mensaje: string; whatsapp: string | null; avisos: Aviso[]; plantillas_enviadas: number; espera_respuesta: boolean };
type Vista = "PENDIENTES" | "AVISADOS" | "TODOS";

/** PED-07 Diferencia de peso: pedidos pesados fuera de tolerancia, mensaje sugerido, aviso y respuesta del cliente (RN-PED-05). */
export default function DiferenciaPeso() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return id ? <Aviso id={id} /> : <Lista />;
}

function Lista() {
  const router = useRouter();
  const [vista, setVista] = useState<Vista>("PENDIENTES");
  const [filas, setFilas] = useState<{ vista: Vista; datos: Fila[] } | null>(null);

  useEffect(() => {
    let vigente = true;
    api<Fila[]>(`/v1/ped/pesos?vista=${vista}`).then((d) => vigente && setFilas({ vista, datos: d })).catch((e) => toast.error(mensajeDe(e)));
    return () => { vigente = false; };
  }, [vista]);

  const datos = filas?.vista === vista ? filas.datos : null;
  return (
    <div className="space-y-4">
      <Tabs value={vista} onChange={setVista} tabs={[{ key: "PENDIENTES", label: "Por avisar" }, { key: "AVISADOS", label: "Avisados" }, { key: "TODOS", label: "Todos" }]} />
      {!datos ? <Vacio>Cargando…</Vacio> : datos.length === 0 ? <Vacio>{vista === "PENDIENTES" ? "No hay pedidos con diferencia de peso por avisar." : "No hay pedidos."}</Vacio> : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {datos.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => router.push(`/m/ped/ped-07?id=${o.id}`)} className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-2">
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium text-ink">{o.number} · {o.cliente}</span>
                  <span className="block text-[12px] text-muted">{o.marca} · {celular(o.celular)} · {fecha(o.delivery_date)} {franjaTexto(o.slot_from, o.slot_to)} · {o.avisos.length} aviso(s)</span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="text-muted">{soles(o.estimated_total)} →</span>
                  <b className="text-ink">{soles(o.final_total)}</b>
                  {o.diferencia_pct != null && <span className={o.diferencia_pct > 0 ? "text-bad" : "text-info"}>{o.diferencia_pct > 0 ? "+" : ""}{porcentaje(o.diferencia_pct, 1)}</span>}
                  <StatusBadge status={o.weight_diff_status} labels={PESO} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Aviso({ id }: { id: string }) {
  const router = useRouter();
  const { puede, can } = useSesion();
  const { detalle: d, recargar } = usePedido(id);
  const [ficha, setFicha] = useState<{ id: string; f?: Ficha; error?: string; v: number } | null>(null);
  const [version, setVersion] = useState(0);
  const [texto, setTexto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState("");

  useEffect(() => {
    let vigente = true;
    api<Ficha>(`/v1/ped/pesos/${id}`).then((f) => vigente && setFicha({ id, f, v: version })).catch((e) => vigente && setFicha({ id, error: mensajeDe(e), v: version }));
    return () => { vigente = false; };
  }, [id, version]);

  if (!ficha || ficha.id !== id || !d) return <Vacio>Cargando…</Vacio>;
  if (ficha.error || !ficha.f) return <Alert tone="bad">{ficha.error}</Alert>;
  const f = ficha.f;
  const o = d.pedido;
  const mensaje = texto ?? f.mensaje;
  const wa = f.whatsapp ? f.whatsapp.replace(/\?text=.*/, `?text=${encodeURIComponent(mensaje)}`) : null;
  const editar = puede("PED", "E");
  const tercera = f.plantillas_enviadas >= 2 && !can("crm.template.send_extra");
  const avisable = ["NOTICE_REQUIRED", "NOTICE_SENT"].includes(o.weight_diff_status);

  async function avisar(canal: string) {
    setOcupado(canal);
    // La ventana se abre al pulsar (si no, el navegador la bloquea) y se lleva a WhatsApp cuando el aviso queda registrado.
    const ventana = canal === "WHATSAPP" && wa ? window.open("", "_blank") : null;
    try {
      await api(`/v1/ped/pesos/${o.id}/aviso`, { method: "POST", body: { channel: canal, message: mensaje } });
      if (ventana && wa) {
        ventana.opener = null;
        ventana.location.href = wa;
      }
      toast.ok(canal === "WHATSAPP" ? "Aviso por WhatsApp registrado" : "Llamada registrada");
      setTexto(null);
      setVersion((n) => n + 1);
      recargar();
    } catch (e) {
      ventana?.close();
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  async function responder(aviso: string, r: string) {
    setOcupado(aviso + r);
    try {
      await api(`/v1/ped/avisos/${aviso}/respuesta`, { method: "POST", body: { response: r } });
      toast.ok(r === "REJECTED" ? "Rechazó: vuelve a pesar o ajusta el pedido" : "Respuesta registrada");
      setVersion((n) => n + 1);
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push("/m/ped/ped-07")}>Volver</Button>
        <button type="button" onClick={() => router.push(`/m/ped/ped-03?id=${o.id}`)} className="cursor-pointer font-semibold text-ink underline-offset-2 hover:underline">{o.number}</button>
        <StatusBadge status={o.status} labels={ESTADOS} />
        <StatusBadge status={o.weight_diff_status} labels={PESO} />
      </div>
      {f.espera_respuesta && o.weight_diff_status === "NOTICE_SENT" && <Alert tone="info">Esta marca espera la respuesta del cliente antes de despachar.</Alert>}
      {!avisable && <Alert tone="ok">Este pedido no tiene diferencia de peso por avisar.</Alert>}

      <Seccion titulo="Peso estimado y real">
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead><tr className="text-left text-[12px] text-muted"><th className="py-1.5 font-medium">Producto</th><th className="text-right font-medium">Estimado</th><th className="text-right font-medium">Real</th><th className="text-right font-medium">Diferencia</th><th className="text-right font-medium">Importe</th></tr></thead>
            <tbody className="divide-y divide-line">
              {f.evaluacion.lineas.map((l) => (
                <tr key={l.line_id} className={l.excede ? "text-bad" : "text-ink"}>
                  <td className="py-2">{l.name}<span className="block text-[11.5px] text-muted">tolerancia ±{porcentaje(l.tolerancia_pct, 0)}</span></td>
                  <td className="text-right">{kg(l.estimado_kg)}</td>
                  <td className="text-right">{l.real_kg != null ? kg(l.real_kg) : "—"}</td>
                  <td className="text-right">{l.diferencia_pct != null ? `${l.diferencia_pct > 0 ? "+" : ""}${porcentaje(l.diferencia_pct, 1)}` : "—"}</td>
                  <td className="text-right">{soles(l.importe_final ?? l.importe_estimado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13.5px] text-ink">Total: {soles(o.estimated_total)} → <b>{soles(o.final_total ?? o.estimated_total)}</b></p>
      </Seccion>

      {avisable && editar && (
        <Seccion titulo="Aviso al cliente" acciones={texto !== null && <Button size="sm" variant="ghost" onClick={() => setTexto(null)}>Volver al sugerido</Button>}>
          <textarea value={mensaje} onChange={(e) => setTexto(e.target.value)} rows={8} maxLength={1500} aria-label="Mensaje del aviso"
            className="w-full rounded-[9px] border border-line bg-surface-2 p-3 text-[13px] leading-relaxed text-ink outline-none focus:border-primary" />
          {tercera && <Alert tone="warn">Ya se enviaron 2 plantillas por WhatsApp a este pedido: llama por teléfono (una tercera la autoriza marketing).</Alert>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" icon={wa ? ExternalLink : Send} loading={ocupado === "WHATSAPP"} disabled={tercera} onClick={() => avisar("WHATSAPP")}>
              {wa ? "Enviar por WhatsApp" : "Registrar aviso por WhatsApp"}
            </Button>
            <Button icon={Phone} loading={ocupado === "PHONE"} onClick={() => avisar("PHONE")}>Avisé por teléfono</Button>
          </div>
          <p className="mt-2 text-[12px] text-muted">Plantillas por WhatsApp enviadas a este pedido: {f.plantillas_enviadas}.</p>
        </Seccion>
      )}

      <Seccion titulo="Avisos dados">
        {f.avisos.length === 0 ? <Vacio>Aún no se avisó al cliente.</Vacio> : (
          <ul className="divide-y divide-line">
            {f.avisos.map((a) => (
              <li key={a.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="text-ink">{a.channel === "WHATSAPP" ? "WhatsApp" : "Teléfono"} · {fechaHora(a.sent_at)} · {soles(a.estimated_total)} → {soles(a.final_total)} ({porcentaje(a.diff_pct, 1)})</span>
                  <StatusBadge status={a.customer_response} labels={RESPUESTAS} />
                </div>
                <p className="text-[12.5px] whitespace-pre-line text-muted">{a.message}</p>
                {editar && a.customer_response === "NO_RESPONSE" && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" loading={ocupado === a.id + "ACCEPTED"} onClick={() => responder(a.id, "ACCEPTED")}>Aceptó</Button>
                    <Button size="sm" variant="danger" loading={ocupado === a.id + "REJECTED"} onClick={() => responder(a.id, "REJECTED")}>Rechazó</Button>
                  </div>
                )}
                {a.responded_at && <p className="text-[12px] text-muted">Respondió {a.responded_at}</p>}
              </li>
            ))}
          </ul>
        )}
      </Seccion>
    </div>
  );
}
