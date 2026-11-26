"use client";

import { useState } from "react";
import { ArrowLeftRight, Banknote, BookOpen, FileUp, Lock, RefreshCw, Scale } from "lucide-react";
import { Alert, Button, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import { BANCO, CifraLink, Importe, LINEA_BANCO, Seccion, accion, mesActual, nombreMes, num, opcionesCuenta, texto, useDatos, useOpcionesCnt, type Num, type OpcionesCnt } from "@/modulos/cnt/comunes";

type Conciliacion = {
  id: string; cash_account_id: string; period: string; opening_balance: Num; statement_balance: Num; status: string; file_name: string | null; imported_at: string | null;
  line_count: number; account_code: string; account_name: string; bank_name: string | null; closed_by_name: string | null; closed_at: string | null; unmatched: number;
};
type LineaBanco = { id: string; seq: number; line_date: string; description: string | null; reference: string | null; amount: Num; balance: Num; match_status: string; matched_line_id: string | null; booked_entry_number: string | null };
type LineaLibro = { id: string; date: string; amount: number; label: string; number: string; entry_id: string };
type Detalle = Conciliacion & {
  gl_account: string | null; statement: number; book: number; transit: LineaLibro[]; transit_sum: number; bank_only: LineaBanco[]; bank_only_sum: number; unexplained: number; matched: number;
  lines: LineaBanco[]; book_lines: LineaLibro[];
};

/** CNT-11 Conciliación bancaria: extracto importado, cruce con los movimientos del libro, partidas pendientes y diferencia final. */
export default function ConciliacionBancaria() {
  const op = useOpcionesCnt();
  const { datos: r, recargar } = useDatos<{ data: Conciliacion[]; accounts: { id: string; code: string; name: string; bank_name: string | null }[] }>("/v1/cnt/bancos");
  const [elegida, setElegida] = useState<string | null>(null);
  const id = elegida ?? r?.data[0]?.id ?? null;
  const det = useDatos<Detalle>(id ? `/v1/cnt/bancos/${id}` : null);
  const [importar, setImportar] = useState(false);
  const [cruzar, setCruzar] = useState<LineaBanco | null>(null);
  const [cargo, setCargo] = useState<LineaBanco | null>(null);
  const [filtro, setFiltro] = useState<"UNMATCHED" | "ALL">("UNMATCHED");
  const listo = () => { recargar(); det.recargar(); };
  const d = det.datos;
  const abierta = d?.status === "OPEN";
  const lineas = (d?.lines ?? []).filter((l) => filtro === "ALL" || l.match_status === "UNMATCHED");
  return (
    <div className="space-y-5">
      <PageHeader description="El extracto del banco frente a los movimientos de la cuenta en el libro. Lo que queda sin cruzar se explica: partidas en tránsito del libro o cargos del banco que necesitan asiento."
        actions={op?.can.prepare && <Button variant="primary" icon={FileUp} onClick={() => setImportar(true)}>Importar extracto</Button>} />
      <DataTable rows={r?.data ?? []} rowKey={(c) => c.id} loading={!r} onRowClick={(c) => setElegida(c.id)} empty="Todavía no se importa ningún extracto." columns={[
        { key: "account_name", header: "Cuenta", cardTitle: true, render: (c) => <div className={c.id === id ? "font-semibold text-primary" : ""}><p>{c.account_name}</p><p className="text-[12px] font-normal text-muted">{nombreMes(c.period)} · {c.file_name ?? "Extracto"}</p></div> },
        { key: "statement_balance", header: "Saldo del banco", align: "right", render: (c) => soles(c.statement_balance) },
        { key: "unmatched", header: "Sin cruzar", align: "right", render: (c) => c.unmatched ? <span className="text-warn">{numero(c.unmatched)}</span> : "0" },
        { key: "status", header: "Estado", render: (c) => <StatusBadge status={c.status} labels={BANCO} /> },
      ]} />
      {d && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CifraLink destacada titulo="Saldo según el banco" valor={soles(d.statement)} detalle={`${d.account_name} · ${nombreMes(d.period)}`} icono={Banknote} />
          <CifraLink titulo="Saldo según el libro" valor={soles(d.book)} detalle={d.gl_account ? `Cuenta ${d.gl_account}` : undefined} icono={BookOpen} />
          <CifraLink titulo="Partidas en tránsito" valor={soles(d.transit_sum)} detalle={`${d.transit.length} del libro sin pasar por el banco`} icono={ArrowLeftRight} />
          <CifraLink titulo="Diferencia sin explicar" valor={soles(d.unexplained)} detalle={`${numero(d.matched)} de ${numero(d.line_count)} cruzadas`} icono={Scale} tono={Math.abs(d.unexplained) > 0.005 ? "bad" : "ok"} />
        </div>
        {d.status === "CLOSED" && <Alert tone="ok" title="Conciliación cerrada">Cerrada por {d.closed_by_name ?? "—"} el {fechaHora(d.closed_at)}.</Alert>}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Seccion titulo="Movimientos del extracto" acciones={<div className="flex flex-wrap gap-2">
            <Select aria-label="Mostrar" value={filtro} onChange={(e) => setFiltro(e.target.value as "UNMATCHED" | "ALL")} options={[{ value: "UNMATCHED", label: "Sin cruzar" }, { value: "ALL", label: "Todos" }]} />
            {abierta && op?.can.prepare && <Button size="sm" icon={RefreshCw} onClick={async () => { try { await api(`/v1/cnt/bancos/${d.id}/cruzar`, { method: "POST" }); toast.ok("Cruce automático hecho"); listo(); } catch (e) { toast.error(mensajeDe(e)); } }}>Volver a cruzar</Button>}
            {abierta && op?.can.approve && <Button size="sm" icon={Lock} onClick={() => accion({ title: "¿Cerrar la conciliación?", message: Math.abs(d.unexplained) > 0.005 ? `Queda una diferencia sin explicar de ${soles(d.unexplained)}.` : "La diferencia sin explicar es cero.", confirmLabel: "Cerrar" },
              () => api(`/v1/cnt/bancos/${d.id}/cerrar`, { method: "POST" }), "Conciliación cerrada", listo)}>Cerrar</Button>}
          </div>}>
            <DataTable rows={lineas} rowKey={(l) => l.id} empty="Todo el extracto está cruzado." columns={[
              { key: "description", header: "Movimiento", cardTitle: true, render: (l) => <div className="min-w-[180px]"><p>{texto(l.description) || "—"}</p><p className="text-[12px] text-muted">{fecha(l.line_date)}{l.reference ? ` · ${l.reference}` : ""}</p></div> },
              { key: "amount", header: "Importe", align: "right", render: (l) => <Importe v={l.amount} formato={soles} /> },
              { key: "match_status", header: "Estado", render: (l) => <span><StatusBadge status={l.match_status} labels={LINEA_BANCO} />{l.booked_entry_number && <span className="block text-[12px] text-muted">{l.booked_entry_number}</span>}</span> },
              { key: "acciones", header: "", render: (l) => abierta && op?.can.prepare && l.match_status === "UNMATCHED" ? <span className="flex gap-1">
                <Button size="sm" onClick={() => setCruzar(l)}>Cruzar</Button><Button size="sm" onClick={() => setCargo(l)}>Asentar</Button></span>
                : abierta && l.match_status === "MATCHED" && op?.can.prepare ? <Button size="sm" onClick={async () => { try { await api(`/v1/cnt/bancos/lineas/${l.id}/cruzar`, { method: "POST", body: { book_line_id: null } }); toast.ok("Cruce deshecho"); listo(); } catch (e) { toast.error(mensajeDe(e)); } }}>Deshacer</Button> : null },
            ]} />
          </Seccion>
          <Seccion titulo="En tránsito (solo en el libro)">
            <DataTable rows={d.transit} rowKey={(t) => t.id} empty="No hay partidas en tránsito." columns={[
              { key: "label", header: "Movimiento", cardTitle: true, render: (t) => <div><p>{texto(t.label)}</p><p className="text-[12px] text-muted">{fecha(t.date)} · {t.number}</p></div> },
              { key: "amount", header: "Importe", align: "right", render: (t) => <Importe v={t.amount} formato={soles} /> },
            ]} />
          </Seccion>
        </div>
      </>}
      {importar && r && <Importar cuentas={r.accounts} onClose={() => setImportar(false)} onListo={(nueva) => { setImportar(false); setElegida(nueva); listo(); }} />}
      {cruzar && d && <Cruzar linea={cruzar} libro={d.transit} onClose={() => setCruzar(null)} onListo={() => { setCruzar(null); listo(); }} />}
      {cargo && op && <Cargo linea={cargo} op={op} onClose={() => setCargo(null)} onListo={() => { setCargo(null); listo(); }} />}
    </div>
  );
}

function Importar({ cuentas, onClose, onListo }: { cuentas: { id: string; code: string; name: string }[]; onClose: () => void; onListo: (id: string) => void }) {
  const [f, setF] = useState({ cash_account_id: cuentas[0]?.id ?? "", period: mesActual(), opening_balance: "", file_name: "", text: "" });
  const [error, setError] = useState("");
  const lineas = f.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => !/^fecha/i.test(l)).map((l) => {
    const c = l.split(/[|;\t]/).map((x) => x.trim());
    const iso = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(c[0] ?? "");
    return { date: iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : c[0], description: c[1] ?? "", reference: c[2] || null, amount: num(c[3] ?? "") };
  });
  const enviar = async () => {
    setError("");
    try {
      const r = await api<{ id: string }>("/v1/cnt/bancos", { method: "POST", body: { cash_account_id: f.cash_account_id, period: `${f.period}-01`, opening_balance: num(f.opening_balance), file_name: f.file_name || null, lines: lineas } });
      toast.ok(`Extracto importado: ${lineas.length} movimientos`); onListo(r.id);
    } catch (e) { const p = erroresDe(e); setError(Object.values(p)[0] ?? mensajeDe(e)); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Importar extracto" description="Una línea por movimiento: fecha | descripción | referencia | importe (negativo para cargos)."
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!lineas.length || !f.cash_account_id} onClick={enviar}>Importar y cruzar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Alert tone="bad">{error}</Alert></div>}
        <Field label="Cuenta bancaria" required><Select value={f.cash_account_id} onChange={(e) => setF({ ...f, cash_account_id: e.target.value })} options={cuentas.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Mes" required><Input type="month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></Field>
        <Field label="Saldo inicial del extracto"><Input inputMode="decimal" prefix="S/" value={f.opening_balance} onChange={(e) => setF({ ...f, opening_balance: e.target.value })} /></Field>
        <Field label="Archivo"><input type="file" accept=".csv,.txt" className="block w-full text-[13px]" onChange={async (e) => { const x = e.target.files?.[0]; if (x) setF({ ...f, file_name: x.name, text: await x.text() }); }} /></Field>
        <Field label="Movimientos" hint={lineas.length ? `${lineas.length} movimientos` : "También puedes pegarlos"} className="sm:col-span-2">
          <Textarea rows={7} className="font-mono text-[12px]" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Cruzar({ linea, libro, onClose, onListo }: { linea: LineaBanco; libro: LineaLibro[]; onClose: () => void; onListo: () => void }) {
  const monto = Number(linea.amount);
  const candidatas = [...libro].sort((a, b) => Math.abs(a.amount - monto) - Math.abs(b.amount - monto)).slice(0, 40);
  const [sel, setSel] = useState(candidatas[0]?.id ?? "");
  const enviar = async () => {
    try { await api(`/v1/cnt/bancos/lineas/${linea.id}/cruzar`, { method: "POST", body: { book_line_id: sel } }); toast.ok("Movimiento cruzado"); onListo(); } catch (e) { toast.error(mensajeDe(e)); }
  };
  return (
    <Modal open onClose={onClose} title="Cruzar con el libro" description={`${texto(linea.description)} · ${fecha(linea.line_date)} · ${soles(linea.amount)}`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!sel} onClick={enviar}>Cruzar</Button></>}>
      <Field label="Movimiento del libro" hint="Movimientos del libro aún sin cruzar, por el importe más parecido">
        <Select value={sel} onChange={(e) => setSel(e.target.value)} options={candidatas.map((b) => ({ value: b.id, label: `${fecha(b.date)} · ${soles(b.amount)} · ${texto(b.label)}` }))} />
      </Field>
    </Modal>
  );
}

function Cargo({ linea, op, onClose, onListo }: { linea: LineaBanco; op: OpcionesCnt; onClose: () => void; onListo: () => void }) {
  const [f, setF] = useState({ account_code: Number(linea.amount) < 0 ? "6391" : "7599", cost_center_id: "", brand_id: "" });
  const enviar = async () => {
    try { await api(`/v1/cnt/bancos/lineas/${linea.id}/cargo`, { method: "POST", body: { account_code: f.account_code || null, cost_center_id: f.cost_center_id || null, brand_id: f.brand_id || null } }); toast.ok("Asiento del movimiento creado, por aprobar"); onListo(); }
    catch (e) { toast.error(mensajeDe(e)); }
  };
  return (
    <Modal open onClose={onClose} title="Asentar el movimiento del banco" description={`${texto(linea.description)} · ${soles(linea.amount)}`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={enviar}>Crear asiento</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cuenta de contrapartida" className="sm:col-span-2"><Select value={f.account_code} placeholder="Elegir" onChange={(e) => setF({ ...f, account_code: e.target.value })} options={opcionesCuenta(op)} /></Field>
        <Field label="Centro de costo"><Select value={f.cost_center_id} placeholder="Ninguno" onChange={(e) => setF({ ...f, cost_center_id: e.target.value })} options={op.cost_centers.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Field>
        <Field label="Marca"><Select value={f.brand_id} placeholder="Ninguna" onChange={(e) => setF({ ...f, brand_id: e.target.value })} options={op.brands.map((b) => ({ value: b.id, label: b.name }))} /></Field>
      </div>
    </Modal>
  );
}
