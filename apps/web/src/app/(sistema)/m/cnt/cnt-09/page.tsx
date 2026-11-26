"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";
import { Alert, Badge, Button, DataTable, Modal, PageHeader, Select, Tabs, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, soles } from "@/lib/formato";
import { FORMATO, REGIMEN, Seccion, SelectorMes, mesActual, mesDe, nombreMes, qs, texto, useAlAbrir, useDatos } from "@/modulos/cnt/comunes";

type Libro = { code: string; name: string; via: string; required: boolean; ple_code: string | null };
type Exportacion = { id: string; book_code: string; book_name: string; period: string; format: string; file_name: string; row_count: number; hash: string; generated_at: string; generated_by_name: string | null };
type Respuesta = {
  regime: { year: number; uit: number | null; threshold_uit: number; limit: number | null; revenue: number; revenue_source: string; result: string; books: string[] } | null;
  books: Libro[]; exports: Exportacion[];
};
type Vista = { book: string; name: string; count: number; rows: string[][] };
const COLUMNAS: Record<string, string[]> = {
  RV: ["Fecha", "Tipo", "Serie", "Número", "Documento del cliente", "Cliente", "Base", "IGV", "Total"],
  RC: ["Fecha", "Tipo", "Serie", "Número", "RUC", "Proveedor", "Base", "IGV", "Total"],
  LDS: ["Asiento", "Fecha", "Glosa", "Movimiento por cuenta"],
  LD: ["Asiento", "Fecha", "Glosa", "Cuenta", "Nombre", "Debe", "Haber"],
  LCB: ["Fecha", "Asiento", "Cuenta", "Glosa", "Debe", "Haber"],
  LM: ["Cuenta", "Nombre", "Saldo inicial", "Debe", "Haber", "Saldo final"],
  LIB: ["Cuenta", "Nombre", "Saldo inicial", "Debe", "Haber", "Saldo final"],
};
const NUMERICAS = ["Base", "IGV", "Total", "Debe", "Haber", "Saldo inicial", "Saldo final"];

/** CNT-09 Libros y PLE: los libros que exige el régimen del año, su vista y la generación en PDF, Excel o TXT del PLE. */
export default function Libros() {
  const [mes, setMes] = useState(mesActual());
  useAlAbrir((p) => { if (p.get("month")) setMes(p.get("month")!); });
  const { datos: r, recargar, error } = useDatos<Respuesta>(`/v1/cnt/libros${qs({ year: mes.slice(0, 4), period: mes })}`);
  const [libro, setLibro] = useState("");
  const actual = libro || r?.regime?.books[0] || r?.books[0]?.code || "LD";
  const vista = useDatos<Vista>(r ? `/v1/cnt/libros/vista${qs({ book: actual, period: mes })}` : null);
  const [generar, setGenerar] = useState<Libro | null>(null);
  const libros = r?.books ?? [];
  const reg = r?.regime;
  const cols = COLUMNAS[actual] ?? [];
  return (
    <div className="space-y-5">
      <PageHeader description={`Los libros de ${nombreMes(mes)}. El régimen del año dice cuáles se llevan; los registros de ventas y compras van por SIRE y los demás se exportan al PLE.`}
        actions={<SelectorMes value={mes} onChange={setMes} />} />
      {error && <Alert tone="bad">{error}</Alert>}
      {reg && <Alert tone="info" title={`${REGIMEN[reg.result] ?? reg.result} en ${reg.year}`}>
        Ingresos del año {soles(reg.revenue)} ({texto(reg.revenue_source)}) frente al límite de {reg.threshold_uit} UIT{reg.limit ? ` (${soles(reg.limit)})` : ""}. Se llevan: {reg.books.map((b) => libros.find((l) => l.code === b)?.name ?? b).join(", ")}.
      </Alert>}
      <Seccion titulo="Libros del año">
        <ul className="divide-y divide-line">{libros.map((l) => (
          <li key={l.code} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-[13.5px]"><span className="font-medium">{l.name}</span> <Badge tone={l.via === "SIRE" ? "info" : "neutral"}>{l.via === "SIRE" ? "Por SIRE" : "PLE"}</Badge>{" "}{l.required ? <Badge tone="ok">Se lleva</Badge> : <span className="text-[12px] text-muted">No lo exige el régimen</span>}</span>
            <span className="flex gap-2"><Button size="sm" onClick={() => setLibro(l.code)}>Ver</Button>{l.required && <Button size="sm" icon={FileDown} onClick={() => setGenerar(l)}>Generar</Button>}</span>
          </li>))}</ul>
      </Seccion>
      <Seccion titulo={vista.datos ? `${vista.datos.name} · ${numero(vista.datos.count)} filas` : "Vista del libro"}>
        <Tabs tabs={libros.map((l) => ({ key: l.code, label: l.code === "LDS" ? "Diario simplificado" : l.name.replace(/^Libro (de )?/, "").replace(/^Registro de /, "Reg. ") }))} value={actual} onChange={setLibro} />
        <div className="mt-3">
          <DataTable rows={(vista.datos?.rows ?? []).map((f, i) => ({ f, i }))} rowKey={(x) => String(x.i)} loading={vista.cargando} empty="El libro no tiene movimientos en el mes."
            columns={cols.map((h, j) => ({ key: String(j), header: h, align: NUMERICAS.includes(h) ? "right" as const : undefined, cardTitle: j === 0, hideOnMobile: cols.length > 5 && j > 1 && j < cols.length - 2,
              render: (x: { f: string[] }) => <span className={NUMERICAS.includes(h) ? "tabular-nums" : j === 2 || h === "Glosa" ? "text-[12.5px]" : ""}>{texto(x.f[j])}</span> }))} />
          {vista.datos && vista.datos.count > vista.datos.rows.length && <p className="mt-2 text-[12.5px] text-muted">Se muestran las primeras {vista.datos.rows.length} filas; el archivo generado las trae todas.</p>}
        </div>
      </Seccion>
      <Seccion titulo="Archivos generados">
        <DataTable rows={(r?.exports ?? []).slice(0, 30)} rowKey={(e) => e.id} empty="Todavía no se generan archivos." columns={[
          { key: "book_name", header: "Libro", cardTitle: true, render: (e) => <div><p className="font-medium">{e.book_name}</p><p className="text-[12px] text-muted">{nombreMes(e.period)} · {FORMATO[e.format] ?? e.format}</p></div> },
          { key: "file_name", header: "Archivo", hideOnMobile: true, render: (e) => <span className="text-[12.5px]">{e.file_name}<span className="block truncate text-muted" title={e.hash}>Huella {e.hash.slice(0, 16)}…</span></span> },
          { key: "row_count", header: "Filas", align: "right", render: (e) => numero(e.row_count) },
          { key: "generated_at", header: "Generado", render: (e) => <span className="text-[12.5px]">{fechaHora(e.generated_at)}<span className="block text-muted">{e.generated_by_name}</span></span> },
        ]} />
      </Seccion>
      {generar && <Generar libro={generar} mes={mes} onClose={() => setGenerar(null)} onListo={() => { setGenerar(null); recargar(); }} />}
    </div>
  );
}

function Generar({ libro, mes, onClose, onListo }: { libro: Libro; mes: string; onClose: () => void; onListo: () => void }) {
  const [formato, setFormato] = useState("PDF");
  const enviar = async () => {
    try {
      const r = await api<{ file_name: string; row_count: number }>("/v1/cnt/libros", { method: "POST", body: { book_code: libro.code, period: `${mes}-01`, format: formato } });
      toast.ok(`${r.file_name}: ${numero(r.row_count)} filas`); onListo();
    } catch (e) { toast.error(mensajeDe(e)); }
  };
  return (
    <Modal open onClose={onClose} title={`Generar ${libro.name}`} description={nombreMes(mesDe(`${mes}-01`))}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={enviar}>Generar</Button></>}>
      <Select aria-label="Formato" value={formato} onChange={(e) => setFormato(e.target.value)}
        options={Object.entries(FORMATO).map(([value, label]) => ({ value, label, disabled: value === "TXT" && libro.via === "SIRE" }))} />
      {libro.via === "SIRE" && <p className="mt-2 text-[12.5px] text-muted">Este registro se lleva en SIRE: no se exporta al PLE.</p>}
    </Modal>
  );
}
