"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, FileMinus } from "lucide-react";
import { Alert, Button, Checkbox, Field, Input, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { AlComprobante, ElegirComprobante, Seccion, Vacio, useDatos } from "@/modulos/fac/comunes";
import { CANTIDAD, n, type Motivos } from "@/modulos/fac/tipos";


const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const POR_LINEA = ["05", "06", "07", "09"];
const TODO = ["01", "02", "06"];

/** FAC-05 Nota de crédito: contra una factura o boleta, motivo del catálogo 09, líneas o monto, y reingreso de stock si es devolución. */
export default function NotaCredito() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return (
    <div className="space-y-4">
      <PageHeader description="Corrige, descuenta o devuelve una factura o boleta ya emitida. La nota toma el mismo cliente y no puede pasar el saldo disponible del comprobante." />
      {id ? <Formulario key={id} id={id} /> : <ElegirComprobante ruta="/m/fac/fac-05" vacio="No hay facturas ni boletas vigentes con esa búsqueda." />}
    </div>
  );
}

function Formulario({ id }: { id: string }) {
  const router = useRouter();
  const { can } = useSesion();
  const { datos: m, error, cargando } = useDatos<Motivos>(`/v1/fac/comprobantes/${id}/notas`);
  const [codigo, setCodigo] = useState("");
  const [cant, setCant] = useState<Record<string, string>>({});
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [reingresa, setReingresa] = useState(true);
  const [almacen, setAlmacen] = useState("");
  const [enviando, setEnviando] = useState(false);

  if (cargando) return <Vacio>Cargando el comprobante…</Vacio>;
  if (error || !m) return <Alert tone="bad">{error || "No se encontró el comprobante."}</Alert>;
  const d = m.documento;
  const vigente = d.status === "ISSUED" && d.sunat_status !== "REJECTED" && ["INVOICE", "RECEIPT"].includes(d.doc_type);
  const ya = m.acreditado_por_linea ?? {};
  const porLinea = POR_LINEA.includes(codigo);
  const esPeso = codigo === m.peso;
  const devolucion = m.devolucion.includes(codigo);
  const lineas = m.lineas.filter((l) => !esPeso || l.uom_code === "KGM").map((l) => {
    const queda = Math.max(0, Number((n(l.qty) - n(ya[l.id])).toFixed(3)));
    const valor = cant[l.id] ?? "";
    // En peso, la persona escribe el peso real y se acredita la diferencia.
    const q = esPeso ? (valor === "" ? 0 : Math.max(0, Number((n(l.qty) - Number(valor)).toFixed(3)))) : Number(valor || 0);
    const importe = r2(n(l.total) * q / n(l.qty));
    return { ...l, queda, valor, q, importe };
  });
  const total = porLinea ? r2(lineas.reduce((s, l) => s + l.importe, 0)) : r2(Number(monto || 0));
  const excede = total > n(m.disponible_nc) + 0.005;
  const malas = porLinea && lineas.some((l) => (esPeso ? l.valor !== "" && (Number(l.valor) < 0 || Number(l.valor) >= n(l.qty)) : l.q > l.queda + 0.0005));
  const listo = vigente && codigo && total > 0 && !excede && !malas && motivo.trim().length >= 5 && Boolean(m.serie_nc);

  function elegir(c: string) {
    setCodigo(c);
    setCant(TODO.includes(c) ? Object.fromEntries(m!.lineas.map((l) => [l.id, String(Math.max(0, Number((n(l.qty) - n(ya[l.id])).toFixed(3))))])) : {});
    if (c === "01" || c === "02") setMonto(String(n(m!.disponible_nc)));
    if (!motivo) setMotivo(m!.cat09[c] ?? "");
  }

  async function emitir() {
    setEnviando(true);
    try {
      let nota: { id: string; full_number: string };
      if (esPeso) {
        nota = await api(`/v1/fac/comprobantes/${id}/nota-peso`, { method: "POST", body: {
          claims: lineas.filter((l) => l.valor !== "" && l.q > 0).map((l) => ({ line_id: l.id, real_kg: Number(l.valor) })), reason: motivo.trim(),
        } });
      } else {
        nota = await api(`/v1/fac/comprobantes/${id}/nota-credito`, { method: "POST", body: {
          reason_code: codigo, reason: motivo.trim(),
          ...(porLinea ? { lines: lineas.filter((l) => l.q > 0).map((l) => ({ line_id: l.id, qty: l.q })) } : { amount: Number(monto) }),
          restock: devolucion && porLinea && d.order_id ? reingresa : false, warehouse_id: devolucion && reingresa && almacen ? almacen : undefined,
        } });
      }
      toast.ok(`Se emitió la nota de crédito ${nota.full_number}.`);
      router.push(`/m/fac/fac-04?id=${nota.id}`);
    } catch (e) {
      toast.error(mensajeDe(e));
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push(`/m/fac/fac-04?id=${id}`)}>Volver al comprobante</Button>
      {!vigente && <Alert tone="bad">{d.full_number} está {d.status === "VOIDED" ? "anulado" : "rechazado por SUNAT"}: no admite notas.</Alert>}
      {!can("fac.credit_note.issue") && <Alert tone="warn">Tu rol no emite notas de crédito.</Alert>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        <div className="min-w-0 space-y-4">
          <Seccion titulo="Comprobante que modifica">
            <p className="text-[13.5px]"><AlComprobante id={d.id}>{d.full_number}</AlComprobante> · {m.tipo} · {d.customer_name}</p>
            <p className="text-[12.5px] text-muted">Total {soles(d.total)} · ya acreditado {soles(m.acreditado)} · disponible <span className="font-semibold text-ink">{soles(m.disponible_nc)}</span></p>
          </Seccion>

          <Seccion titulo="Motivo (catálogo 09)">
            <Select value={codigo} onChange={(e) => elegir(e.target.value)} placeholder="Elige el motivo"
              options={Object.entries(m.cat09).map(([value, label]) => ({ value, label: `${value} · ${label}` }))} />
          </Seccion>

          {codigo && porLinea && (
            <Seccion titulo={esPeso ? "Peso real por línea" : devolucion ? "Lo que se devuelve" : "Líneas"}>
              {esPeso && <p className="mb-2 text-[12.5px] text-muted">Escribe el peso real que recibió el cliente: se acredita la diferencia al precio por kg facturado.</p>}
              {!lineas.length && <Vacio>{esPeso ? "El comprobante no tiene líneas vendidas por kg." : "Sin líneas."}</Vacio>}
              <div className="space-y-2">
                {lineas.map((l) => (
                  <div key={l.id} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,1fr)_150px_110px] sm:items-end">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium">{l.description}</p>
                      <p className="text-[12px] text-muted">Facturado {CANTIDAD(l.qty, l.uom_code)} × {soles(l.unit_price)}{n(ya[l.id]) > 0 ? ` · ya acreditado ${CANTIDAD(ya[l.id], l.uom_code)}` : ""}</p>
                    </div>
                    <Field label={esPeso ? "Peso real (kg)" : `Cantidad (queda ${l.uom_code === "KGM" ? numero(l.queda, 3) : numero(l.queda)})`}
                      error={esPeso ? (l.valor !== "" && Number(l.valor) >= n(l.qty) ? "Debe ser menor al facturado" : undefined) : l.q > l.queda + 0.0005 ? "Pasa lo que queda" : undefined}>
                      <Input type="number" inputMode="decimal" min={0} step={l.uom_code === "KGM" ? "0.001" : "1"} value={l.valor} onChange={(e) => setCant({ ...cant, [l.id]: e.target.value })} />
                    </Field>
                    <div className="pb-2 text-right"><span className="block text-[11.5px] text-muted">Importe</span><span className="font-semibold tabular-nums">{soles(l.importe)}</span></div>
                  </div>
                ))}
              </div>
            </Seccion>
          )}

          {codigo && !porLinea && (
            <Seccion titulo="Importe">
              <Field label="Monto de la nota (con IGV)" hint={`Hasta ${soles(m.disponible_nc)}.`} error={excede ? "Pasa el disponible del comprobante." : undefined}>
                <Input type="number" inputMode="decimal" min={0} step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} />
              </Field>
            </Seccion>
          )}

          {codigo && devolucion && porLinea && !d.order_id && (
            <Alert tone="info">Este comprobante no viene de un pedido: no se sabe de qué lote salió el producto. Si vuelve al almacén, regístralo en Almacén con un ajuste.</Alert>
          )}
          {codigo && devolucion && porLinea && d.order_id && (
            <Seccion titulo="Reingreso de stock">
              <Checkbox checked={reingresa} onChange={setReingresa} label="El producto vuelve al almacén" hint="Con el mismo lote y costo de la venta. Por defecto al almacén de devoluciones, para su revisión." />
              {reingresa && m.almacenes.length > 0 && (
                <div className="mt-3 max-w-sm">
                  <Field label="Almacén">
                    <Select value={almacen || m.almacenes[0].id} onChange={(e) => setAlmacen(e.target.value)} options={m.almacenes.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
                  </Field>
                </div>
              )}
            </Seccion>
          )}
        </div>

        <Seccion titulo="Nota de crédito" className="h-fit">
          <div className="space-y-3">
            <p className="text-[13px] text-muted">Serie: <span className="font-semibold text-ink">{m.serie_nc ?? "sin serie vigente"}</span></p>
            {!m.serie_nc && <Alert tone="bad">No hay serie de nota de crédito para esta marca y local. Créala en Series (FAC-10).</Alert>}
            <Field label="Sustento" hint="Sale en la nota y en el XML (al menos 5 letras).">
              <Textarea rows={3} value={motivo} maxLength={255} onChange={(e) => setMotivo(e.target.value)} />
            </Field>
            {excede && <Alert tone="bad">La nota ({soles(total)}) pasa el disponible del comprobante ({soles(m.disponible_nc)}).</Alert>}
            <div className="flex items-baseline justify-between border-t border-line pt-3"><span className="text-muted">Total de la nota</span><span className="text-[20px] font-bold tabular-nums">{soles(total)}</span></div>
            <Button variant="primary" icon={FileMinus} className="w-full" disabled={!listo || !can("fac.credit_note.issue")} loading={enviando} onClick={emitir}>Emitir nota de crédito</Button>
          </div>
        </Seccion>
      </div>
    </div>
  );
}
