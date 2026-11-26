"use client";

import { useState } from "react";
import Link from "next/link";
import { AlarmClock, Repeat, Users, Wand2 } from "lucide-react";
import { Badge, DataTable, PageHeader, buttonClass, type Column } from "@/components/ui";
import { fecha, numero } from "@/lib/formato";
import { Cifras, CifraLink, FiltroSelect, Sub, opcionesDe, qs, useDatos, useOpcionesDe, type Etiquetas } from "@/modulos/canales/comunes";
import type { Opciones } from "@/modulos/cmp/tipos";

type Fila = { customer_id: string; product_id: string; product_name: string; brand_id: string; zone_id: string | null; last: string; interval: number; own: boolean; next: string;
  over: number; status: string; purchases: number; customer_name: string | null; consent: boolean };
type Resp = { data: Fila[]; total: number; customers: number; at_risk: number };

const ESTADO_RECOMPRA: Etiquetas = { DUE: ["Le toca", "warn"], AT_RISK: ["En riesgo", "bad"] };

/** CMP-12 Recompra esperada: clientes a los que ya les tocaba volver a comprar un producto, según su propio ritmo o el promedio del producto. */
export default function Recompra() {
  const op = useOpcionesDe<Opciones>("/v1/cmp/opciones");
  const [marca, setMarca] = useState("");
  const [zona, setZona] = useState("");
  const [estado, setEstado] = useState("");
  const r = useDatos<Resp>(`/v1/cmp/recompra${qs({ brand_id: marca, zone_id: zona, status: estado })}`);
  const d = r.datos;
  const marcas = new Map((op?.brands ?? []).map((b) => [b.id, b.name]));

  const columnas: Column<Fila>[] = [
    { key: "customer_name", header: "Cliente", cardTitle: true, render: (x) => <div><p className="font-semibold">{x.customer_name ?? "—"}</p>{!x.consent && <Sub>Sin consentimiento de promociones</Sub>}</div> },
    { key: "product_name", header: "Producto", render: (x) => <div>{x.product_name}<Sub>{marcas.get(x.brand_id) ?? ""}</Sub></div> },
    { key: "last", header: "Última compra", render: (x) => <div>{fecha(x.last)}<Sub>{numero(x.purchases)} compras</Sub></div> },
    { key: "interval", header: "Compra cada", align: "right", hideOnMobile: true, render: (x) => <div>{numero(x.interval)} d<Sub>{x.own ? "su ritmo" : "promedio del producto"}</Sub></div> },
    { key: "next", header: "Le tocaba", render: (x) => <div>{fecha(x.next)}<Sub>hace {numero(x.over)} d</Sub></div> },
    { key: "status", header: "Estado", render: (x) => <Badge tone={ESTADO_RECOMPRA[x.status]?.[1] ?? "neutral"}>{ESTADO_RECOMPRA[x.status]?.[0] ?? x.status}</Badge> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Con dos o más compras de un producto se usa el ritmo del propio cliente; con una sola, el promedio de todos. Pasado un ciclo completo sin volver, el cliente queda en riesgo."
        actions={op?.can["cmp.segment.manage"] && <Link href="/m/cmp/cmp-02" className={buttonClass("primary", "md", "gap-2")}><Wand2 size={16} aria-hidden="true" />Armar segmento de recompra</Link>} />
      <Cifras cols={3}>
        <CifraLink destacada titulo="Recompras pendientes" valor={d ? numero(d.total) : undefined} detalle="Cliente y producto" icono={Repeat} onClick={() => setEstado("")} />
        <CifraLink titulo="Clientes" valor={d ? numero(d.customers) : undefined} detalle="Con al menos una pendiente" icono={Users} />
        <CifraLink titulo="En riesgo" valor={d ? numero(d.at_risk) : undefined} detalle="Más de un ciclo sin volver" icono={AlarmClock} tono={d?.at_risk ? "bad" : "ok"} onClick={() => setEstado("AT_RISK")} />
      </Cifras>
      <DataTable columns={columnas} rows={d?.data ?? []} rowKey={(x) => `${x.customer_id}:${x.product_id}`} loading={r.cargando} error={r.error} onRetry={r.recargar}
        empty="Nadie tiene una recompra pendiente con esos filtros."
        toolbar={<>
          <FiltroSelect label="Marca" value={marca} onChange={setMarca} options={(op?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))} />
          <FiltroSelect label="Zona" value={zona} onChange={setZona} options={(op?.zones ?? []).map((z) => ({ value: z.id, label: z.name }))} />
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesDe(ESTADO_RECOMPRA)} />
        </>} />
      {d && d.total > d.data.length && <p className="text-[12.5px] text-muted">Se muestran los {numero(d.data.length)} con más días de atraso, de {numero(d.total)}.</p>}
    </div>
  );
}
