"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertOctagon, CheckCircle2, PackageCheck, ShieldCheck } from "lucide-react";
import { Alert, Button, Field, Input, Modal, StatusBadge, Textarea, toast } from "@/components/ui";
import { ApiError, api, mensajeDe } from "@/lib/api";
import { fecha, kg, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Avance, CabeceraTarea, ConTarea, Seccion } from "@/modulos/pre/comunes";
import { Escaner, sonar } from "@/modulos/pre/Escaner";
import { LINEA, R, RESULTADOS, cantidad, hecho, type Escaneo, type Linea, type Tarea } from "@/modulos/pre/tipos";

type Aviso = { ok: boolean; titulo: string; texto: string; codigo: string; scanId?: string; fefo?: boolean; fuera?: number | null };

/** PRE-04 Armado con escaneo: cada paquete se escanea; verde si corresponde, rojo con sonido y motivo si no; avance por línea. */
export default function ArmadoConEscaneo() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return (
    <ConTarea id={id} ruta={R.armado} estados={["PENDING", "PICKING"]} titulo="Elige el pedido por armar" vacio="No hay pedidos por armar para esta fecha.">
      {(t, poner) => <Armado t={t} poner={poner} />}
    </ConTarea>
  );
}

function Armado({ t, poner }: { t: Tarea; poner: (t: Tarea) => void }) {
  const router = useRouter();
  const { can } = useSesion();
  const [lote, setLote] = useState("");
  const [peso, setPeso] = useState("");
  const [cant, setCant] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [faltante, setFaltante] = useState<Linea | null>(null);
  const puedeArmar = can("pre.task.pick") && ["PENDING", "PICKING"].includes(t.estado) && t.pedido.status !== "CANCELLED";
  const conLote = t.lineas.some((l) => l.requires_lot && !l.complete);

  async function leer(codigo: string) {
    setOcupado(true);
    try {
      const r = await api<Escaneo>(`/v1/pre/tareas/${t.id}/escanear`, {
        method: "POST",
        body: { code: codigo, lot_code: lote.trim() || undefined, weight_kg: peso ? Number(peso.replace(",", ".")) : undefined, qty: cant ? Number(cant) : undefined, device: "WEB" },
      });
      poner(r.tarea);
      sonar(r.ok);
      setAviso({
        ok: r.ok, titulo: r.ok ? (r.finished ? "Pedido completo" : "Correcto") : (r.resultado ?? RESULTADOS[r.result]?.[0] ?? "Bloqueado"),
        texto: r.message, codigo, scanId: r.scan_id, fefo: r.result === "NOT_FEFO", fuera: r.over ? (r.diff_pct ?? null) : undefined,
      });
      if (r.ok) { setPeso(""); setCant(""); }
    } catch (e) {
      sonar(false);
      setAviso({ ok: false, titulo: e instanceof ApiError && e.status === 422 ? "Bloqueado" : "Error", texto: mensajeDe(e), codigo });
    } finally {
      setOcupado(false);
    }
  }

  async function autorizar(scanId: string) {
    setOcupado(true);
    try {
      const r = await api<Escaneo>(`/v1/pre/fefo/${scanId}/autorizar`, { method: "POST", body: { reason: "Autorizado en el armado" } });
      const n = await api<Tarea>(`/v1/pre/tareas/${t.id}`);
      poner(n);
      sonar(r.ok);
      setAviso({ ok: r.ok, titulo: r.ok ? "Autorizado" : "Bloqueado", texto: r.message, codigo: "" });
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-4">
      <CabeceraTarea t={t} volver={R.armado}>
        <div className="mt-3 flex items-center gap-2"><Avance valor={t.avance} /><span className="w-12 shrink-0 text-right text-[13px] font-semibold text-ink">{t.avance} %</span></div>
      </CabeceraTarea>

      {t.pedido.notes && <Alert tone="warn" title="Nota del pedido">{t.pedido.notes}</Alert>}

      {["PICKED", "PACKED", "VERIFIED", "LOADED"].includes(t.estado) ? (
        <Alert tone="ok" title="Pedido armado">
          <p>Todas las líneas están completas{t.stock_moved ? " y el stock ya se descontó" : ""}.</p>
          <div className="mt-2"><Button variant="primary" icon={PackageCheck} onClick={() => router.push(`${R.bolsas}?id=${t.id}`)}>Pasar a bolsas y etiquetas</Button></div>
        </Alert>
      ) : puedeArmar ? (
        <Seccion>
          <Escaner onLeer={leer} ocupado={ocupado} placeholder="Escanea el código"
            extra={
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Field label="Lote en uso" hint={conLote ? "Se mantiene entre lecturas" : undefined} className="col-span-2 sm:col-span-1">
                  <Input value={lote} onChange={(e) => setLote(e.target.value.toUpperCase())} placeholder="CU-2026-…" className="font-mono" />
                </Field>
                <Field label="Peso (kg)" hint="Si la etiqueta no lo trae">
                  <Input value={peso} onChange={(e) => setPeso(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="0,000" />
                </Field>
                <Field label="Cantidad" hint="Por unidad">
                  <Input value={cant} onChange={(e) => setCant(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="1" />
                </Field>
              </div>
            } />
        </Seccion>
      ) : null}

      {aviso && (
        <div role="status" aria-live="assertive"
          className={`rounded-xl border-2 p-4 ${aviso.ok ? "border-ok bg-ok-soft" : aviso.fefo ? "border-warn bg-warn-soft" : "border-bad bg-bad-soft"}`}>
          <div className="flex items-start gap-3">
            {aviso.ok ? <CheckCircle2 size={28} className="shrink-0 text-ok" /> : <AlertOctagon size={28} className={`shrink-0 ${aviso.fefo ? "text-warn" : "text-bad"}`} />}
            <div className="min-w-0 flex-1">
              <p className={`text-[18px] font-bold ${aviso.ok ? "text-ok" : aviso.fefo ? "text-warn" : "text-bad"}`}>{aviso.titulo}</p>
              <p className="text-[14px] text-ink">{aviso.texto}</p>
              {aviso.codigo && <p className="mt-1 font-mono text-[12px] text-muted">{aviso.codigo}</p>}
              {aviso.fuera !== undefined && (
                <p className="mt-1 text-[13px] font-semibold text-warn">
                  Peso fuera de tolerancia{aviso.fuera != null ? ` (${aviso.fuera > 0 ? "+" : ""}${porcentaje(aviso.fuera, 1)})` : ""}: hay que avisar al cliente antes de despachar (PED-07).
                </p>
              )}
              {aviso.fefo && aviso.scanId && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] text-muted">Toma el lote sugerido o pide autorización a la supervisora (PRE-12).</span>
                  {can("pre.fefo.override") && <Button size="sm" icon={ShieldCheck} loading={ocupado} onClick={() => autorizar(aviso.scanId!)}>Autorizar este lote</Button>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Seccion titulo="Líneas">
        <ul className="space-y-2">
          {t.lineas.map((l) => (
            <li key={l.id} className={`rounded-xl border p-3 ${l.complete ? "border-ok bg-ok-soft" : "border-line bg-surface"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold text-ink">{l.name}</p>
                  <p className="text-[12px] text-muted">
                    <span className="font-mono">{l.sku}</span>
                    {l.lote_sugerido && !l.complete ? <> · FEFO <b className="font-mono text-ink">{l.lote_sugerido.code}</b> ({fecha(l.lote_sugerido.vence)}, {l.lote_sugerido.almacen})</> : null}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[16px] font-bold text-ink">{hecho(l)} <span className="text-[13px] font-normal text-muted">de {cantidad(l)}</span></p>
                  {l.weighted && l.sale_mode !== "KG" && <p className="text-[12px] text-muted">{kg(l.weighed_kg ?? 0)} de ~{kg(l.est_weight_kg)}</p>}
                </div>
              </div>
              {l.cut_notes && <p className="mt-1 text-[12.5px] text-warn">Corte: {l.cut_notes}</p>}
              <div className="mt-2 flex items-center gap-2">
                <Avance valor={l.avance} />
                <StatusBadge status={l.status} labels={LINEA} />
              </div>
              {l.short_reason && l.status !== "SHORT_APPROVED" && <p className="mt-1 text-[12.5px] text-info">Faltante por aprobar: {l.short_reason}</p>}
              {puedeArmar && !l.complete && !l.short_requested_at && (
                <div className="mt-2"><Button size="sm" variant="ghost" onClick={() => setFaltante(l)}>No alcanza: registrar faltante</Button></div>
              )}
            </li>
          ))}
        </ul>
      </Seccion>

      {faltante && <Faltante l={faltante} onClose={() => setFaltante(null)} onListo={async () => { setFaltante(null); poner(await api<Tarea>(`/v1/pre/tareas/${t.id}`)); }} />}
    </div>
  );
}

function Faltante({ l, onClose, onListo }: { l: Linea; onClose: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api(`/v1/pre/lineas/${l.id}/faltante`, { method: "POST", body: { reason: motivo } });
      toast.ok("Faltante registrado: la supervisora lo revisa en Faltantes");
      onListo();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Registrar faltante" description={`${l.name}: armado ${hecho(l)} de ${cantidad(l)}`} placement="center" dismissable={!guardando}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-faltante" loading={guardando} disabled={motivo.trim().length < 5}>Registrar</Button></>}>
      <form id="f-faltante" onSubmit={guardar} className="space-y-3">
        <Field label="Motivo" required hint="Por ejemplo «no hay stock en cámara» o «el lote está en cuarentena»">
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={255} rows={3} autoFocus />
        </Field>
        <p className="text-[12.5px] text-muted">La supervisora lo aprueba (no quien arma) y se avisa a la vendedora para hablar con el cliente.</p>
      </form>
    </Modal>
  );
}
