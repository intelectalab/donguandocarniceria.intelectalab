"use client";

import { useState, type FormEvent } from "react";
import { Camera, QrCode, Send } from "lucide-react";
import { Alert, Button, DataTable, Field, Input, Select, StatusBadge, Textarea, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { opcionesEquipo, useAlAbrir, useDatos, useOpcionesEqu } from "@/modulos/equ/comunes";
import { ESTADO, ESTADO_ORDEN, URGENCIAS, type Equipo, type Orden } from "@/modulos/equ/tipos";

type PorCodigo = Equipo & { open_corrective: { id: string; number: string; description: string } | null };

/**
 * EQU-07 Reporte de falla, pensado para el celular: el QR del equipo abre esta pantalla con el equipo elegido
 * (o se escribe su código), se describe la falla y se sube la foto. Crea la orden correctiva (RN-EQU-05).
 */
export default function ReporteFalla() {
  const { puede } = useSesion();
  const op = useOpcionesEqu();
  const [codigo, setCodigo] = useState("");
  const [buscado, setBuscado] = useState("");
  const [equipoId, setEquipoId] = useState("");
  const [f, setF] = useState({ description: "", urgency: "NORMAL", photo_url: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<{ order: Orden; created: boolean } | null>(null);
  const mias = useListado<Orden>("/v1/equ/ordenes", { orden: "-reported_at", porPagina: 10, filtros: { mias: 1, kind: "CORRECTIVE" } });
  useAlAbrir((p) => {
    if (p.get("code")) { setCodigo(p.get("code")!); setBuscado(p.get("code")!); }
    if (p.get("id")) setEquipoId(p.get("id")!);
  });
  const porCodigo = useDatos<PorCodigo>(buscado ? `/v1/equ/equipos/codigo?code=${encodeURIComponent(buscado)}` : null);
  const id = porCodigo.datos?.id ?? equipoId;
  const elegido = porCodigo.datos ?? null;
  const eqOp = op?.equipment.find((e) => e.id === id);
  const reporta = Boolean(op?.can.report) && puede("EQU", "C");

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true); setErrores({});
    try {
      const r = await api<{ order: Orden; created: boolean }>("/v1/equ/fallas", { method: "POST", body: { equipment_id: id || null, code: id ? null : codigo || null, ...f, photo_url: f.photo_url || null } });
      setHecho(r);
      toast.ok(r.created ? `Orden ${r.order.number} abierta` : `Reporte sumado a ${r.order.number}`);
      setF({ description: "", urgency: "NORMAL", photo_url: "" });
      mias.recargar();
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(Object.keys(porCampo).length ? porCampo : { _: mensajeDe(err) });
    } finally { setEnviando(false); }
  }

  if (op && !reporta) return <Alert tone="info" title="Sin permiso para reportar fallas">Reportar fallas pide el permiso equ.failure.report (operarios, almacén y caja).</Alert>;

  return (
    <div className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
      <form onSubmit={enviar} noValidate className="space-y-4 rounded-xl border border-line bg-surface p-4 shadow-card">
        <div>
          <h2 className="text-[15px] font-semibold">Reportar una falla</h2>
          <p className="text-[12.5px] text-muted">Escanea el QR pegado en el equipo con la cámara del celular, o escribe su código.</p>
        </div>
        {hecho && <Alert tone={hecho.created ? "warn" : "info"} title={hecho.created ? `Orden ${hecho.order.number} abierta` : `Sumado a ${hecho.order.number}`}>
          {hecho.created ? `${hecho.order.equipment_code} queda fuera de servicio hasta que se repare (RN-EQU-05). Se avisó al jefe de producción.`
            : `${hecho.order.equipment_code} ya tenía esa orden correctiva abierta: tu reporte se agregó a ella.`}
        </Alert>}
        <Field label="Código del QR" hint="EQ-SEL-L1-01 o SEL-L1-01">
          <div className="flex gap-2">
            <Input value={codigo} placeholder="EQ-…" autoCapitalize="characters" onChange={(x) => setCodigo(x.target.value.toUpperCase())}
              onKeyDown={(x) => { if (x.key === "Enter") { x.preventDefault(); setEquipoId(""); setBuscado(codigo.trim()); } }} />
            <Button icon={QrCode} onClick={() => { setEquipoId(""); setBuscado(codigo.trim()); }} disabled={!codigo.trim()}>Buscar</Button>
          </div>
        </Field>
        {porCodigo.error && <Alert tone="bad">{porCodigo.error}</Alert>}
        <Field label="O elige el equipo">
          <Select value={id} placeholder="Elegir" searchable options={opcionesEquipo(op)} onChange={(x) => { setBuscado(""); setCodigo(""); setEquipoId(x.target.value); }} />
        </Field>
        {(elegido || eqOp) && <div className="rounded-[9px] border border-line bg-surface-2 px-3 py-2 text-[13px]">
          <p className="font-medium"><span className="font-mono">{elegido?.code ?? eqOp?.code}</span> · {elegido?.name ?? eqOp?.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-muted">{elegido?.establishment_name} <StatusBadge status={elegido?.status ?? eqOp?.status} labels={ESTADO} /></p>
          {elegido?.open_corrective && <p className="mt-1 text-warn">Ya tiene abierta la orden {elegido.open_corrective.number}: tu reporte se sumará a ella.</p>}
        </div>}
        <Field label="¿Qué falla?" required error={errores.description}>
          <Textarea rows={4} value={f.description} placeholder="No sella, hace ruido, no enfría…" onChange={(x) => setF({ ...f, description: x.target.value })} />
        </Field>
        <Field label="Urgencia" error={errores.urgency}>
          <Select value={f.urgency} options={URGENCIAS} onChange={(x) => setF({ ...f, urgency: x.target.value })} />
        </Field>
        <Field label="Foto" error={errores.photo_url} hint="Se guarda el nombre del archivo tomado con la cámara">
          <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-[9px] border border-dashed border-line px-3 py-2 text-[13px] text-muted hover:text-ink">
            <Camera size={16} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{f.photo_url || "Tomar o elegir foto"}</span>
            <input type="file" accept="image/*" capture="environment" className="sr-only"
              onChange={(x) => { const a = x.target.files?.[0]; if (a) setF({ ...f, photo_url: `fallas/${new Date().toISOString().slice(0, 10)}-${a.name}`.slice(0, 255) }); }} />
          </label>
        </Field>
        {errores._ && <p role="alert" className="rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad">{errores._}</p>}
        <Button type="submit" variant="danger" icon={Send} loading={enviando} disabled={!id && !codigo.trim()} className="w-full">Reportar falla</Button>
      </form>
      <section className="min-w-0 space-y-2">
        <h2 className="text-[14px] font-semibold">Mis últimos reportes</h2>
        <DataTable {...mias.tabla} search={undefined} columns={[
          { key: "number", header: "Orden", render: (o) => <span className="font-mono font-semibold">{o.number}</span> },
          { key: "equipment_code", header: "Equipo", cardTitle: true, render: (o) => <span><span className="font-mono">{o.equipment_code}</span> · {o.equipment_name}</span> },
          { key: "reported_at", header: "Reportada", render: (o) => fechaHora(o.reported_at) },
          { key: "status", header: "Estado", render: (o) => <StatusBadge status={o.status} labels={ESTADO_ORDEN} /> },
        ]} empty="Aún no reportaste fallas." />
      </section>
    </div>
  );
}
