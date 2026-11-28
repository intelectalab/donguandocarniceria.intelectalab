"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Modal, PageHeader, Select, Textarea, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { BarraCola } from "@/modulos/del/App";
import { Foto } from "@/modulos/del/Captura";
import { enviar } from "@/modulos/del/cola";
import { Dato, Seccion, TarjetaRuta, Vacio, VerArchivo, hoyLima, useDatos, useOpciones } from "@/modulos/del/comunes";
import { GASTO, R, lista, type Esperado, type Opciones, type RutaResumen } from "@/modulos/del/tipos";

type Gasto = {
  id: string; number: string; category: string; categoria: string; amount: number; paid_with: string; pagado: string; note: string | null; photo_file_id: string | null;
  fuel_gallons: number | null; voucher_no: string | null; status: string; created_at: string;
};

/** DEL-17 Gastos de la ruta: combustible, alimentación, peajes, motorizado externo; del efectivo cobrado o con dinero propio (RN-DEL-16). */
export default function Gastos() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const ruta = useSearchParams().get("ruta");
  return ruta ? <DeRuta id={ruta} /> : <Elegir />;
}

function Elegir() {
  const router = useRouter();
  const { datos, error, cargando } = useDatos<{ data: RutaResumen[] }>(`/v1/del/app/rutas?fecha=${hoyLima()}`);
  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <PageHeader description="Elige la ruta para ver o registrar sus gastos." />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.data.length ? <Vacio>No tienes rutas hoy.</Vacio> : (
        <div className="space-y-3">{datos.data.map((r) => <TarjetaRuta key={r.id} r={r} onClick={() => router.push(`${R.gastos}?ruta=${r.id}`)} />)}</div>
      )}
    </div>
  );
}

function DeRuta({ id }: { id: string }) {
  const router = useRouter();
  const { can } = useSesion();
  const op = useOpciones();
  const { datos, error, cargando, recargar } = useDatos<{ data: Gasto[]; liquidacion: Esperado | null }>(`/v1/del/app/rutas/${id}/gastos`);
  const [nuevo, setNuevo] = useState(false);
  const anula = can("del.route.plan") || can("del.cost.manage");
  const e = datos?.liquidacion;
  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push(`${R.app}?ruta=${id}`)}>Volver a la ruta</Button>
      <BarraCola onSincronizado={recargar} />
      <Button className="w-full" variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Registrar gasto</Button>
      {error && <Alert tone="bad">{error}</Alert>}
      {e && (
        <Seccion titulo="Para la liquidación">
          <Dato label="Efectivo cobrado">{soles(e.cobrado_efectivo)}</Dato>
          <Dato label="Gastos pagados del efectivo">− {soles(e.gastos_ruta)}</Dato>
          <Dato label="Efectivo a entregar">{soles(e.efectivo)}</Dato>
          {e.por_reembolsar > 0 && <Dato label="Por reembolsarte">{soles(e.por_reembolsar)}</Dato>}
        </Seccion>
      )}
      <Seccion titulo="Gastos">
        {cargando ? <Vacio>Cargando…</Vacio> : !datos?.data.length ? <Vacio>Sin gastos en esta ruta.</Vacio> : (
          <ul className="divide-y divide-line">
            {datos.data.map((g) => (
              <li key={g.id} className="flex items-start justify-between gap-3 py-2.5 text-[13.5px]">
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{g.categoria} · {soles(g.amount)} {g.status !== "ACTIVE" && <Badge tone={GASTO[g.status]?.[1]}>{GASTO[g.status]?.[0]}</Badge>}</span>
                  <span className="block text-[12.5px] text-muted">{g.number} · {g.pagado} · {fechaHora(g.created_at)}</span>
                  {(g.note || g.fuel_gallons) && <span className="block text-[12.5px] text-muted">{[g.note, g.fuel_gallons ? `${g.fuel_gallons} gal, vale ${g.voucher_no}` : null].filter(Boolean).join(" · ")}</span>}
                  {g.photo_file_id && <VerArchivo id={g.photo_file_id} texto="Ver comprobante" />}
                </span>
                {anula && g.status === "ACTIVE" && (
                  <Button size="sm" variant="ghost" onClick={async () => {
                    const c = await confirmAction({ title: `Anular ${g.number}`, danger: true, confirmLabel: "Anular", reason: { label: "Motivo", min: 3 } });
                    if (!c) return;
                    try { await api(`/v1/del/gastos/${g.id}/anular`, { method: "POST", body: { reason: c.reason } }); toast.ok("Gasto anulado."); recargar(); } catch (x) { toast.error(mensajeDe(x)); }
                  }}>Anular</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Seccion>
      {nuevo && op.datos && <FormGasto ruta={id} op={op.datos} onClose={() => setNuevo(false)} onListo={() => { setNuevo(false); recargar(); }} />}
    </div>
  );
}

function FormGasto({ ruta, op, onClose, onListo }: { ruta: string; op: Opciones; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ category: "FUEL", amount: "", paid_with: "ROUTE_CASH", note: "", fuel_gallons: "", voucher_no: "" });
  const [foto, setFoto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const comb = d.category === "FUEL";
  const pideFoto = comb || d.category === "EXT_COURIER";
  const falta = !(Number(d.amount) > 0) || (pideFoto && !foto) || (d.category === "OTHER" && !d.note.trim()) || (comb && (!(Number(d.fuel_gallons) > 0) || !d.voucher_no.trim()));
  return (
    <Modal open onClose={onClose} title="Registrar gasto" size="sm" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={falta} onClick={async () => {
          setOcupado(true);
          try {
            const r = await enviar({ type: "EXPENSE", route_id: ruta, resumen: `Gasto ${op.gastos[d.category]} ${soles(Number(d.amount))}`, payload: {
              category: d.category, amount: Number(d.amount), paid_with: d.paid_with, note: d.note || null, fuel_gallons: comb ? Number(d.fuel_gallons) : null,
              voucher_no: comb ? d.voucher_no : null, photo_data: foto } });
            toast.ok(r ? "Gasto registrado." : "Sin señal: el gasto se enviará al volver la conexión.");
            onListo();
          } catch (x) { toast.error(mensajeDe(x)); } finally { setOcupado(false); }
        }}>Registrar</Button>
      </>
    }>
      <div className="space-y-3">
        <Field label="Tipo"><Select value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} options={lista(op.gastos)} /></Field>
        <Field label="Monto (S/)" required><Input type="number" inputMode="decimal" min={0} step="0.1" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} /></Field>
        <Field label="Pagado"><Select value={d.paid_with} onChange={(e) => setD({ ...d, paid_with: e.target.value })} options={lista(op.pagado_con)} /></Field>
        {comb && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Galones" required><Input type="number" inputMode="decimal" min={0} step="0.01" value={d.fuel_gallons} onChange={(e) => setD({ ...d, fuel_gallons: e.target.value })} /></Field>
            <Field label="N.º de vale" required><Input value={d.voucher_no} onChange={(e) => setD({ ...d, voucher_no: e.target.value })} /></Field>
          </div>
        )}
        <Field label="Nota" required={d.category === "OTHER"}><Textarea rows={2} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></Field>
        <Field label="Foto del comprobante" required={pideFoto}><Foto valor={foto} onChange={setFoto} /></Field>
      </div>
    </Modal>
  );
}
