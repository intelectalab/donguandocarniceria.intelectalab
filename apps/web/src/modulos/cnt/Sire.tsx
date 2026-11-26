"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileDiff, FileQuestion, FileUp, RefreshCw, Send } from "lucide-react";
import { Alert, Button, DataTable, Field, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import {
  CRUCE_SIRE, CifraLink, FiltroSelect, PROPUESTA, REGISTRO, SelectorMes, mesActual, nombreMes, opciones, qs, texto, textoDeApi, useAlAbrir, useDatos, useOpcionesCnt, type Num, type OpcionesCnt,
} from "./comunes";

type Propuesta = {
  id: string; register: string; period: string; file_name: string | null; imported_at: string; line_count: number; total_amount: Num; status: string; superseded: boolean;
  summary: Record<string, number> | null; matched_at: string | null; system_count: number; imported_by_name: string | null; pending?: number;
};
type Linea = {
  id: string; origin: string; seq: number; match_status: string; resolution: string | null; issuer_ruc: string | null; issuer_name: string | null; doc_type_code: string; series: string;
  number: string; issue_date: string; base: Num; igv: Num; total: Num; system_total: Num; diff: Num; resolution_note: string | null; resolved_by_name: string | null; resolved_at: string | null;
};
type Detalle = { proposal: Propuesta; lines: Linea[] };
type Sistema = { count: number; total: Num };
const TIPO_CP: Record<string, string> = { "01": "Factura", "03": "Boleta", "02": "Recibo por honorarios", "07": "Nota de crédito", "08": "Nota de débito", "04": "Liquidación de compra" };

/** Cruce de la propuesta SIRE (compras o ventas) con lo registrado en el sistema. */
export function PantallaSire({ registro }: { registro: "PURCHASES" | "SALES" }) {
  const op = useOpcionesCnt();
  const router = useRouter();
  const [mes, setMes] = useState(mesActual());
  const [estado, setEstado] = useState("DIFF");
  const [importar, setImportar] = useState(false);
  const [resolver, setResolver] = useState<Linea | null>(null);
  useAlAbrir((p) => { if (p.get("month")) setMes(p.get("month")!); });
  const props = useDatos<{ data: Propuesta[] }>(`/v1/cnt/sire/propuestas${qs({ register: registro, period: mes })}`);
  const vigente = props.datos?.data.find((p) => !p.superseded) ?? null;
  const det = useDatos<Detalle>(vigente ? `/v1/cnt/sire/propuestas/${vigente.id}${qs({ status: estado })}` : null);
  const sis = useDatos<Sistema>(`/v1/cnt/sire/sistema${qs({ register: registro, period: mes })}`);
  const recargar = () => { props.recargar(); det.recargar(); sis.recargar(); };
  const p = det.datos?.proposal ?? vigente;
  const s = p?.summary ?? {};
  const doc = registro === "SALES" ? "Cliente" : "Proveedor";
  const columnas: Column<Linea>[] = [
    { key: "doc", header: "Comprobante", cardTitle: true, render: (l) => <div className="min-w-[200px]"><p className="font-medium">{l.series}-{l.number} <span className="text-[12px] font-normal text-muted">{TIPO_CP[l.doc_type_code] ?? l.doc_type_code}</span></p>
      <p className="text-[12px] text-muted">{l.issuer_name ?? "—"}{l.issuer_ruc ? ` · ${l.issuer_ruc}` : ""}</p></div> },
    { key: "issue_date", header: "Fecha", render: (l) => fecha(l.issue_date) },
    { key: "total", header: "En la propuesta", align: "right", render: (l) => l.total != null ? soles(l.total) : <span className="text-muted">—</span> },
    { key: "system_total", header: "En el sistema", align: "right", render: (l) => l.system_total != null ? soles(l.system_total) : <span className="text-muted">—</span> },
    { key: "diff", header: "Diferencia", align: "right", hideOnMobile: true, render: (l) => Number(l.diff) ? <span className="text-bad">{soles(l.diff)}</span> : "" },
    { key: "match_status", header: "Cruce", render: (l) => <StatusBadge status={l.match_status} labels={CRUCE_SIRE} /> },
    { key: "resolution", header: "Resolución", render: (l) => l.match_status === "MATCHED" ? <span className="text-muted">—</span> : l.resolution
      ? <span className="text-[12.5px]">{op?.resolutions[l.match_status]?.[l.resolution] ?? l.resolution}{l.resolution_note && <span className="block text-muted">{texto(l.resolution_note)}</span>}</span>
      : op?.can.sire ? <Button size="sm" onClick={(e) => { e.stopPropagation(); setResolver(l); }}>Resolver</Button> : <span className="text-warn">Pendiente</span> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description={`La propuesta del ${REGISTRO[registro]} que arma SUNAT para ${nombreMes(mes)}, cruzada con ${registro === "SALES" ? "los comprobantes emitidos" : "los comprobantes registrados en Compras y Gastos"}. Cada diferencia se resuelve o se justifica antes de preparar el envío.`}
        actions={<div className="flex flex-wrap items-center gap-2"><SelectorMes value={mes} onChange={setMes} />{op?.can.sire && <Button variant="primary" icon={FileUp} onClick={() => setImportar(true)}>Importar propuesta</Button>}</div>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Coinciden" valor={p ? numero(s.MATCHED ?? 0) : props.datos ? "—" : undefined} detalle={p ? `de ${numero(p.line_count)} en la propuesta` : "Sin propuesta importada"} icono={CheckCircle2} onClick={() => setEstado("MATCHED")} />
        <CifraLink titulo="Diferencia de importe" valor={p ? numero(s.AMOUNT_DIFF ?? 0) : props.datos ? "—" : undefined} icono={FileDiff} tono={s.AMOUNT_DIFF ? "warn" : undefined} onClick={() => setEstado("AMOUNT_DIFF")} />
        <CifraLink titulo="Falta en el sistema" valor={p ? numero(s.MISSING_IN_SYSTEM ?? 0) : props.datos ? "—" : undefined} icono={FileQuestion} tono={s.MISSING_IN_SYSTEM ? "bad" : undefined} onClick={() => setEstado("MISSING_IN_SYSTEM")} />
        <CifraLink titulo="Falta en la propuesta" valor={p ? numero(s.MISSING_IN_PROPOSAL ?? 0) : props.datos ? "—" : undefined} detalle={sis.datos ? `${numero(sis.datos.count)} en el sistema · ${soles(sis.datos.total)}` : undefined} icono={FileQuestion} tono={s.MISSING_IN_PROPOSAL ? "bad" : undefined} onClick={() => setEstado("MISSING_IN_PROPOSAL")} />
      </div>
      {props.datos && !vigente && <Alert tone="info" title={`Sin propuesta de ${nombreMes(mes)}`}>Descarga la propuesta del portal SIRE e impórtala aquí. Mientras tanto, el sistema tiene {numero(sis.datos?.count ?? 0)} comprobantes del mes por {soles(sis.datos?.total ?? 0)}.</Alert>}
      {p && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <StatusBadge status={p.status} labels={PROPUESTA} />
        <span className="text-muted">{p.file_name ?? "Archivo"} · importada {fechaHora(p.imported_at)}{p.imported_by_name ? ` por ${p.imported_by_name}` : ""} · total {soles(p.total_amount)}</span>
        {p.pending ? <span className="font-semibold text-warn">{p.pending} diferencias por resolver</span> : <span className="text-ok">Sin diferencias pendientes</span>}
        {op?.can.sire && <Button size="sm" icon={RefreshCw} onClick={async () => {
          try { await api(`/v1/cnt/sire/propuestas/${p.id}/cruzar`, { method: "POST" }); toast.ok("Cruce actualizado"); recargar(); } catch (e) { toast.error(mensajeDe(e)); }
        }}>Volver a cruzar</Button>}
        <Button size="sm" icon={Send} onClick={() => router.push(`/m/cnt/cnt-08?month=${mes}`)}>Ir a envíos</Button>
      </div>}
      {vigente && <DataTable rows={det.datos?.lines ?? []} rowKey={(l) => l.id} loading={det.cargando} columns={columnas} empty="No hay comprobantes con ese filtro."
        toolbar={<FiltroSelect label="Cruce" value={estado} onChange={setEstado} ancho="sm:w-[220px]"
          options={[{ value: "DIFF", label: "Con diferencia" }, ...opciones(Object.fromEntries(Object.entries(CRUCE_SIRE).map(([k, v]) => [k, v[0]])))]} />} />}
      {importar && <Importar registro={registro} mes={mes} doc={doc} onClose={() => setImportar(false)} onListo={() => { setImportar(false); setEstado("DIFF"); recargar(); }} />}
      {resolver && op && <Resolver linea={resolver} op={op} onClose={() => setResolver(null)} onListo={() => { setResolver(null); recargar(); }} />}
    </div>
  );
}

function Importar({ registro, mes, doc, onClose, onListo }: { registro: string; mes: string; doc: string; onClose: () => void; onListo: () => void }) {
  const [txt, setTxt] = useState("");
  const [archivo, setArchivo] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    setEnviando(true); setError("");
    try {
      const r = await api<{ summary: Record<string, number> }>("/v1/cnt/sire/propuestas", { method: "POST", body: { register: registro, period: `${mes}-01`, text: txt, file_name: archivo, inbox: true } });
      const dif = (r.summary?.AMOUNT_DIFF ?? 0) + (r.summary?.MISSING_IN_SYSTEM ?? 0) + (r.summary?.MISSING_IN_PROPOSAL ?? 0);
      toast.ok(`Propuesta importada: ${r.summary?.MATCHED ?? 0} coinciden${dif ? `, ${dif} con diferencia` : ""}`); onListo();
    } catch (e) { const p = erroresDe(e); setError(Object.values(p)[0] ?? mensajeDe(e)); }
    finally { setEnviando(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" dismissable={!enviando} title={`Importar la propuesta de ${nombreMes(mes)}`}
      description={`Una línea por comprobante: ${doc === "Cliente" ? "documento del cliente" : "RUC"} | razón social | tipo | serie | número | fecha | base | IGV | total. La importación reemplaza a la propuesta anterior del mes.`}
      footer={<>
        <Button onClick={async () => { try { setTxt(await textoDeApi(`/v1/cnt/sire/ejemplo${qs({ register: registro, period: mes })}`)); setArchivo(`ejemplo-${mes}.txt`); } catch (e) { toast.error(mensajeDe(e)); } }}>Usar un ejemplo</Button>
        <Button onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button variant="primary" loading={enviando} disabled={!txt.trim()} onClick={enviar}>Importar y cruzar</Button>
      </>}>
      <div className="space-y-3">
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Archivo de la propuesta">
          <input type="file" accept=".txt,.csv" className="block w-full text-[13px]" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return; setArchivo(f.name); setTxt(await f.text());
          }} />
        </Field>
        <Field label="Contenido" hint={txt ? `${txt.split(/\r?\n/).filter((l) => l.trim()).length} líneas` : "También puedes pegarlo"}>
          <Textarea value={txt} rows={8} className="font-mono text-[12px]" onChange={(e) => setTxt(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Resolver({ linea, op, onClose, onListo }: { linea: Linea; op: OpcionesCnt; onClose: () => void; onListo: () => void }) {
  const ops = op.resolutions[linea.match_status] ?? {};
  const [res, setRes] = useState(Object.keys(ops)[0] ?? "");
  const [nota, setNota] = useState("");
  const enviar = async () => {
    try { await api(`/v1/cnt/sire/lineas/${linea.id}/resolver`, { method: "POST", body: { resolution: res, note: nota || null } }); toast.ok("Diferencia resuelta"); onListo(); }
    catch (e) { toast.error(mensajeDe(e)); }
  };
  return (
    <Modal open onClose={onClose} title={`${linea.series}-${linea.number}`} description={`${CRUCE_SIRE[linea.match_status]?.[0] ?? ""} · ${linea.issuer_name ?? ""}`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={enviar}>Resolver</Button></>}>
      <div className="space-y-4">
        <p className="text-[13px]">Propuesta {linea.total != null ? soles(linea.total) : "—"} · sistema {linea.system_total != null ? soles(linea.system_total) : "—"}</p>
        <Field label="Cómo se resuelve"><Select value={res} onChange={(e) => setRes(e.target.value)} options={opciones(ops)} /></Field>
        <Field label="Nota de sustento" hint={res === "JUSTIFIED" ? "Obligatoria al justificar" : undefined}><Textarea value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
