"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, DollarSign, Filter, Megaphone, ShoppingBag, Users } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, Field, FiltroSelect, Modal, PageHeader, Select, Tabs, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, porcentaje, soles } from "@/lib/formato";
import { BarraPeriodo, type Opcion } from "@/modulos/ads/comun";

type PedidoEmbudo = {
  order_id: string; number: string; created_at: string; channel: string;
  brand_id: string; brand_name: string; customer: string; status: string;
  ad_id: string | null; ad_label: string; method: string; metodo: string;
  is_new_customer: boolean; manual_reason: string | null;
  corrected_by: string | null; corrected_at: string | null; collected: number;
};

type RespEmbudo = {
  desde: string; hasta: string;
  pasos: { inversion: number; leads: number; pedidos: number; pedidos_con_cobro: number; cobrado: number; roas: number | null };
  cobertura: { digitales: number; con_atribucion: number; sin_atribucion: number; cobertura_pct: number | null; ventana_dias: number };
  por_metodo: { code: string; label: string; count: number }[];
  sin_atribucion: PedidoEmbudo[];
  atribuidos: PedidoEmbudo[];
  opciones: {
    anuncios: { value: string; label: string; brand_id: string }[];
    marcas: Opcion[];
  };
  puede_corregir: boolean;
};

/** ADS-06 Embudo de atribución: anuncio → leads → pedidos → cobros; lista de pedidos digitales sin atribución y corrección manual con motivo. */
export default function EmbudoDeAtribucion() {
  const [f, setF] = useState({ desde: "2026-09-01", hasta: "2026-09-30", marca: "" });
  const [tab, setTab] = useState("none");
  const [res, setRes] = useState<RespEmbudo | null>(null);
  const [error, setError] = useState("");
  const [buscar, setBuscar] = useState("");
  const [corrigiendo, setCorrigiendo] = useState<PedidoEmbudo | null>(null);
  const [adId, setAdId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = () => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<RespEmbudo>(`/v1/ads/embudo?${q}`).then((r) => { setRes(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  };
  useEffect(cargar, [f]);

  function abrirCorreccion(p: PedidoEmbudo) {
    setCorrigiendo(p);
    setAdId(p.ad_id ?? "");
    setMotivo(p.manual_reason ?? "");
  }

  async function guardarCorreccion() {
    if (!corrigiendo) return;
    setGuardando(true);
    try {
      await api(`/v1/ads/embudo/pedidos/${corrigiendo.order_id}/corregir`, {
        method: "POST",
        body: { ad_id: adId || null, reason: motivo.trim() },
      });
      toast.ok("Atribución corregida y registrada en la auditoría");
      setCorrigiendo(null);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  const p = res?.pasos;
  const cob = res?.cobertura;
  const maxMetodo = Math.max(1, ...(res?.por_metodo.map((m) => m.count) ?? [1]));

  const filasActivas = (tab === "none" ? (res?.sin_atribucion ?? []) : (res?.atribuidos ?? [])).filter((x) => {
    const s = buscar.trim().toLowerCase();
    return s.length < 2 || [x.number, x.customer, x.channel, x.brand_name, x.ad_label, x.metodo].some((v) => v.toLowerCase().includes(s));
  });

  const colSin: Column<PedidoEmbudo>[] = [
    { key: "number", header: "Pedido", cardTitle: true, render: (x) => <span className="font-mono font-semibold text-ink">{x.number}</span> },
    { key: "created_at", header: "Fecha", render: (x) => fechaHora(x.created_at) },
    { key: "channel", header: "Canal", render: (x) => <Badge tone="info">{x.channel}</Badge> },
    { key: "brand_name", header: "Marca", render: (x) => x.brand_name },
    { key: "customer", header: "Cliente", render: (x) => x.customer },
    { key: "status", header: "Estado", render: (x) => <Badge tone="neutral">{x.status}</Badge> },
    ...(res?.puede_corregir ? [{
      key: "acc", header: "", align: "right" as const,
      render: (x: PedidoEmbudo) => <Button variant="primary" size="sm" onClick={() => abrirCorreccion(x)}>Atribuir</Button>,
    }] : []),
  ];

  const colAtrib: Column<PedidoEmbudo>[] = [
    { key: "number", header: "Pedido", cardTitle: true, render: (x) => <span className="font-mono font-semibold text-ink">{x.number}</span> },
    { key: "created_at", header: "Fecha", render: (x) => fecha(x.created_at) },
    { key: "ad_label", header: "Anuncio", render: (x) => <span className="font-medium text-ink">{x.ad_label}</span> },
    { key: "metodo", header: "Método", render: (x) => <Badge tone={x.method === "MANUAL" ? "warn" : "ok"}>{x.metodo}</Badge> },
    { key: "is_new_customer", header: "Cliente nuevo", render: (x) => x.is_new_customer ? "Sí" : "No" },
    { key: "collected", header: "Cobrado", align: "right", render: (x) => soles(x.collected) },
    { key: "manual_reason", header: "Motivo manual", hideOnMobile: true, render: (x) => <span className="text-[12px] text-muted">{x.manual_reason || "—"}</span> },
    ...(res?.puede_corregir ? [{
      key: "acc", header: "", align: "right" as const,
      render: (x: PedidoEmbudo) => <Button variant="ghost" size="sm" onClick={() => abrirCorreccion(x)}>Corregir</Button>,
    }] : []),
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Embudo completo: anuncio → leads → pedidos → cobros. Lista de pedidos digitales sin atribución y corrección manual con motivo obligatorio y registro en la auditoría." />
      {error && <Alert tone="bad">{error}</Alert>}

      <BarraPeriodo desde={f.desde} hasta={f.hasta} onChange={(desde, hasta) => setF({ ...f, desde, hasta })}>
        <FiltroSelect etiqueta="Marca" todos="todas" ancho={180} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={res?.opciones.marcas ?? []} />
      </BarraPeriodo>

      {p && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Cifra titulo="1. Inversión" valor={soles(p.inversion)} icono={Megaphone} />
          <Cifra titulo="2. Leads atribuidos" valor={numero(p.leads)} icono={Users} />
          <Cifra titulo="3. Pedidos atribuidos" valor={numero(p.pedidos)} icono={ShoppingBag} detalle={p.leads > 0 ? `${porcentaje((p.pedidos / p.leads) * 100, 1)} de los leads` : undefined} />
          <Cifra titulo="4. Pedidos con cobro" valor={numero(p.pedidos_con_cobro)} icono={CheckCircle2} detalle={p.pedidos > 0 ? `${porcentaje((p.pedidos_con_cobro / p.pedidos) * 100, 1)} de los pedidos` : undefined} />
          <Cifra titulo="5. Cobrado" valor={soles(p.cobrado)} icono={DollarSign} destacada detalle={p.roas !== null ? `retorno ${numero(p.roas, 2)}` : undefined} />
        </div>
      )}

      {res && cob && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="text-[14px] font-semibold text-ink">Pedidos digitales por método de atribución</h2>
            <div className="grid gap-2.5">
              {res.por_metodo.map((m) => (
                <div key={m.code} className="grid gap-1 text-[12.5px]">
                  <div className="flex justify-between">
                    <span className="font-medium text-ink">{m.label}</span>
                    <span className="font-mono font-semibold text-ink">{numero(m.count)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${m.code === "NONE" ? "bg-bad" : "bg-primary"}`}
                      style={{ width: `${Math.max(3, Math.round((m.count / maxMetodo) * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="text-[14px] font-semibold text-ink">Cobertura de atribución digital</h2>
            <div className="grid grid-cols-2 gap-3">
              <Cifra titulo="Pedidos digitales" valor={numero(cob.digitales)} icono={Filter} />
              <Cifra titulo="Con atribución" valor={cob.cobertura_pct !== null ? porcentaje(cob.cobertura_pct, 1) : "—"} icono={CheckCircle2} tono={(cob.cobertura_pct ?? 0) >= 70 ? "ok" : "warn"} />
              <Cifra titulo="Sin atribución" valor={numero(cob.sin_atribucion)} icono={AlertTriangle} tono={cob.sin_atribucion > 0 ? "warn" : "ok"} />
              <Cifra titulo="Ventana de herencia" valor={`${cob.ventana_dias} días`} icono={Users} detalle="hereda el anuncio del lead" />
            </div>
          </section>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "none", label: "Pedidos digitales sin atribución", count: res?.sin_atribucion.length },
          { key: "att", label: "Pedidos atribuidos", count: res?.atribuidos.length },
        ]}
      />

      <DataTable
        rowKey={(x) => x.order_id}
        columns={tab === "none" ? colSin : colAtrib}
        rows={filasActivas}
        loading={!res && !error}
        empty={tab === "none" ? "Todos los pedidos digitales del período tienen atribución." : "No hay pedidos atribuidos en el período."}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar por pedido, cliente o anuncio…" }}
      />

      {corrigiendo && res && (
        <Modal
          open
          onClose={() => setCorrigiendo(null)}
          title={`Atribución del pedido ${corrigiendo.number}`}
          description={`${corrigiendo.customer} · ${corrigiendo.brand_name}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setCorrigiendo(null)}>Cancelar</Button>
              <Button variant="primary" loading={guardando} disabled={motivo.trim().length < 5} onClick={guardarCorreccion}>Guardar corrección</Button>
            </>
          }
        >
          <div className="grid gap-4">
            <DetailList
              items={[
                { label: "Pedido", value: `${corrigiendo.number} · ${corrigiendo.channel}` },
                { label: "Marca", value: corrigiendo.brand_name },
                { label: "Atribución actual", value: `${corrigiendo.metodo}${corrigiendo.ad_id ? ` · ${corrigiendo.ad_label}` : ""}` },
              ]}
            />
            <Field label="Anuncio (vacío = sin atribución)">
              <Select
                value={adId}
                onChange={(e) => setAdId(e.target.value)}
                options={[
                  { value: "", label: "— Sin atribución —" },
                  ...res.opciones.anuncios.filter((a) => a.brand_id === corrigiendo.brand_id),
                ]}
              />
            </Field>
            <Field label="Motivo de la corrección" required hint={`${motivo.trim().length}/5 caracteres mínimo. Queda registrado en la auditoría con el valor anterior.`}>
              <Textarea rows={3} maxLength={255} placeholder="Por ejemplo: la clienta envió el código DG-G01 en un segundo mensaje" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
