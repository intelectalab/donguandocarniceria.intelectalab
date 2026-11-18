"use client";

import { use, useEffect, useState } from "react";
import { BadgePercent, Receipt, Scale, Tag } from "lucide-react";
import { Alert, Badge, Cifra, DataTable, Field, Input, PageHeader, Select, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, kg, numero, soles } from "@/lib/formato";
import { CANALES, TIPOS_CLIENTE, etiqueta, type Simulacion, type Variante } from "@/modulos/cat/tipos";

type Fila = Simulacion["traza"][number];
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });

/** CAT-07 Simulador de precio (RN-CAT-05): qué lista y qué precio elegiría el sistema, y por qué. ?variant_id= la preselecciona. */
export default function Simulador({ searchParams }: PageProps<"/m/cat/cat-07">) {
  const params = use(searchParams);
  const [buscar, setBuscar] = useState("");
  const [variantes, setVariantes] = useState<Variante[]>([]);
  const [caso, setCaso] = useState({
    variant_id: typeof params.variant_id === "string" ? params.variant_id : "", canal: "WHATSAPP", tipo_cliente: "RESTAURANT", fecha: hoy(), cantidad: "2",
  });
  const [r, setR] = useState<Simulacion | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    const q = new URLSearchParams({ status: "ACTIVE", per_page: "100", q: buscar });
    api<{ data: Variante[] }>(`/v1/cat/variantes?${q}`).then((d) => {
      if (!vigente) return;
      const vendibles = d.data.filter((v) => v.sellable);
      setVariantes(vendibles);
      setCaso((c) => c.variant_id ? c : { ...c, variant_id: (vendibles.find((v) => v.sku === "DG-CON-DES") ?? vendibles[0])?.id ?? "" });
    }).catch(() => {});
    return () => { vigente = false; };
  }, [buscar]);

  useEffect(() => {
    if (!caso.variant_id || !caso.fecha) return;
    let vigente = true;
    const q = new URLSearchParams({ ...caso, cantidad: caso.cantidad || "0" });
    api<Simulacion>(`/v1/cat/simulador?${q}`).then((d) => { if (vigente) { setR(d); setError(""); } })
      .catch((err) => vigente && setError(mensajeDe(err)));
    return () => { vigente = false; };
  }, [caso]);

  const set = (k: keyof typeof caso) => (valor: string) => setCaso((c) => ({ ...c, [k]: valor }));
  const e = r?.elegido;
  const porKg = e?.basis === "KG";
  const v = r?.variante;

  const columnas: Column<Fila>[] = [
    { key: "lista", header: "Lista", cardTitle: true, render: (t) => (
      <div className="flex min-w-[200px] items-center gap-2">{t.elegida && <Badge tone="ok">Elegida</Badge>}<span className={t.aplica ? "" : "text-muted"}>{t.list_name}</span></div>
    ) },
    { key: "priority", header: "Prioridad", align: "right", render: (t) => <span className="tabular-nums">{t.priority}</span> },
    { key: "criterios", header: "Criterios", align: "right", hideOnMobile: true, render: (t) => <span className="tabular-nums">{t.criterios}</span> },
    { key: "porque", header: "Resultado", render: (t) => <span className={t.aplica ? "" : "text-muted"}>{t.porque}</span> },
    { key: "price", header: "Precio", align: "right", render: (t) => t.price !== null
      ? <span className="whitespace-nowrap tabular-nums">{soles(t.price)}{t.basis === "KG" ? "/kg" : ""}{t.min_qty ? <span className="text-muted"> (desde {numero(t.min_qty, 2)})</span> : null}</span>
      : <span className="text-muted">—</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Dado canal, marca, tipo de cliente, fecha y cantidad, muestra la lista y el precio que el sistema elegiría y por qué (RN-CAT-05)." />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <section className="space-y-4 rounded-[14px] border border-line bg-surface p-4">
          <h2 className="text-[15px] font-semibold">Caso</h2>
          <Field label="Buscar variante"><Input value={buscar} onChange={(ev) => setBuscar(ev.target.value)} placeholder="SKU o nombre…" /></Field>
          <Field label="Variante" required>
            <Select value={caso.variant_id} onChange={(ev) => set("variant_id")(ev.target.value)} placeholder="Elige la variante"
              options={variantes.map((x) => ({ value: x.id, label: `${x.sku} · ${x.name}` }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Canal" required><Select value={caso.canal} onChange={(ev) => set("canal")(ev.target.value)} options={CANALES} /></Field>
            <Field label="Tipo de cliente" required><Select value={caso.tipo_cliente} onChange={(ev) => set("tipo_cliente")(ev.target.value)} options={TIPOS_CLIENTE} /></Field>
            <Field label="Fecha" required><Input type="date" value={caso.fecha} onChange={(ev) => set("fecha")(ev.target.value)} /></Field>
            <Field label={`Cantidad (${v?.sale_mode === "KG" ? "kg" : "u"})`} required>
              <Input type="number" step="0.001" min={0} value={caso.cantidad} onChange={(ev) => set("cantidad")(ev.target.value)} />
            </Field>
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          {error && <Alert tone="bad">{error}</Alert>}
          {r && (e ? <>
            <div className="grid grid-cols-2 gap-3">
              <Cifra titulo="Precio elegido" icono={Tag} destacada valor={`${soles(e.price)}${porKg ? "/kg" : ""}`} detalle={e.list_name} />
              <Cifra titulo={porKg ? "Peso estimado" : "Cantidad"} icono={Scale}
                valor={porKg ? kg(r.kg_estimado ?? Number(caso.cantidad)) : `${numero(Number(caso.cantidad))} u`}
                detalle={v?.sale_mode === "UNIT_VARIABLE_WEIGHT" ? `${numero(Number(caso.cantidad))} u × ${numero(v.nominal_weight_kg, 3)} kg nominal` : undefined} />
              <Cifra titulo="Importe estimado" icono={Receipt} valor={soles(r.importe_estimado)} detalle={porKg ? "Se cobra con el peso real" : undefined} />
              <Cifra titulo="Admite descuento" icono={BadgePercent} valor={r.admite_descuento ? "Sí" : "No"} detalle="RN-CAT-10" />
            </div>
            <Alert tone="ok"><b>Por qué:</b> {e.reason}.</Alert>
          </> : (
            <Alert tone="bad">RN-CAT-05: {v?.name} no tiene precio vigente para {etiqueta(CANALES, caso.canal)} · {etiqueta(TIPOS_CLIENTE, r.tipo_cliente)} el {fecha(caso.fecha)}: no se puede vender en ese canal.</Alert>
          ))}
          {r?.aviso_cantidad && <Alert tone="warn">{r.aviso_cantidad}</Alert>}
          <div>
            <h2 className="mb-2 text-[15px] font-semibold">Listas evaluadas en orden</h2>
            <DataTable columns={columnas} rows={r?.traza ?? []} rowKey={(t) => t.list_id} loading={!r && !error} empty="No hay listas para la marca de esta variante." />
          </div>
        </section>
      </div>
    </div>
  );
}
