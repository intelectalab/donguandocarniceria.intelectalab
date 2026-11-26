"use client";

import { useState } from "react";
import { Calculator, Landmark, Plus, Scale } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, PageHeader, Textarea, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { CifraLink, REGIMEN, Seccion, num, qs, texto, useDatos, useOpcionesCnt, type Num } from "@/modulos/cnt/comunes";

type Anio = {
  id: string; year: number; uit_value_pen: Num; uit_source: string | null; revenue_pen: Num; uit_confirmed_at: string | null; confirmed_by_name: string | null;
  regime_result: string | null; books: string[] | null; notes: string | null; ledger_revenue: number;
};
type Regimen = { year: number; uit: number | null; threshold_uit: number; limit: number | null; revenue: number; revenue_source: string; result: string; books: string[] };

/** CNT-10 Régimen y libros del año: ingresos, valor de la UIT, umbral y resultado. */
export default function RegimenDelAnio() {
  const op = useOpcionesCnt();
  const { datos: r, recargar } = useDatos<{ data: Anio[]; threshold_uit: number }>("/v1/cnt/anios");
  const [anio, setAnio] = useState<number | null>(null);
  const [simulado, setSimulado] = useState("");
  const elegido = anio ?? r?.data[0]?.year ?? new Date().getFullYear();
  const reg = useDatos<Regimen>(`/v1/cnt/regimen${qs({ year: elegido, revenue: num(simulado) })}`);
  const [editar, setEditar] = useState<Anio | "nuevo" | null>(null);
  const fila = r?.data.find((a) => a.year === elegido);
  const libros = Object.fromEntries((op?.books ?? []).map((b) => [b.code, b.name]));
  return (
    <div className="space-y-5">
      <PageHeader description={`Si los ingresos del año pasan de ${r?.threshold_uit ?? 300} UIT, se lleva contabilidad completa; si no, libros simplificados. La contadora carga y confirma el valor de la UIT de cada año.`}
        actions={op?.can.close && <Button variant="primary" icon={Plus} onClick={() => setEditar("nuevo")}>Cargar un año</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo={`Resultado ${elegido}`} valor={reg.datos ? REGIMEN[reg.datos.result] ?? reg.datos.result : reg.error ? "Sin UIT" : undefined} icono={Scale} tono={reg.error ? "bad" : undefined} />
        <CifraLink titulo="Ingresos del año" valor={reg.datos ? soles(reg.datos.revenue) : undefined} detalle={reg.datos ? texto(reg.datos.revenue_source) : undefined} icono={Landmark} />
        <CifraLink titulo="Valor de la UIT" valor={fila ? soles(fila.uit_value_pen) : "—"} detalle={fila?.confirmed_by_name ? `Confirmó ${fila.confirmed_by_name}` : undefined} icono={Calculator} />
        <CifraLink titulo="Límite" valor={reg.datos?.limit ? soles(reg.datos.limit) : "—"} detalle={`${reg.datos?.threshold_uit ?? r?.threshold_uit ?? 300} UIT`} icono={Scale} />
      </div>
      {reg.error && <Alert tone="bad">{reg.error}</Alert>}
      {reg.datos && <Alert tone="info" title="Libros que se llevan">{reg.datos.books.map((b) => libros[b] ?? b).join(", ")}.</Alert>}
      <Seccion titulo="Simular con otros ingresos">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Ingresos del año" hint="Vacío usa los ingresos contabilizados"><Input inputMode="decimal" prefix="S/" value={simulado} onChange={(e) => setSimulado(e.target.value)} /></Field>
          {simulado && <Button onClick={() => setSimulado("")}>Volver a los contabilizados</Button>}
        </div>
      </Seccion>
      <DataTable rows={r?.data ?? []} rowKey={(a) => a.id} loading={!r} onRowClick={(a) => setAnio(a.year)} empty="Todavía no se carga ningún año." columns={[
        { key: "year", header: "Año", cardTitle: true, render: (a) => <span className="font-medium">{a.year}{a.year === elegido && <Badge tone="primary">Elegido</Badge>}</span> },
        { key: "uit_value_pen", header: "UIT", align: "right", render: (a) => soles(a.uit_value_pen) },
        { key: "ledger_revenue", header: "Ingresos contabilizados", align: "right", render: (a) => soles(a.ledger_revenue) },
        { key: "regime_result", header: "Resultado", render: (a) => a.regime_result ? REGIMEN[a.regime_result] ?? a.regime_result : <span className="text-muted">Según ingresos</span> },
        { key: "uit_source", header: "Fuente y confirmación", hideOnMobile: true, render: (a) => <span className="text-[12.5px]">{texto(a.uit_source) || "—"}<span className="block text-muted">{a.confirmed_by_name} · {fechaHora(a.uit_confirmed_at)}</span></span> },
        { key: "notes", header: "Notas", hideOnMobile: true, render: (a) => <span className="text-[12.5px] text-muted">{texto(a.notes) || "—"}</span> },
        ...(op?.can.close ? [{ key: "editar", header: "", render: (a: Anio) => <Button size="sm" onClick={(e) => { e.stopPropagation(); setEditar(a); }}>Editar</Button> }] : []),
      ]} />
      {editar && <FormAnio anio={editar === "nuevo" ? null : editar} onClose={() => setEditar(null)} onGuardado={() => { setEditar(null); recargar(); reg.recargar(); }} />}
    </div>
  );
}

function FormAnio({ anio, onClose, onGuardado }: { anio: Anio | null; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ year: String(anio?.year ?? new Date().getFullYear() + 1), uit_value_pen: anio?.uit_value_pen != null ? String(Number(anio.uit_value_pen)) : "",
    revenue_pen: anio?.revenue_pen != null ? String(Number(anio.revenue_pen)) : "", uit_source: texto(anio?.uit_source), notes: texto(anio?.notes) });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialogo titulo={anio ? `Año ${anio.year}` : "Cargar un año"} boton="Guardar y confirmar" onClose={onClose}
      aviso="Al guardar quedas como quien confirma el valor de la UIT del año."
      enviar={async () => {
        await api("/v1/cnt/anios", { method: "POST", body: { year: Number(f.year), uit_value_pen: num(f.uit_value_pen), revenue_pen: num(f.revenue_pen), uit_source: f.uit_source || null, notes: f.notes || null } });
        toast.ok(`Año ${f.year} guardado`); onGuardado();
      }}>
      {(e) => <>
        <Field label="Año" required error={e.year}><Input inputMode="numeric" maxLength={4} value={f.year} disabled={!!anio} onChange={set("year")} /></Field>
        <Field label="Valor de la UIT" required error={e.uit_value_pen}><Input inputMode="decimal" prefix="S/" value={f.uit_value_pen} onChange={set("uit_value_pen")} /></Field>
        <Field label="Ingresos del año" error={e.revenue_pen} hint="Vacío: se toman de las cuentas de ingresos"><Input inputMode="decimal" prefix="S/" value={f.revenue_pen} onChange={set("revenue_pen")} /></Field>
        <Field label="Fuente de la UIT" error={e.uit_source}><Input value={f.uit_source} maxLength={200} onChange={set("uit_source")} /></Field>
        <Field label="Notas" error={e.notes} className="sm:col-span-2"><Textarea value={f.notes} maxLength={500} onChange={set("notes")} /></Field>
      </>}
    </Dialogo>
  );
}
