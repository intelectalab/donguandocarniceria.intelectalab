"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge, Button, DataTable, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { fecha, numero, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { FiltroSelect, useOpcionesPro } from "@/modulos/pro/comunes";
import { ESPECIE, ESTADO_PLANTILLA, opciones, opcionesDe, type Num } from "@/modulos/pro/tipos";

type Fila = { id: string; code: string; name: string; species: string; version: number; status: string; mass_balance_tolerance_pct: Num; activated_at: string | null;
  input_sku: string; input_variant_name: string; brand_name: string | null; cuts: number; yield_sum: Num; orders: number };

/** DES-01 Plantillas de despiece: por especie, con sus cortes y rendimientos estándar; una versión activa por plantilla (RN-DES-01). */
export default function Plantillas() {
  const { puede } = useSesion();
  const router = useRouter();
  const op = useOpcionesPro();
  const [estado, setEstado] = useState("");
  const [especie, setEspecie] = useState("");
  const lista = useListado<Fila>("/v1/des/plantillas", { orden: "species", filtros: { status: estado, species: especie } });
  const columnas: Column<Fila>[] = [
    { key: "code", header: "Código", sortable: true, render: (t) => <span className="font-mono font-semibold">{t.code}</span> },
    { key: "name", header: "Plantilla", sortable: true, cardTitle: true, render: (t) => <div className="min-w-[180px]"><p className="font-medium">{t.name}</p><p className="text-[12px] text-muted">Entra {t.input_variant_name} · {t.brand_name ?? ""}</p></div> },
    { key: "species", header: "Especie", sortable: true, render: (t) => ESPECIE[t.species] ?? t.species },
    { key: "version", header: "Versión", align: "right", sortable: true, render: (t) => `v${t.version}` },
    { key: "cuts", header: "Cortes", align: "right" },
    { key: "yield_sum", header: "Suma de rendimientos", align: "right", render: (t) => Math.abs(Number(t.yield_sum) - 100) < 0.01 ? porcentaje(t.yield_sum, 1) : <Badge tone="bad">{porcentaje(t.yield_sum, 2)}</Badge> },
    { key: "mass_balance_tolerance_pct", header: "Tolerancia del balance", align: "right", hideOnMobile: true, render: (t) => `±${numero(t.mass_balance_tolerance_pct, 1)} %` },
    { key: "orders", header: "Despieces", align: "right", sortable: true },
    { key: "activated_at", header: "Activa desde", hideOnMobile: true, sortable: true, render: (t) => fecha(t.activated_at) },
    { key: "status", header: "Estado", sortable: true, render: (t) => <StatusBadge status={t.status} labels={ESTADO_PLANTILLA} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Cada especie se despieza con su plantilla: los cortes principales, subproductos y merma suman 100 %. Una plantilla usada en despieces no se edita: se crea su nueva versión."
        actions={op?.can.template && puede("DES", "C") && <Button variant="primary" icon={Plus} onClick={() => router.push("/m/des/des-02?nueva=1")}>Nueva plantilla</Button>} />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(t) => router.push(`/m/des/des-02?id=${t.id}`)} empty="No hay plantillas con esos filtros."
        search={{ ...lista.tabla.search, placeholder: "Buscar código, nombre o especie…" }}
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesDe(ESTADO_PLANTILLA)} />
          <FiltroSelect label="Especie" value={especie} onChange={setEspecie} options={opciones(ESPECIE)} />
        </>} />
    </div>
  );
}
