"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { Alert, Button, DataTable, DetailList, PageHeader, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Seccion, TablaAplicar, Vacio, aplicacionesDe, n, r2, useDatos, type DetalleCobro, type FilaCobro } from "@/modulos/caj/comunes";

/** CAJ-04 Aplicar cobro: reparte lo que queda de un cobro entre los pedidos y comprobantes del mismo cliente. */
export default function AplicarCobro() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return (
    <div className="space-y-4">
      <PageHeader description="Cobros con monto sin aplicar. El cobro se aplica a pedidos o comprobantes del mismo cliente, sin pasar lo que falta pagar de cada uno." />
      {id ? <Aplicar key={id} id={id} /> : <Lista />}
    </div>
  );
}

function Lista() {
  const router = useRouter();
  const { marca } = useSesion();
  const lista = useListado<FilaCobro>("/v1/caj/cobros", { orden: "-paid_at", filtros: { sin_aplicar: 1, estado: "CONFIRMED", marca: marca !== "ALL" ? marca : "" } });
  const columnas: Column<FilaCobro>[] = [
    { key: "number", header: "Cobro", sortable: true, cardTitle: true, render: (p) => <div><div className="font-medium">{p.number}</div><div className="text-[12px] text-muted">{fechaHora(p.paid_at)}</div></div> },
    { key: "cliente", header: "Cliente", render: (p) => p.cliente ?? "—" },
    { key: "medio", header: "Medio", render: (p) => <span className="text-[13px]">{p.medio_nombre}<span className="block text-[12px] text-muted">{p.cuenta_code}</span></span> },
    { key: "amount", header: "Monto", sortable: true, align: "right", render: (p) => soles(p.amount) },
    { key: "libre", header: "Sin aplicar", align: "right", render: (p) => <span className="font-semibold text-warn tabular-nums">{soles(Math.max(0, n(p.amount) - n(p.aplicado) - n(p.to_balance)))}</span> },
  ];
  return (
    <DataTable {...lista.tabla} columns={columnas} onRowClick={(p) => router.push(`/m/caj/caj-04?id=${p.id}`)}
      search={{ ...lista.tabla.search, placeholder: "Cobro, operación o cliente…" }} empty="Todos los cobros están aplicados." />
  );
}

function Aplicar({ id }: { id: string }) {
  const router = useRouter();
  const { can, puede } = useSesion();
  const { datos: p, error, cargando, recargar } = useDatos<DetalleCobro>(`/v1/caj/cobros/${id}`);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const volver = <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push("/m/caj/caj-04")}>Cobros sin aplicar</Button>;

  if (cargando) return <Vacio>Cargando el cobro…</Vacio>;
  if (error || !p) return <>{volver}<Alert tone="bad">{error || "No se encontró el cobro."}</Alert></>;

  const disponible = r2(p.sin_aplicar);
  const aplicaciones = aplicacionesDe(valores);
  const usado = r2(aplicaciones.reduce((s, a) => s + a.amount, 0));
  const permitido = can("caj.payment.register") && puede("CAJ", "C");

  async function aplicar() {
    setEnviando(true);
    try {
      await api(`/v1/caj/cobros/${id}/aplicar`, { method: "POST", body: { applications: aplicaciones } });
      toast.ok(`Se aplicaron ${soles(usado)} del cobro ${p!.number}.`);
      setValores({});
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      {volver}
      <div className="grid gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(0,1.6fr)]">
        <Seccion titulo={`Cobro ${p.number}`}>
          <DetailList items={[
            { label: "Cliente", value: p.cliente },
            { label: "Medio", value: `${p.medio_nombre} · ${p.cuenta}` },
            { label: "Fecha", value: fechaHora(p.paid_at) },
            { label: "Operación", value: p.reference ?? "—" },
            { label: "Monto", value: soles(p.amount) },
            { label: "Ya aplicado", value: soles(p.aplicado) },
          ]} />
          <div className={`mt-3 rounded-lg px-3 py-2 text-[14px] font-semibold ${disponible > 0.004 ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"}`}>
            {disponible > 0.004 ? `Queda por aplicar ${soles(disponible)}` : "El cobro está todo aplicado."}
          </div>
        </Seccion>
        <Seccion titulo="Aplicar a">
          {p.status !== "CONFIRMED" ? <Alert tone="bad">El cobro está revertido: no se aplica.</Alert>
            : disponible <= 0.004 ? <Vacio>No queda nada por aplicar.</Vacio>
            : !p.pendientes ? <Vacio>Cargando…</Vacio>
            : (
              <div className="space-y-3">
                <TablaAplicar pendientes={p.pendientes} disponible={disponible} valores={valores} onChange={setValores} />
                {!permitido && <Alert tone="info">Tu rol puede ver este cobro, pero no aplicarlo.</Alert>}
                <div className="flex justify-end">
                  <Button variant="primary" icon={Check} loading={enviando} disabled={!permitido || !aplicaciones.length || usado > disponible + 0.004} onClick={aplicar}>
                    Aplicar {soles(usado)}
                  </Button>
                </div>
              </div>
            )}
        </Seccion>
      </div>
    </div>
  );
}
