"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, ArchivoImportar, Button, DataTable, Field, Input, PageHeader, Select, Textarea, buttonClass, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { ErrorCarga, FiltroVersion, Seccion, mesCorto, s0, useOpciones } from "@/modulos/prs/comunes";

type Revision = { filas: { fila: number; concepto: string; mes: string; marca: string | null; local: string | null; centro: string | null; amount: number }[];
  errores: { fila: number; code: string; mensaje: string }[]; validas: number; total: number };

/** PRS-04 Carga y copia: importa líneas desde Excel con validación, o copia otra versión o el real del año anterior con ajuste %. */
export default function CargaYCopia() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const router = useRouter();
  const { datos: op, error } = useOpciones();
  const editables = (op?.versiones ?? []).filter((v) => ["DRAFT", "REJECTED"].includes(v.status));
  const id = sp.get("id") && editables.some((v) => v.id === sp.get("id")) ? sp.get("id")! : editables[0]?.id ?? "";
  const v = op?.versiones.find((x) => x.id === id);
  const [texto, setTexto] = useState("");
  const [rev, setRev] = useState<Revision | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [desde, setDesde] = useState("");
  const [pctV, setPctV] = useState("0");
  const [pctR, setPctR] = useState("8");
  if (error) return <ErrorCarga error={error} que="La carga de líneas es de Administración." />;
  if (op && !op.puede.editar) return <ErrorCarga error="Esta pantalla es del rol de Administración." que="Cargar y copiar líneas es de Administración (prs.budget.edit)." />;

  async function hacer<T>(clave: string, fn: () => Promise<T>, ok: (r: T) => string) {
    setOcupado(clave);
    try {
      const r = await fn();
      toast.ok(ok(r));
      return r;
    } catch (e) {
      toast.error(mensajeDe(e));
      return null;
    } finally {
      setOcupado("");
    }
  }
  const reemplaza = async (que: string) => Boolean(await confirmAction({ title: `¿Reemplazar las líneas de ${v?.etiqueta}?`, message: `${que} borra las líneas que ya tiene esta versión en borrador.`, confirmLabel: "Reemplazar", danger: true }));

  const columnas: Column<Revision["filas"][number]>[] = [
    { key: "fila", header: "Fila", render: (x) => x.fila },
    { key: "concepto", header: "Concepto", cardTitle: true },
    { key: "mes", header: "Mes", render: (x) => `${mesCorto(x.mes)} ${x.mes.slice(0, 4)}` },
    { key: "dim", header: "Dimensión", render: (x) => [x.marca, x.local, x.centro].filter(Boolean).join(" · ") },
    { key: "amount", header: "Importe", align: "right", render: (x) => s0(x.amount) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Llena una versión en borrador: importa líneas desde Excel con validación, copia otra versión o copia el real del año anterior con un ajuste %."
        actions={v && <Link className={buttonClass("secondary")} href={`/m/prs/prs-03?id=${v.id}`}>Ver matriz</Link>} />
      <div className="flex flex-wrap gap-2">
        {op && <FiltroVersion versiones={op.versiones} soloEditables value={id} onChange={(x) => router.push(`/m/prs/prs-04?id=${x}`)} vacio="Elige una versión en borrador" />}
      </div>
      {op && !editables.length && <Alert tone="info">No hay versiones en borrador. Crea una revisión o una versión vacía en <Link href="/m/prs/prs-01" className="text-primary underline">Presupuestos</Link>.</Alert>}
      {v && <>
        <Seccion titulo="1. Importar desde Excel">
          <div className="space-y-3">
            <ArchivoImportar plantilla="/v1/prs/importar/plantilla" archivo="/v1/prs/importar/archivo" nombre="plantilla-presupuesto.xlsx" onTexto={(t) => { setTexto(t); setRev(null); }} />
            <Field label="O pega las filas (concepto; mes; marca; local; centro de costo; importe; nota)">
              <Textarea rows={5} value={texto} onChange={(e) => { setTexto(e.target.value); setRev(null); }} placeholder={"PUB-PLA;1;DG;;MKT-DG;6000;Meta y Google\nOCU-ALQ;2;;L1;ADM;4500;"} className="font-mono text-[12.5px]" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!texto.trim()} loading={ocupado === "revisar"} onClick={async () => {
                const r = await hacer("revisar", () => api<Revision>(`/v1/prs/versiones/${v.id}/importar/revisar`, { method: "POST", body: { texto } }),
                  (x) => x.errores.length ? `${x.errores.length} fila(s) con error` : `${x.validas} filas listas para cargar`);
                if (r) setRev(r);
              }}>Revisar</Button>
              <Button variant="primary" disabled={!rev || rev.errores.length > 0 || !rev.validas} loading={ocupado === "importar"} onClick={async () => {
                const r = await hacer("importar", () => api<{ lineas: number }>(`/v1/prs/versiones/${v.id}/importar`, { method: "POST", body: { texto } }), (x) => `${x.lineas} líneas cargadas en ${v.etiqueta}`);
                if (r) { setTexto(""); setRev(null); }
              }}>Cargar {rev?.validas ? `${rev.validas} líneas · ${s0(rev.total)}` : ""}</Button>
            </div>
            {rev && rev.errores.length > 0 && (
              <Alert tone="bad" title={`${rev.errores.length} fila(s) con error: corrígelas y revisa de nuevo`}>
                {rev.errores.slice(0, 15).map((e) => <span key={`${e.fila}-${e.mensaje}`} className="block">Fila {e.fila}: {e.mensaje}</span>)}
              </Alert>)}
            {rev && rev.filas.length > 0 && <DataTable rows={rev.filas.slice(0, 200)} columns={columnas} rowKey={(x) => String(x.fila)} />}
          </div>
        </Seccion>
        <div className="grid gap-4 lg:grid-cols-2">
          <Seccion titulo="2. Copiar otra versión">
            <div className="space-y-3">
              <Field label="Versión de origen"><Select value={desde} placeholder="Elige" onChange={(e) => setDesde(e.target.value)}
                options={op!.versiones.filter((x) => x.id !== v.id).map((x) => ({ value: x.id, label: `${x.etiqueta} · ${x.estado}` }))} /></Field>
              <Field label="Ajuste %" hint="Ej.: 5 sube cada línea 5 %; −10 la baja 10 %."><Input type="number" step="0.1" value={pctV} onChange={(e) => setPctV(e.target.value)} /></Field>
              <Button variant="primary" disabled={!desde} loading={ocupado === "version"} onClick={async () => {
                if (!(await reemplaza("Copiar otra versión"))) return;
                const r = await hacer("version", () => api<{ lineas: number; total: number }>(`/v1/prs/versiones/${v.id}/copiar-version`, { method: "POST", body: { desde, pct: Number(pctV || 0) } }),
                  (x) => `${x.lineas} líneas copiadas (${s0(x.total)})`);
                if (r) router.push(`/m/prs/prs-03?id=${v.id}`);
              }}>Copiar</Button>
            </div>
          </Seccion>
          <Seccion titulo={`3. Copiar el real de ${v.year - 1}`}>
            <div className="space-y-3">
              <p className="text-[13px] text-muted">Meses cerrados: real congelado. Meses vencidos: real. Mes en curso: proyección. Meses que faltan: presupuesto aprobado. Se redondea a soles enteros.</p>
              <Field label="Ajuste %"><Input type="number" step="0.1" value={pctR} onChange={(e) => setPctR(e.target.value)} /></Field>
              <Button variant="primary" loading={ocupado === "real"} onClick={async () => {
                if (!(await reemplaza(`Copiar el real de ${v.year - 1}`))) return;
                const r = await hacer("real", () => api<{ lineas: number; total: number }>(`/v1/prs/versiones/${v.id}/copiar-real`, { method: "POST", body: { pct: Number(pctR || 0) } }),
                  (x) => `${x.lineas} líneas desde el real (${s0(x.total)})`);
                if (r) router.push(`/m/prs/prs-03?id=${v.id}`);
              }}>Copiar el real</Button>
            </div>
          </Seccion>
        </div>
      </>}
    </div>
  );
}
