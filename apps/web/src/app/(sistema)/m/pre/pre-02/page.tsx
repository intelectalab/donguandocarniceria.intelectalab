"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { Alert, Badge, Button, FiltroFecha, PageHeader, StatusBadge } from "@/components/ui";
import { fecha, kg, numero } from "@/lib/formato";
import { Imprimible, Seccion, Vacio, useDatos } from "@/modulos/pre/comunes";
import { OLA, R, hoyLima, type OlaOpcion, type OlaResumen } from "@/modulos/pre/tipos";

type Fila = {
  variant_id: string; sku: string; name: string; sale_mode: string; qty: number; kg: number; hecho: number; pedidos: string[]; cortes: string[];
  lote: string | null; vence: string | null; almacen: string | null; tipo_almacen: string | null; stock: number; sin_stock: boolean;
};
type Consolidada = { ola: OlaResumen; filas: Fila[]; cifras: { productos: number; kg: number; sin_stock: number } };

const ALMACEN: Record<string, string> = { COLD_ROOM: "Cámara", FREEZER: "Congeladora", STORE: "Mostrador", DRY: "Seco" };
const cant = (f: Fila, v: number) => (f.sale_mode === "KG" ? kg(v) : `${numero(v)} u`);

/** PRE-02 Lista consolidada: por producto y corte, cantidad, kg estimados, lote sugerido por FEFO y ubicación. */
export default function ListaConsolidada() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const ola = useSearchParams().get("ola") ?? "";
  const [dia, setDia] = useState(hoyLima());
  const olas = useDatos<OlaOpcion[]>(ola ? null : `/v1/pre/olas?fecha=${dia}`);
  const { datos: d, error, cargando } = useDatos<Consolidada>(ola ? `/v1/pre/olas/${ola}/consolidada` : null);

  return (
    <div className="space-y-5">
      <PageHeader description="Todo lo que hay que sacar de cámara y congeladora para la ola, sumado por producto, con el lote que toca por FEFO."
        actions={d && <Button variant="primary" icon={Printer} onClick={() => window.print()}>Imprimir</Button>} />

      {!ola ? (
        <Seccion titulo="Elige la ola">
          <div className="mb-3"><FiltroFecha etiqueta="Fecha de entrega" value={dia} onChange={(v) => setDia(v || hoyLima())} /></div>
          {olas.cargando ? <Vacio>Cargando…</Vacio> : !olas.datos?.length ? <Vacio>No hay olas para esta fecha. Créalas en el planificador.</Vacio> : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {olas.datos.map((w) => (
                <li key={w.id}>
                  <button type="button" onClick={() => router.push(`${R.consolidada}?ola=${w.id}`)} className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-2">
                    <span className="text-[13.5px] text-ink">{w.etiqueta}</span>
                    <StatusBadge status={w.status} labels={OLA} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      ) : cargando ? <Vacio>Cargando…</Vacio> : error || !d ? <Alert tone="bad">{error || "No se encontró la ola."}</Alert> : (
        <>
          <Seccion>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2"><span className="text-[16px] font-bold text-ink">{d.ola.number}</span><StatusBadge status={d.ola.status} labels={OLA} /></div>
                <p className="text-[12.5px] text-muted">{d.ola.local} · {fecha(d.ola.wave_date)} · franja {d.ola.franja} · {d.ola.pedidos} pedido(s)</p>
              </div>
              <div className="flex flex-wrap gap-2 text-[12.5px]">
                <Badge>{d.cifras.productos} productos</Badge>
                <Badge>{kg(d.cifras.kg)} estimados</Badge>
                {d.cifras.sin_stock > 0 && <Badge tone="bad">{d.cifras.sin_stock} sin stock suficiente</Badge>}
              </div>
            </div>
            <div className="mt-3"><Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => router.push(R.consolidada)}>Otra ola</Button></div>
          </Seccion>

          {d.filas.length === 0 ? <Vacio>La ola no tiene líneas.</Vacio> : (
            <>
              <ul className="space-y-2 md:hidden">
                {d.filas.map((f) => (
                  <li key={f.variant_id} className={`rounded-xl border bg-surface p-3 ${f.sin_stock ? "border-bad" : "border-line"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-ink">{f.name}</p>
                        <p className="font-mono text-[11.5px] text-muted">{f.sku}</p>
                      </div>
                      <p className="text-right text-[15px] font-bold text-ink">{cant(f, f.qty)}</p>
                    </div>
                    <p className="mt-1 text-[12.5px] text-ink">Lote <b>{f.lote ?? "—"}</b>{f.vence ? ` · vence ${fecha(f.vence)}` : ""} · {f.almacen ?? "—"} {f.tipo_almacen ? `(${ALMACEN[f.tipo_almacen] ?? f.tipo_almacen})` : ""}</p>
                    <p className="text-[12px] text-muted">{f.sale_mode !== "KG" && f.kg ? `${kg(f.kg)} estimados · ` : ""}armado {cant(f, f.hecho)} · {f.pedidos.join(", ")}</p>
                    {f.cortes.length > 0 && <p className="text-[12px] text-warn">Cortes: {f.cortes.join(" · ")}</p>}
                    {f.sin_stock && <p className="text-[12px] font-semibold text-bad">Stock disponible {cant(f, f.stock)}: no alcanza</p>}
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface md:block">
                <Tabla filas={d.filas} />
              </div>
            </>
          )}

          <Imprimible>
            <h1 className="text-[16px] font-bold text-black">Lista consolidada · {d.ola.number}</h1>
            <p className="mb-2 text-[11px] text-black">{d.ola.local} · {fecha(d.ola.wave_date)} · franja {d.ola.franja} · {d.ola.pedidos} pedido(s) · {kg(d.cifras.kg)}</p>
            <Tabla filas={d.filas} impresa />
          </Imprimible>
        </>
      )}
    </div>
  );
}

function Tabla({ filas, impresa }: { filas: Fila[]; impresa?: boolean }) {
  const td = impresa ? "border border-black px-1.5 py-1 align-top" : "px-3 py-2 align-top";
  return (
    <table className={`w-full ${impresa ? "border-collapse text-[11px] text-black" : "text-[13px]"}`}>
      <thead>
        <tr className={impresa ? "" : "border-b border-line text-left text-[12px] text-muted"}>
          {["Ubicación", "Producto", "Cantidad", "Kg est.", "Lote FEFO", "Vence", "Pedidos", impresa ? "✓" : "Armado"].map((h) => (
            <th key={h} className={`${td} text-left font-medium`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className={impresa ? "" : "divide-y divide-line"}>
        {filas.map((f) => (
          <tr key={f.variant_id} className={!impresa && f.sin_stock ? "bg-bad-soft" : ""}>
            <td className={td}>{f.almacen ?? "—"}{f.tipo_almacen ? <span className={impresa ? "" : "block text-[11.5px] text-muted"}> {ALMACEN[f.tipo_almacen] ?? f.tipo_almacen}</span> : null}</td>
            <td className={td}>
              <span className="font-medium">{f.name}</span> <span className={impresa ? "" : "text-[11.5px] text-muted"}>{f.sku}</span>
              {f.cortes.length > 0 && <span className={`block ${impresa ? "" : "text-[12px] text-warn"}`}>Cortes: {f.cortes.join(" · ")}</span>}
              {f.sin_stock && <span className={`block ${impresa ? "font-bold" : "text-[12px] font-semibold text-bad"}`}>Sin stock suficiente (hay {cant(f, f.stock)})</span>}
            </td>
            <td className={`${td} font-semibold whitespace-nowrap`}>{cant(f, f.qty)}</td>
            <td className={`${td} whitespace-nowrap`}>{f.kg ? kg(f.kg) : "—"}</td>
            <td className={`${td} font-mono`}>{f.lote ?? "—"}</td>
            <td className={`${td} whitespace-nowrap`}>{fecha(f.vence)}</td>
            <td className={td}>{f.pedidos.join(", ")}</td>
            <td className={`${td} whitespace-nowrap`}>{impresa ? "" : cant(f, f.hecho)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
