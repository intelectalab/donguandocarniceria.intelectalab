"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, GitMerge } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, Field, PageHeader, Textarea, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { CANALES, TIPOS_CLIENTE, celular, etiqueta, type Fusion, type LadoFusion, type VistaFusion } from "@/modulos/cli/tipos";

/**
 * CLI-11 Fusión de clientes: elige quién sobrevive, muestra todo lo que se moverá (pedidos,
 * comprobantes, direcciones, saldo, consentimientos) y pide el motivo. No se deshace (RN-CLI-08).
 * ?a=&b= el par; sin par abre el primero pendiente.
 */
export default function FusionDeClientes() {
  return <Suspense><Pantalla /></Suspense>;
}

// Lee ?id= y los demás datos de la dirección en el navegador: la página se compila sin ellos.
function Pantalla() {
  const params = Object.fromEntries(useSearchParams());
  const a = typeof params.a === "string" ? params.a : "";
  const b = typeof params.b === "string" ? params.b : "";
  const router = useRouter();
  const { can } = useSesion();
  const puede = can("cli.customer.merge");
  const [sobrev, setSobrev] = useState<{ par: string; id: string } | null>(null);
  const [vistaP, setVistaP] = useState<{ clave: string; v: VistaFusion } | null>(null);
  const [error, setError] = useState("");
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [fusionando, setFusionando] = useState(false);
  const historial = useListado<Fusion>("/v1/cli/fusiones", { porPagina: 10 });

  const par = `${a}|${b}`;
  const elegido = sobrev?.par === par ? sobrev.id : "";
  const clave = `${par}|${elegido}`;

  useEffect(() => {
    let vigente = true;
    const q = new URLSearchParams();
    if (a && b) { q.set("a", a); q.set("b", b); }
    if (elegido) q.set("sobreviviente", elegido);
    api<VistaFusion>(`/v1/cli/fusion?${q}`).then((v) => { if (vigente) { setVistaP({ clave, v }); setError(""); } }).catch((e) => vigente && setError(mensajeDe(e)));
    return () => { vigente = false; };
  }, [a, b, elegido, clave]);

  const v = vistaP?.clave === clave ? vistaP.v : null;
  const s = v?.sobreviviente;
  const m = v?.fusionado;

  async function fusionar() {
    if (!s || !m) return;
    setFusionando(true); setErrores({});
    try {
      await api("/v1/cli/fusion", { method: "POST", body: { sobreviviente_id: s.id, fusionado_id: m.id, motivo } });
      toast.ok(`${m.nombre} se fusionó en ${s.nombre}`);
      router.push(`/m/cli/cli-02?id=${s.id}`);
    } catch (e) {
      const porCampo = erroresDe(e);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) toast.error(mensajeDe(e));
    } finally {
      setFusionando(false);
    }
  }

  const columnas: Column<Fusion>[] = [
    { key: "merged_at", header: "Fecha", sortable: true, render: (f) => <div><div>{fechaHora(f.merged_at)}</div><div className="text-[12px] text-muted">{f.merged_by}</div></div> },
    { key: "survivor_name", header: "Sobrevive", cardTitle: true, render: (f) => <Link href={`/m/cli/cli-02?id=${f.survivor_id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-primary">{f.survivor_name}</Link> },
    { key: "merged_name", header: "Fusionado", render: (f) => f.merged_name },
    { key: "movido", header: "Se movió", hideOnMobile: true, render: (f) => <span className="text-[12.5px]">{f.movido || "—"}</span> },
    { key: "reason", header: "Motivo", hideOnMobile: true, render: (f) => f.reason },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Junta dos registros de la misma persona. Todo pasa al que sobrevive y el otro queda inactivo. No se puede deshacer." />

      {error ? <Alert tone="bad" title="No se pudo abrir la fusión">{error}</Alert>
        : !v ? <p className="text-[13px] text-muted">Cargando…</p>
        : !v.par ? <Alert tone="ok" title="No hay duplicados pendientes">Elige un par desde <Link href="/m/cli/cli-10" className="underline">Duplicados</Link>.</Alert>
        : s && m && (
          <section className="space-y-4">
            {(s.merged_into_id || m.merged_into_id) && <Alert tone="warn">Uno de los dos ya fue fusionado: no se puede volver a fusionar (RN-CLI-08).</Alert>}
            <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <Lado c={s} titulo="Sobrevive" tono="ok" />
              <div className="flex items-center justify-center">
                <Button icon={ArrowLeftRight} onClick={() => setSobrev({ par, id: m.id })} disabled={!puede}>Invertir</Button>
              </div>
              <Lado c={m} titulo="Se fusiona y queda inactivo" tono="warn" />
            </div>

            {v.mueve && (
              <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
                <h2 className="mb-2 text-[14px] font-semibold">Pasará a {s.nombre}</h2>
                <ul className="grid gap-x-6 gap-y-1 text-[13.5px] sm:grid-cols-2">
                  {v.mueve.conteo.filter((x) => x.filas > 0).map((x) => <li key={x.tabla} className="flex justify-between gap-3"><span>{x.nombre}</span><span className="font-mono">{numero(x.filas)}</span></li>)}
                  {v.mueve.consentimientos > 0 && <li className="flex justify-between gap-3"><span>Constancias de publicidad</span><span className="font-mono">{numero(v.mueve.consentimientos)}</span></li>}
                  {v.mueve.saldo !== 0 && <li className="flex justify-between gap-3"><span>Saldo a favor</span><span className="font-mono">{soles(v.mueve.saldo)}</span></li>}
                  {v.mueve.por_cobrar > 0 && <li className="flex justify-between gap-3"><span>Por cobrar</span><span className="font-mono">{soles(v.mueve.por_cobrar)}</span></li>}
                </ul>
                {v.mueve.conteo.every((x) => x.filas === 0) && !v.mueve.consentimientos && !v.mueve.saldo && <p className="text-[13px] text-muted">No tiene pedidos ni movimientos: solo se marca como fusionado.</p>}
                <p className="mt-3 text-[12.5px] text-muted">Los datos que le falten al sobreviviente (correo, documento, celular alterno) se completan con los del fusionado.</p>
              </div>
            )}

            {puede && !s.merged_into_id && !m.merged_into_id && (
              <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <Field label="Motivo de la fusión" required error={errores.motivo}>
                  <Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Mismo cliente: escribió desde otro número de WhatsApp" />
                </Field>
                <Button variant="danger" icon={GitMerge} loading={fusionando} disabled={motivo.trim().length < 5} onClick={fusionar}>Fusionar (no se deshace)</Button>
              </div>
            )}
          </section>
        )}

      <section className="space-y-3">
        <h2 className="text-[14px] font-semibold">Historial de fusiones</h2>
        <DataTable {...historial.tabla} columns={columnas} search={{ ...historial.tabla.search, placeholder: "Nombre o motivo…" }} empty="Todavía no hay fusiones." />
      </section>
    </div>
  );
}

function Lado({ c, titulo, tono }: { c: LadoFusion; titulo: string; tono: "ok" | "warn" }) {
  return (
    <div className={`rounded-xl border bg-surface p-4 shadow-card ${tono === "ok" ? "border-ok/40" : "border-warn/40"}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Badge tone={tono}>{titulo}</Badge>
        <Link href={`/m/cli/cli-02?id=${c.id}`} className="text-[12.5px] font-medium text-primary hover:underline">Ver ficha</Link>
      </div>
      <p className="mb-2 text-[15px] font-semibold">{c.nombre}</p>
      <DetailList items={[
        { label: "Celular", value: <span className="font-mono">{celular(c.phone)}</span> },
        ...(c.phone_alt ? [{ label: "Celular alterno", value: <span className="font-mono">{celular(c.phone_alt)}</span> }] : []),
        { label: "Documento", value: c.doc_type === "NONE" || !c.doc_number ? "Sin documento" : <>{c.doc_type} {c.doc_number} {c.doc_validated_at ? <Badge tone="ok">Validado</Badge> : null}</> },
        { label: "Correo", value: c.email },
        { label: "Tipo", value: etiqueta(TIPOS_CLIENTE, c.customer_type) },
        { label: "Canal", value: etiqueta(CANALES, c.source_channel) + (c.origin_wa_number ? ` · ${c.origin_wa_number}` : "") },
        { label: "Pedidos", value: numero(c.pedidos) },
        { label: "Direcciones", value: numero(c.direcciones) },
        { label: "Saldo a favor", value: soles(c.saldo) },
      ]} />
    </div>
  );
}
