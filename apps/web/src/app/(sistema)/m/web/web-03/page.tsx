"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Play } from "lucide-react";
import { Alert, Button, DataTable, DetailList, FiltroSelect, Modal, PageHeader, StatusBadge, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { useListado } from "@/lib/useListado";
import {
  ESTADO_CORRIDA, ESTADO_TIENDA, ORIGEN_CORRIDA, RESULTADO_ITEM, Seccion, TIPO_CORRIDA, Vacio, cuando, useDatos,
} from "@/modulos/web/comunes";

type Corrida = {
  id: string; number: string; store_id: string; tienda: string; kind: string; trigger: string; started_at: string; finished_at: string | null; status: string;
  items_ok: number; items_failed: number; detail: string | null; triggered_by: string | null;
};
type Item = { sku: string; result: string; detail: string; old?: number | string | null; new?: number | string | null };
type Ultima = { activo: boolean; ultima: { number: string; status: string; started_at: string } | null };
type Resumen = {
  tiendas: ({ id: string; name: string; status: string } & Record<string, Ultima | string>)[];
  cada: { stock: number; pedidos: number }; puede_correr: boolean;
};

const TIPOS = ["CATALOG", "PRICES", "STOCK", "ORDERS"] as const;

/** WEB-03 Sincronización: lo último de cada tienda, las corridas con su resultado y «Correr ahora». */
export default function Sincronizacion() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const inicial = useSearchParams().get("id");
  const [f, setF] = useState({ tienda: "", tipo: "", estado: "", origen: "" });
  const [abierta, setAbierta] = useState<string | null>(inicial);
  const [corriendo, setCorriendo] = useState("");
  const lista = useListado<Corrida>("/v1/web/sincronizacion", { filtros: f });
  const { datos: r, recargar: recargarResumen } = useDatos<Resumen>("/v1/web/sincronizacion?per_page=1");
  const recargar = () => { lista.recargar(); recargarResumen(); };

  async function correr(store: string, kind: string) {
    setCorriendo(`${store}:${kind}`);
    try {
      const x = await api<{ corrida: Corrida }>("/v1/web/sincronizacion", { method: "POST", body: { store_id: store, kind } });
      const c = x.corrida;
      if (c.status === "FAILED") toast.error(`${c.number}: ${c.detail}`); else toast.ok(`${c.number}: ${c.detail}`);
      recargar();
      setAbierta(c.id);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setCorriendo("");
    }
  }

  function cerrar() {
    setAbierta(null);
    if (inicial) router.replace("/m/web/web-03");
  }

  const columnas: Column<Corrida>[] = [
    { key: "number", header: "Corrida", cardTitle: true, render: (c) => (
      <div className="min-w-0"><div className="font-medium">{c.number} · {TIPO_CORRIDA[c.kind] ?? c.kind}</div><div className="text-[12px] text-muted">{cuando(c.started_at)}</div></div>
    ) },
    { key: "tienda", header: "Tienda", render: (c) => <span className="truncate">{c.tienda}</span> },
    { key: "trigger", header: "Origen", hideOnMobile: true, render: (c) => (
      <div className="text-[13px]">{ORIGEN_CORRIDA[c.trigger] ?? c.trigger}<div className="text-[12px] text-muted">{c.triggered_by ?? ""}</div></div>
    ) },
    { key: "detail", header: "Resultado", render: (c) => (
      <div className="min-w-0 text-[13px]"><div className="line-clamp-2">{c.detail ?? "—"}</div>
        <div className="text-[12px] text-muted">{c.items_ok} correctos{c.items_failed ? ` · ${c.items_failed} con error` : ""}</div></div>
    ) },
    { key: "status", header: "Estado", render: (c) => <StatusBadge status={c.status} labels={ESTADO_CORRIDA} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`El stock se envía cada ${r?.cada.stock ?? 10} minutos y después de cada venta; la consulta de respaldo trae los pedidos cada ${r?.cada.pedidos ?? 15} minutos y reintenta los que quedaron con error. Una corrida caída se reintenta en la siguiente.`} />
      {r && (
        <div className="grid gap-3 lg:grid-cols-3">
          {r.tiendas.map((s) => {
            const usable = s.status === "ACTIVE" || s.status === "TESTING";
            return (
              <Seccion key={s.id} titulo={s.name} acciones={<StatusBadge status={s.status} labels={ESTADO_TIENDA} />}>
                <ul className="divide-y divide-line">
                  {TIPOS.map((t) => {
                    const u = s[t] as Ultima;
                    return (
                      <li key={t} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                        <div className="min-w-0">
                          <div className="font-medium">{TIPO_CORRIDA[t]}</div>
                          <div className="truncate text-[12px] text-muted">
                            {!u.activo ? "No se sincroniza" : u.ultima ? `${u.ultima.number} · ${cuando(u.ultima.started_at)}` : "Sin corridas"}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {u.ultima && <StatusBadge status={u.ultima.status} labels={ESTADO_CORRIDA} />}
                          {r.puede_correr && usable && u.activo && (
                            <Button size="sm" icon={Play} loading={corriendo === `${s.id}:${t}`} disabled={Boolean(corriendo)} onClick={() => correr(s.id, t)}
                              aria-label={`Correr ${TIPO_CORRIDA[t]} de ${s.name}`}>Correr</Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Seccion>
            );
          })}
        </div>
      )}
      <DataTable {...lista.tabla} search={undefined} columns={columnas} onRowClick={(c) => setAbierta(c.id)} empty="No hay corridas con estos filtros."
        toolbar={<>
          <FiltroSelect etiqueta="Tienda" todos="todas" value={f.tienda} onChange={(v) => setF((x) => ({ ...x, tienda: v }))} options={(r?.tiendas ?? []).map((s) => ({ value: s.id, label: s.name }))} ancho={200} />
          <FiltroSelect etiqueta="Tipo" value={f.tipo} onChange={(v) => setF((x) => ({ ...x, tipo: v }))} options={Object.entries(TIPO_CORRIDA).map(([value, label]) => ({ value, label }))} />
          <FiltroSelect etiqueta="Estado" value={f.estado} onChange={(v) => setF((x) => ({ ...x, estado: v }))} options={Object.entries(ESTADO_CORRIDA).map(([value, [label]]) => ({ value, label }))} />
          <FiltroSelect etiqueta="Origen" value={f.origen} onChange={(v) => setF((x) => ({ ...x, origen: v }))} options={Object.entries(ORIGEN_CORRIDA).map(([value, label]) => ({ value, label }))} />
        </>} />
      {abierta && <FichaCorrida id={abierta} onClose={cerrar} />}
    </div>
  );
}

function FichaCorrida({ id, onClose }: { id: string; onClose: () => void }) {
  const { datos, error } = useDatos<{ corrida: Corrida & { items: Item[] } }>(`/v1/web/sincronizacion/${id}`);
  const c = datos?.corrida;
  const [solo, setSolo] = useState("");
  const items = (c?.items ?? []).filter((i) => !solo || i.result === solo);
  return (
    <Modal open onClose={onClose} title={c ? `${c.number} · ${TIPO_CORRIDA[c.kind] ?? c.kind}` : "Corrida"} description={c ? `${c.tienda} · ${cuando(c.started_at)}` : undefined} size="lg"
      footer={<Button variant="primary" onClick={onClose}>Cerrar</Button>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!c ? <Vacio>Cargando…</Vacio> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={c.status} labels={ESTADO_CORRIDA} /><span className="text-[13px] text-muted">{c.detail}</span></div>
          <DetailList items={[
            { label: "Origen", value: `${ORIGEN_CORRIDA[c.trigger] ?? c.trigger} · ${c.triggered_by ?? "—"}` },
            { label: "Inicio y fin", value: `${cuando(c.started_at)} → ${cuando(c.finished_at)}` },
            { label: "Ítems", value: `${c.items_ok} correctos · ${c.items_failed} con error` },
          ]} />
          <Seccion titulo={`Detalle por ítem (${c.items.length})`} acciones={c.items.length > 0 && (
            <FiltroSelect etiqueta="Resultado" value={solo} onChange={setSolo} options={Object.entries(RESULTADO_ITEM).map(([value, [label]]) => ({ value, label }))} />
          )}>
            {!items.length ? <Vacio>{c.items.length ? "Ningún ítem con ese resultado." : "Sin cambios que enviar."}</Vacio> : (
              <ul className="divide-y divide-line">
                {items.map((i, k) => (
                  <li key={k} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                    <div className="min-w-0">
                      <div className="font-medium">{i.sku}{i.old !== undefined && i.new !== undefined ? <span className="font-normal text-muted"> · {String(i.old ?? "—")} → {String(i.new)}</span> : null}</div>
                      <div className="break-words text-[12.5px] text-muted">{i.detail}</div>
                    </div>
                    <StatusBadge status={i.result} labels={RESULTADO_ITEM} />
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
