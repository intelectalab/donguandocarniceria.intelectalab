"use client";

import { useEffect, useState } from "react";
import { DollarSign, Megaphone, MessageCircle, Percent } from "lucide-react";
import { Alert, Badge, Cifra, DataTable, DetailList, FiltroSelect, PageHeader, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero, porcentaje, soles } from "@/lib/formato";
import { BarraPeriodo, InsigniaPlataforma, tonoRoas, type Opcion } from "@/modulos/ads/comun";

type PlatResumen = {
  platform: string; name: string; spend: number; leads: number; orders: number;
  new_customers: number; collected: number; roas: number | null;
  cpo: number | null; cpn: number | null; share_of_sales_pct: number | null; ctwa_leads_pct: number | null;
};

type MarcaRoas = {
  brand_id: string; brand_name: string;
  GOOGLE: number | null; META: number | null; TIKTOK: number | null;
};

type RespComparativo = {
  desde: string; hasta: string;
  cifras: {
    inversion_total: number;
    ventas_cobradas_totales: number;
    inversion_sobre_ventas_pct: number | null;
    leads_ctwa_pct: number | null;
  };
  plataformas: PlatResumen[];
  por_marca: MarcaRoas[];
  opciones: { marcas: Opcion[] };
};

/** ADS-09 Comparativo de plataformas: Google, Meta y TikTok lado a lado; inversión, ventas cobradas, retorno, inversión sobre ventas y porcentaje de leads por clic a WhatsApp. */
export default function ComparativoDePlataformas() {
  const [f, setF] = useState({ desde: "2026-09-01", hasta: "2026-09-30", marca: "" });
  const [res, setRes] = useState<RespComparativo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<RespComparativo>(`/v1/ads/comparativo?${q}`).then((r) => { setRes(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f]);

  const c = res?.cifras;
  const maxValor = Math.max(1, ...(res?.plataformas.flatMap((p) => [p.spend, p.collected]) ?? [1]));

  const colMarcas: Column<MarcaRoas>[] = [
    { key: "brand_name", header: "Marca", cardTitle: true, render: (m) => <span className="font-semibold text-ink">{m.brand_name}</span> },
    {
      key: "GOOGLE", header: "Google Ads", align: "right",
      render: (m) => m.GOOGLE !== null ? <Badge tone={tonoRoas(m.GOOGLE)}>{numero(m.GOOGLE, 2)}</Badge> : "—",
    },
    {
      key: "META", header: "Meta Ads", align: "right",
      render: (m) => m.META !== null ? <Badge tone={tonoRoas(m.META)}>{numero(m.META, 2)}</Badge> : "—",
    },
    {
      key: "TIKTOK", header: "TikTok Ads", align: "right",
      render: (m) => m.TIKTOK !== null ? <Badge tone={tonoRoas(m.TIKTOK)}>{numero(m.TIKTOK, 2)}</Badge> : "—",
    },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Google Ads, Meta Ads y TikTok Ads lado a lado: inversión, ventas cobradas atribuidas, retorno (ROAS), inversión sobre las ventas totales del período y porcentaje de leads de anuncios de clic a WhatsApp." />
      {error && <Alert tone="bad">{error}</Alert>}

      <BarraPeriodo desde={f.desde} hasta={f.hasta} onChange={(desde, hasta) => setF({ ...f, desde, hasta })}>
        <FiltroSelect etiqueta="Marca" todos="todas" ancho={180} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={res?.opciones.marcas ?? []} />
      </BarraPeriodo>

      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Inversión total" valor={soles(c.inversion_total)} icono={Megaphone} destacada />
          <Cifra titulo="Ventas cobradas del período" valor={soles(c.ventas_cobradas_totales)} icono={DollarSign} detalle="todas las ventas, no solo atribuidas" />
          <Cifra titulo="Inversión sobre ventas" valor={c.inversion_sobre_ventas_pct !== null ? porcentaje(c.inversion_sobre_ventas_pct, 2) : "—"} icono={Percent} />
          <Cifra titulo="Leads por clic a WhatsApp" valor={c.leads_ctwa_pct !== null ? porcentaje(c.leads_ctwa_pct, 1) : "—"} icono={MessageCircle} />
        </div>
      )}

      {res && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {res.plataformas.map((p) => (
              <section key={p.platform} className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <InsigniaPlataforma p={p.platform} label={p.name} />
                  {p.roas !== null && <Badge tone={tonoRoas(p.roas)}>ROAS {numero(p.roas, 2)}</Badge>}
                </div>
                <DetailList
                  items={[
                    { label: "Inversión", value: soles(p.spend) },
                    { label: "Leads atribuidos", value: numero(p.leads) },
                    { label: "Pedidos atribuidos", value: numero(p.orders) },
                    { label: "Clientes nuevos", value: numero(p.new_customers) },
                    { label: "Ventas cobradas atribuidas", value: <span className="font-semibold text-ink">{soles(p.collected)}</span> },
                    { label: "Retorno (ROAS)", value: p.roas !== null ? <strong>{numero(p.roas, 2)}</strong> : "—" },
                    { label: "Costo por pedido", value: p.cpo !== null ? soles(p.cpo) : "—" },
                    { label: "Costo por cliente nuevo", value: p.cpn !== null ? soles(p.cpn) : "—" },
                    { label: "Inversión sobre ventas", value: p.share_of_sales_pct !== null ? porcentaje(p.share_of_sales_pct, 2) : "—" },
                    { label: "Leads de clic a WhatsApp", value: p.ctwa_leads_pct !== null ? porcentaje(p.ctwa_leads_pct, 1) : "—" },
                  ]}
                />
              </section>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="grid content-start gap-4 rounded-xl border border-line bg-surface p-4 shadow-card">
              <h2 className="text-[14px] font-semibold text-ink">Inversión y cobrado por plataforma</h2>
              <div className="grid gap-4">
                {res.plataformas.map((p) => (
                  <div key={p.platform} className="grid gap-1.5 text-[12.5px]">
                    <div className="flex justify-between font-medium text-ink">
                      <span>{p.name}</span>
                      <span>Inversión {soles(p.spend)} · Cobrado {soles(p.collected)}</span>
                    </div>
                    <div className="grid gap-1">
                      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-warn" style={{ width: `${Math.max(2, Math.round((p.spend / maxValor) * 100))}%` }} />
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-ok" style={{ width: `${Math.max(2, Math.round((p.collected / maxValor) * 100))}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex gap-4 text-[12px] text-muted">
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-warn" /> Inversión</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-ok" /> Cobrado atribuido</span>
                </div>
              </div>
            </section>

            <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <h2 className="text-[14px] font-semibold text-ink">Retorno (ROAS) por marca y plataforma</h2>
              <DataTable
                rowKey={(m) => m.brand_id}
                columns={colMarcas}
                rows={res.por_marca}
                empty="Sin marcas activas."
              />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
