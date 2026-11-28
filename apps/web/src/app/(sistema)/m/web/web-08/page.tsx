"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Ban, PackageX, Send, Store, Timer } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, FiltroSelect, Modal, PageHeader, StatusBadge, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { ESTADO_CORRIDA, ElegirTienda, SITUACION_STOCK, Seccion, Vacio, cuando, useDatos, useTienda, type TiendaCorta } from "@/modulos/web/comunes";

type Fila = {
  id: string; sku: string; variant_id: string; producto: string; marca: string | null; saldo: number; no_usable: number; reservado: number; disponible: number; margen: number;
  publicado: number; enviado: number | null; enviado_at: string | null; por_enviar: boolean; situacion: string; formula: string;
};
type Resumen = {
  cifras: { publicados: number; agotados: number; no_usable: number; por_enviar: number };
  tienda: { id: string; name: string; margen: number; sync_stock: boolean; status: string; almacenes: string[] } | null;
  ultimo: { number: string; started_at: string; status: string; detail: string } | null; stock_cada: number; marcas: { id: string; name: string }[]; puede_sincronizar: boolean;
};
type Lote = { almacen: string; lote: string; vence: string | null; qty: number; reservado: number; libre: number; usable: boolean; porque: string | null };
type Detalle = { sku: string; producto: string; formula: string; enviado: number | null; enviado_at: string | null; total: number; reservado: number; no_usable: number; disponible: number; margen: number; publicado: number; lotes: Lote[] };

/** WEB-08 Stock publicado: cuánto se ofrece en la web por SKU y de dónde sale (saldo − reservado − no usable, menos el margen). */
export default function StockPublicado() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const params = useSearchParams();
  const { datos: ts } = useDatos<{ data: TiendaCorta[] }>("/v1/web/tiendas");
  const [tienda, setTienda] = useTienda(ts?.data, params.get("store"));
  const [f, setF] = useState({ situacion: "", marca: "" });
  const [abierto, setAbierto] = useState<Fila | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [corrida, setCorrida] = useState<{ id: string; number: string } | null>(null);
  const lista = useListado<Fila>("/v1/web/stock", { orden: "sku", filtros: { store: tienda, ...f } });
  const { datos: r, recargar: recargarResumen } = useDatos<Resumen>(tienda ? `/v1/web/stock?store=${tienda}&per_page=1` : null);
  const recargar = () => { lista.recargar(); recargarResumen(); };
  const c = r?.cifras;
  const t = r?.tienda;
  const usable = t && (t.status === "ACTIVE" || t.status === "TESTING") && t.sync_stock;

  async function enviar() {
    setEnviando(true);
    try {
      const x = await api<{ corrida: { id: string; number: string; status: string; detail: string } }>("/v1/web/sincronizacion", { method: "POST", body: { store_id: tienda, kind: "STOCK" } });
      const k = x.corrida;
      if (k.status === "FAILED") toast.error(`${k.number}: ${k.detail}`); else toast.ok(`${k.number}: ${k.detail}`);
      setCorrida({ id: k.id, number: k.number });
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  const columnas: Column<Fila>[] = [
    { key: "sku", header: "SKU", sortable: true, cardTitle: true, render: (s) => (
      <div className="min-w-0"><div className="font-medium">{s.sku}</div><div className="truncate text-[12px] text-muted">{s.producto}{s.marca ? ` · ${s.marca}` : ""}</div></div>
    ) },
    { key: "saldo", header: "Saldo", sortable: true, align: "right", hideOnMobile: true, render: (s) => <span className="tabular-nums">{numero(s.saldo)}</span> },
    { key: "disponible", header: "Disponible", sortable: true, align: "right", hideOnMobile: true, render: (s) => (
      <div className="text-right"><div className="tabular-nums">{numero(s.disponible)}</div>
        {(s.reservado > 0 || s.no_usable > 0) && <div className="text-[11.5px] text-muted">{s.reservado ? `−${numero(s.reservado)} reserv.` : ""}{s.reservado && s.no_usable ? " " : ""}{s.no_usable ? `−${numero(s.no_usable)} no usable` : ""}</div>}</div>
    ) },
    { key: "publicado", header: "Publicado", sortable: true, align: "right", render: (s) => (
      <div className="text-right"><div className="font-medium tabular-nums">{numero(s.publicado)}</div>
        {s.por_enviar && <div className="text-[11.5px] text-warn">en la web {s.enviado ?? "—"}</div>}</div>
    ) },
    { key: "enviado_at", header: "Último envío", hideOnMobile: true, render: (s) => <span className="text-[12.5px] text-muted">{s.enviado_at ? cuando(s.enviado_at) : "Nunca"}</span> },
    { key: "situacion", header: "Situación", render: (s) => <StatusBadge status={s.situacion} labels={SITUACION_STOCK} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`Publicado = (saldo − reservado − no usable) × (1 − margen), redondeado hacia abajo. Solo cuentan los almacenes de la tienda y los lotes usables (no vencidos ni en cuarentena). Se envía cada ${r?.stock_cada ?? 10} minutos y después de cada venta.`}
        actions={<>
          <ElegirTienda tiendas={ts?.data ?? []} value={tienda} onChange={setTienda} />
          {r?.puede_sincronizar && usable && <Button variant="primary" icon={Send} loading={enviando} onClick={enviar}>Enviar stock ahora</Button>}
        </>} />
      {t && !t.sync_stock && <Alert tone="info" title="El stock de esta tienda no se sincroniza">Actívalo en Tiendas (WEB-01). Mientras tanto la web conserva el último stock enviado.</Alert>}
      {t && t.status !== "ACTIVE" && t.status !== "TESTING" && <Alert tone="warn">La tienda no está activa: no se envía nada.</Alert>}
      {corrida && <Alert tone="info">Corrida {corrida.number} lista. <Link className="font-medium underline" href={`/m/web/web-03?id=${corrida.id}`}>Ver el detalle</Link></Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="SKU publicados" icono={Store} destacada valor={c ? numero(c.publicados) : undefined} detalle={t ? `margen de seguridad ${t.margen} %` : undefined} />
        <Cifra titulo="Agotados" icono={PackageX} tono={c && c.agotados > 0 ? "warn" : undefined} valor={c ? numero(c.agotados) : undefined} detalle="se muestran sin stock" />
        <Cifra titulo="Con stock no usable" icono={Ban} tono={c && c.no_usable > 0 ? "warn" : undefined} valor={c ? numero(c.no_usable) : undefined} detalle="lotes vencidos o bloqueados" />
        <Cifra titulo="Por enviar" icono={Timer} tono={c && c.por_enviar > 0 ? "warn" : undefined} valor={c ? numero(c.por_enviar) : undefined}
          detalle={r?.ultimo ? `última corrida ${r.ultimo.number} · ${cuando(r.ultimo.started_at)}` : "sin corridas de stock"} />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={setAbierto} empty="No hay SKU publicados con estos filtros."
        search={{ ...lista.tabla.search, placeholder: "SKU o producto…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Situación" todos="todas" value={f.situacion} onChange={(v) => setF((x) => ({ ...x, situacion: v }))} options={Object.entries(SITUACION_STOCK).map(([value, [label]]) => ({ value, label }))} />
          {(r?.marcas.length ?? 0) > 1 && <FiltroSelect etiqueta="Marca" todos="todas" value={f.marca} onChange={(v) => setF((x) => ({ ...x, marca: v }))} options={(r?.marcas ?? []).map((m) => ({ value: m.id, label: m.name }))} ancho={190} />}
        </>} />
      {t && <p className="text-[12.5px] text-muted">Almacenes de {t.name}: {t.almacenes.join(", ") || "ninguno"}.{r?.ultimo ? <> Última corrida de stock: <StatusBadge status={r.ultimo.status} labels={ESTADO_CORRIDA} /> {r.ultimo.detail}</> : null}</p>}
      {abierto && <FichaStock id={abierto.id} onClose={() => setAbierto(null)} />}
    </div>
  );
}

function FichaStock({ id, onClose }: { id: string; onClose: () => void }) {
  const { datos: s, error } = useDatos<Detalle>(`/v1/web/stock/${id}`);
  return (
    <Modal open onClose={onClose} size="lg" title={s ? s.sku : "SKU"} description={s?.producto} footer={<Button variant="primary" onClick={onClose}>Cerrar</Button>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!s ? <Vacio>Cargando…</Vacio> : (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-surface-2 p-3 text-center">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">Publicado</div>
            <div className="text-[26px] font-semibold tabular-nums">{numero(s.publicado)}</div>
            <div className="text-[13px] text-muted">{s.formula}</div>
          </div>
          <DetailList items={[
            { label: "Saldo en los almacenes de la tienda", value: numero(s.total) },
            { label: "Reservado por pedidos", value: numero(s.reservado) },
            { label: "No usable", value: numero(s.no_usable) },
            { label: "Disponible", value: numero(s.disponible) },
            { label: "Margen de seguridad", value: `${s.margen} %` },
            { label: "En la web ahora", value: s.enviado !== null ? `${numero(s.enviado)} · enviado ${cuando(s.enviado_at)}` : "Todavía no se envió" },
          ]} />
          {s.enviado !== null && s.enviado !== s.publicado && <Alert tone="warn">La web muestra {s.enviado}: se actualiza a {s.publicado} en el próximo envío.</Alert>}
          <Seccion titulo={`Lotes (${s.lotes.length})`}>
            {!s.lotes.length ? <Vacio>Sin lotes en los almacenes de la tienda.</Vacio> : (
              <ul className="divide-y divide-line">
                {s.lotes.map((l, k) => (
                  <li key={k} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                    <div className="min-w-0">
                      <div className="font-medium">{l.lote}</div>
                      <div className="text-[12px] text-muted">{l.almacen} · vence {l.vence ? fecha(l.vence) : "—"}{l.reservado ? ` · ${numero(l.reservado)} reservado` : ""}</div>
                      {!l.usable && l.porque && <div className="text-[12px] text-bad">{l.porque}</div>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="tabular-nums">{numero(l.qty)}</span>
                      {l.usable ? <Badge tone="ok">Usable</Badge> : <Badge tone="bad">No usable</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
        </div>
      )}
    </Modal>
  );
}
