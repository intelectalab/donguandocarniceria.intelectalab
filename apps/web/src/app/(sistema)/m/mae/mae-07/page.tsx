"use client";

import { useMemo, useState } from "react";
import { Alert, Badge, Button, DataTable, Field, Input, PageHeader, Select, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { hoyLima, ordenarFilas, useDatos } from "@/modulos/mae/tipos";

type Item = { id: string; catalog: string; code: string; description: string; valid_from: string; valid_to: string | null; vigente: boolean };
type Datos = { catalogo: string; catalogos: { code: string; name: string }[]; items: Item[] };

/**
 * MAE-07 Catálogos SUNAT: consulta de los catálogos de la facturación electrónica con su vigencia. Son globales y de
 * solo lectura para la empresa; los actualiza Intelectalab por importación (RN-MAE-11). Un código se usa solo si está
 * vigente en la fecha del documento (RN-MAE-12).
 */
export default function CatalogosSunat() {
  const [catalogo, setCatalogo] = useState("01");
  const [busca, setBusca] = useState("");
  const [orden, setOrden] = useState("");
  const { datos, error } = useDatos<Datos>(`/v1/mae/sunat?catalogo=${catalogo}`);
  const filas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const vistas = (datos?.items ?? []).filter((x) => !t || x.code.toLowerCase().includes(t) || x.description.toLowerCase().includes(t));
    return ordenarFilas(vistas, orden, (x, c) => (c === "valid_to" ? x.valid_to ?? "9999-12-31" : c === "vigente" ? (x.vigente ? 0 : 1) : (x as unknown as Record<string, string>)[c]));
  }, [datos, busca, orden]);

  const columnas: Column<Item>[] = [
    { key: "code", header: "Código", sortable: true, render: (x) => <span className="font-mono text-[12.5px]">{x.code}</span> },
    { key: "description", header: "Descripción", cardTitle: true, sortable: true },
    { key: "valid_from", header: "Vigente desde", sortable: true, render: (x) => fecha(x.valid_from) },
    { key: "valid_to", header: "Hasta", sortable: true, render: (x) => (x.valid_to ? fecha(x.valid_to) : "Sin fin") },
    { key: "vigente", header: "Hoy", sortable: true, render: (x) => (x.vigente ? <Badge tone="ok">Vigente</Badge> : <Badge tone="bad">No vigente</Badge>) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Catálogos de la facturación electrónica con su vigencia. Son de todo el sistema y de solo lectura: los actualiza Intelectalab cuando SUNAT los cambia." />
      {error && <Alert tone="bad">{error}</Alert>}

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Catálogo">
        {(datos?.catalogos ?? []).map((c) => (
          <button key={c.code} type="button" role="tab" aria-selected={c.code === catalogo} onClick={() => { setCatalogo(c.code); setBusca(""); }}
            className={`cursor-pointer rounded-full border px-3 py-1 text-[12.5px] ${c.code === catalogo ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface hover:bg-surface-2"}`}>
            {c.code} · {c.name}
          </button>
        ))}
      </div>

      <DataTable columns={columnas} rows={filas} loading={!datos && !error} empty="No hay códigos con esa búsqueda." sort={orden} onSortChange={setOrden}
        toolbar={
          <div className="w-full sm:w-[260px]">
            <Input aria-label="Buscar código o descripción" placeholder="Buscar código o descripción…" value={busca} onChange={(e) => setBusca(e.target.value)}
              className="!min-h-9 h-9 py-1.5 text-[13px]" />
          </div>
        } />

      {datos && <Validar catalogos={datos.catalogos} />}
    </div>
  );
}

/** RN-MAE-12: ¿se puede usar este código en un documento de esa fecha? */
function Validar({ catalogos }: { catalogos: Datos["catalogos"] }) {
  const [v, setV] = useState({ catalogo: catalogos.some((c) => c.code === "20") ? "20" : catalogos[0]?.code ?? "", codigo: "", fecha: hoyLima() });
  const [r, setR] = useState<{ ok: boolean; texto: string } | null>(null);
  async function validar() {
    try {
      const x = await api<{ descripcion: string }>(`/v1/mae/sunat/validar?catalogo=${v.catalogo}&codigo=${encodeURIComponent(v.codigo.trim())}&fecha=${v.fecha}`);
      setR({ ok: true, texto: `Código ${v.codigo.trim()} vigente el ${fecha(v.fecha)}: ${x.descripcion}.` });
    } catch (e) {
      setR({ ok: false, texto: mensajeDe(e) });
    }
  }
  const cambiar = (c: Partial<typeof v>) => { setV({ ...v, ...c }); setR(null); };
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-3 text-[15px] font-semibold">¿Se puede usar este código?</h2>
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end [&>*]:min-w-0">
        <Field label="Catálogo"><Select value={v.catalogo} onChange={(e) => cambiar({ catalogo: e.target.value })} options={catalogos.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} /></Field>
        <Field label="Código"><Input value={v.codigo} maxLength={10} onChange={(e) => cambiar({ codigo: e.target.value })} placeholder="Por ejemplo 01" /></Field>
        <Field label="Fecha del documento"><Input type="date" value={v.fecha} onChange={(e) => cambiar({ fecha: e.target.value })} /></Field>
        <Button variant="primary" onClick={validar} disabled={!v.codigo.trim() || !v.fecha}>Validar</Button>
      </div>
      {r && <div className="mt-3"><Alert tone={r.ok ? "ok" : "bad"}>{r.texto}</Alert></div>}
    </section>
  );
}
