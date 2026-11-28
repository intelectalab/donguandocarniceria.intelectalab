"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Send, X } from "lucide-react";
import { Alert, Button, Cifra, DataTable, PageHeader, buttonClass, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, porcentaje } from "@/lib/formato";
import { ErrorCarga, EstadoVersion, FiltroVersion, Seccion, Vacio, s0, useDatos, useOpciones, type Totales, type Version } from "@/modulos/prs/comunes";

type FilaCmp = { concept_id: string; code: string; name: string; type: string; total_a: number; total_b: number; total_diff: number; pct: number | null };
type Datos = { version: Version; base: Version | null; comparacion: { filas: FilaCmp[]; totales: { a: Totales; b: Totales } } | null; totales: Totales;
  sin_mapeo: { code: string; name: string }[]; lineas: number };

/** PRS-05 Envío y aprobación: envía la versión, muestra sus diferencias con la vigente y la aprueba o rechaza con comentario (RN-PRS-03 y RN-PRS-05). */
export default function EnvioAprobacion() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const router = useRouter();
  const { datos: op, recargar: recargarOp } = useOpciones();
  const pendiente = op?.versiones.find((v) => v.status === "SUBMITTED") ?? op?.versiones.find((v) => ["DRAFT", "REJECTED"].includes(v.status));
  const id = sp.get("id") || pendiente?.id || "";
  const { datos, error, cargando, recargar } = useDatos<Datos>(id ? `/v1/prs/versiones/${id}/diferencias` : null);
  const [ocupado, setOcupado] = useState("");
  if (error) return <ErrorCarga error={error} que="El envío y la aprobación son de Administración y Gerencia." />;
  const v = datos?.version;

  async function accion(clave: "enviar" | "aprobar" | "rechazar") {
    if (!v) return;
    const r = await confirmAction({
      enviar: { title: `¿Enviar ${v.etiqueta} a aprobación?`, message: "Desde ese momento sus líneas no cambian (RN-PRS-04). La aprueba Gerencia.", confirmLabel: "Enviar", reason: { label: "Comentario para Gerencia", optional: true } },
      aprobar: { title: `¿Aprobar ${v.etiqueta}?`, message: datos?.base?.status === "APPROVED" ? `Pasa a ser la vigente y ${datos.base.etiqueta} queda reemplazada (RN-PRS-03).` : "Pasa a ser la versión vigente del año.", confirmLabel: "Aprobar", reason: { label: "Comentario", optional: true } },
      rechazar: { title: `¿Rechazar ${v.etiqueta}?`, message: "Vuelve a Administración para que la corrija.", confirmLabel: "Rechazar", danger: true, reason: { label: "Motivo del rechazo", min: 5 } },
    }[clave]);
    if (!r) return;
    setOcupado(clave);
    try {
      await api(`/v1/prs/versiones/${v.id}/${clave}`, { method: "POST", body: { comentario: r.reason || null } });
      toast.ok({ enviar: "Enviada a aprobación", aprobar: "Aprobada: ya es la versión vigente", rechazar: "Rechazada con tu comentario" }[clave]);
      recargar();
      recargarOp();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  const columnas: Column<FilaCmp>[] = [
    { key: "name", header: "Concepto", cardTitle: true, render: (x) => <span className="flex flex-col"><span className="font-medium">{x.name}</span><span className="text-[12px] text-muted">{x.code}</span></span> },
    { key: "a", header: datos?.base ? datos.base.etiqueta : "Base", align: "right", render: (x) => s0(x.total_a) },
    { key: "b", header: v ? v.etiqueta : "Versión", align: "right", render: (x) => s0(x.total_b) },
    { key: "diff", header: "Diferencia", align: "right", render: (x) => <span className={Math.abs(x.total_diff) < 1 ? "text-muted" : x.total_diff > 0 ? "font-semibold text-warn" : "font-semibold text-ok"}>
      {x.total_diff > 0 ? "+" : ""}{s0(x.total_diff)}{x.pct !== null && Math.abs(x.total_diff) >= 1 ? ` (${x.pct > 0 ? "+" : ""}${porcentaje(x.pct, 1)})` : ""}</span> },
  ];
  const cambios = (datos?.comparacion?.filas ?? []).filter((x) => Math.abs(x.total_diff) >= 1);
  return (
    <div className="space-y-4">
      <PageHeader description="Envía la versión, revisa sus diferencias con la vigente y apruébala o recházala con comentario. Quien elabora o envía no aprueba (RN-PRS-05); aprueba Gerencia."
        actions={v && <Link className={buttonClass("secondary")} href={`/m/prs/prs-03?id=${v.id}`}>Ver matriz</Link>} />
      <div className="flex flex-wrap gap-2">
        {op && <FiltroVersion versiones={op.versiones} value={id} onChange={(x) => router.push(`/m/prs/prs-05?id=${x}`)} />}
      </div>
      {cargando && <Vacio>Cargando…</Vacio>}
      {v && <>
        <div className="flex flex-wrap items-center gap-2"><EstadoVersion s={v.status} /><span className="text-[14px] font-semibold">{v.etiqueta} · {v.name}</span></div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Ingresos" valor={s0(datos!.totales.ingreso)} detalle={datos?.comparacion ? `${datos.base?.etiqueta}: ${s0(datos.comparacion.totales.a.ingreso)}` : ""} destacada />
          <Cifra titulo="Costo de ventas" valor={s0(datos!.totales.costo)} detalle={datos?.comparacion ? `${datos.base?.etiqueta}: ${s0(datos.comparacion.totales.a.costo)}` : ""} />
          <Cifra titulo="Gastos" valor={s0(datos!.totales.gasto)} detalle={datos?.comparacion ? `${datos.base?.etiqueta}: ${s0(datos.comparacion.totales.a.gasto)}` : ""} />
          <Cifra titulo="Líneas" valor={String(datos!.lineas)} detalle={`${cambios.length} conceptos cambian`} />
        </div>
        {datos!.sin_mapeo.length > 0 && ["DRAFT", "REJECTED"].includes(v.status) && (
          <Alert tone="bad" title="No se puede enviar todavía (RN-PRS-02)">
            Sin mapeo: {datos!.sin_mapeo.map((c) => `${c.code} ${c.name}`).join(", ")}. Mapéalos en <Link className="underline" href="/m/prs/prs-02">Conceptos presupuestales</Link>.
          </Alert>)}
        {v.status === "SUBMITTED" && <Alert tone="warn" title={`Enviada por ${v.enviada_por ?? "—"}${v.submitted_at ? ` el ${fechaHora(v.submitted_at)}` : ""}`}>La decide Gerencia; quien la elaboró o envió no puede aprobarla.</Alert>}
        {v.status === "REJECTED" && v.decision_comment && <Alert tone="bad" title={`Rechazada por ${v.rechazada_por ?? "Gerencia"}`}>{v.decision_comment}</Alert>}
        {v.status === "APPROVED" && <Alert tone="ok" title={`Aprobada por ${v.aprobada_por ?? "Gerencia"}`}>{v.decision_comment || "Es la versión vigente."}</Alert>}
        <div className="flex flex-wrap gap-2">
          {op?.puede.enviar && ["DRAFT", "REJECTED"].includes(v.status) && <Button variant="primary" icon={Send} loading={ocupado === "enviar"} onClick={() => accion("enviar")}>Enviar a aprobación</Button>}
          {op?.puede.aprobar && v.status === "SUBMITTED" && <>
            <Button variant="primary" icon={Check} loading={ocupado === "aprobar"} onClick={() => accion("aprobar")}>Aprobar</Button>
            <Button variant="danger" icon={X} loading={ocupado === "rechazar"} onClick={() => accion("rechazar")}>Rechazar</Button>
          </>}
        </div>
        <Seccion titulo={datos!.base ? `Diferencias con ${datos!.base.etiqueta} (${datos!.base.estado.toLowerCase()})` : "Diferencias"}>
          {datos!.comparacion ? <DataTable rows={cambios.length ? cambios : datos!.comparacion.filas} columns={columnas} rowKey={(x) => x.concept_id} empty="Sin diferencias." />
            : <Vacio>No hay versión vigente ni de origen con qué comparar.</Vacio>}
          {datos!.comparacion && datos!.base && <p className="mt-2 text-[12px] text-muted">Por concepto, en el año. Mes a mes en <Link className="text-primary underline" href={`/m/prs/prs-09?a=${datos!.base.id}&b=${v.id}`}>Comparativo de versiones</Link>.</p>}
        </Seccion>
        <Seccion titulo="Historial">
          <ol className="space-y-2">
            {(v.history ?? []).slice().reverse().map((h, i) => (
              <li key={i} className="border-l-2 border-line pl-3 text-[13px]">
                <span className="font-medium">{h.action}</span> <span className="text-muted">· {h.user} · {h.at.replace("T", " ")}</span>
                {h.note && <span className="block text-muted">{h.note}</span>}
              </li>))}
          </ol>
        </Seccion>
      </>}
    </div>
  );
}
