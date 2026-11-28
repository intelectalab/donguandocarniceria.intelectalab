"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DollarSign, Megaphone, ShoppingBag, TrendingUp, UserPlus, Users } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, FiltroSelect, Modal, PageHeader, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { BarraPeriodo, InsigniaPlataforma, PLATAFORMAS, tonoRoas, type Opcion } from "@/modulos/ads/comun";

type FilaRes = {
  key: string; code: string; name: string; campaign_id?: string; campaign_name?: string;
  platform: string; plataforma: string; brand_id?: string; brand_name?: string;
  sin_rastreo?: boolean; creators_pen?: number;
  spend: number; leads: number; orders: number; new_customers: number; collected: number;
  cpl: number | null; cpo: number | null; cpn: number | null; roas: number | null;
};

type RespResultados = {
  desde: string; hasta: string; por: "ad" | "campaign";
  data: FilaRes[];
  totales: {
    spend: number; leads: number; orders: number; new_customers: number; collected: number;
    cpl: number | null; cpo: number | null; cpn: number | null; roas: number | null;
  };
  opciones: { campanas: Opcion[]; marcas: Opcion[] };
};

type PedidoAtribuido = {
  id: string; number: string; created_at: string; customer: string; method: string; metodo: string;
  is_new_customer: boolean; status: string; collected: number;
};

/** ADS-05 Resultados por anuncio: inversión, leads, pedidos, clientes nuevos, cobrado, costos unitarios y retorno sobre ventas cobradas; baja a los pedidos. */
function ResultadosPorAnuncioVista() {
  const params = useSearchParams();
  const [f, setF] = useState({
    desde: "2026-09-01",
    hasta: "2026-09-30",
    por: "ad" as "ad" | "campaign",
    plataforma: "",
    marca: "",
    campana: params.get("campana") || "",
    anuncio: params.get("anuncio") || "",
  });
  const [res, setRes] = useState<RespResultados | null>(null);
  const [error, setError] = useState("");
  const [buscar, setBuscar] = useState("");
  const [modalPedidos, setModalPedidos] = useState<{ titulo: string; pedidos: PedidoAtribuido[] } | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<RespResultados>(`/v1/ads/resultados?${q}`).then((r) => { setRes(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f]);

  async function abrirPedidos(fila: FilaRes) {
    try {
      const q = new URLSearchParams({
        desde: f.desde,
        hasta: f.hasta,
        ...(f.por === "ad" ? { ad_id: fila.key } : { campaign_id: fila.key }),
      }).toString();
      const r = await api<{ data: PedidoAtribuido[] }>(`/v1/ads/resultados/pedidos?${q}`);
      setModalPedidos({
        titulo: `Pedidos de ${fila.code} · ${fila.name} (${fecha(f.desde)} – ${fecha(f.hasta)})`,
        pedidos: r.data,
      });
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const t = res?.totales;
  const filtradas = (res?.data ?? []).filter((r) => {
    const s = buscar.trim().toLowerCase();
    return s.length < 2 || [r.code, r.name, r.campaign_name ?? "", r.brand_name ?? "", r.plataforma].some((v) => v.toLowerCase().includes(s));
  });

  const cols: Column<FilaRes>[] = [
    ...(f.por === "ad"
      ? [{
        key: "code", header: "Anuncio", cardTitle: true,
        render: (r: FilaRes) => (
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono font-semibold text-ink">{r.code}</span>
              <span className="text-[12.5px] text-muted">{r.name}</span>
              {r.sin_rastreo && <Badge tone="bad">sin rastreo</Badge>}
            </div>
            <p className="text-[11.5px] text-muted">{r.campaign_name}</p>
          </div>
        ),
      }]
      : [{
        key: "name", header: "Campaña", cardTitle: true,
        render: (r: FilaRes) => (
          <div>
            <span className="font-semibold text-ink">{r.name}</span>
            <p className="font-mono text-[11.5px] text-muted">{r.code}</p>
          </div>
        ),
      }]),
    { key: "platform", header: "Plataforma", render: (r) => <InsigniaPlataforma p={r.platform} label={r.plataforma} /> },
    { key: "brand_name", header: "Marca", render: (r) => r.brand_name || "—" },
    ...(f.por === "campaign"
      ? [{ key: "creators_pen", header: "Creadores", align: "right" as const, render: (r: FilaRes) => soles(r.creators_pen ?? 0) }]
      : []),
    { key: "spend", header: "Inversión", align: "right", render: (r) => soles(r.spend) },
    { key: "leads", header: "Leads", align: "right", render: (r) => numero(r.leads) },
    { key: "orders", header: "Pedidos", align: "right", render: (r) => numero(r.orders) },
    { key: "new_customers", header: "Nuevos", align: "right", render: (r) => numero(r.new_customers) },
    { key: "collected", header: "Cobrado", align: "right", render: (r) => soles(r.collected) },
    { key: "cpl", header: "C/lead", align: "right", hideOnMobile: true, render: (r) => r.cpl !== null ? soles(r.cpl) : "—" },
    { key: "cpo", header: "C/pedido", align: "right", hideOnMobile: true, render: (r) => r.cpo !== null ? soles(r.cpo) : "—" },
    { key: "cpn", header: "C/cliente nuevo", align: "right", hideOnMobile: true, render: (r) => r.cpn !== null ? soles(r.cpn) : "—" },
    {
      key: "roas", header: "Retorno", align: "right",
      render: (r) => r.roas !== null ? <Badge tone={tonoRoas(r.roas)}>{numero(r.roas, 2)}</Badge> : "—",
    },
  ];

  const colPedidos: Column<PedidoAtribuido>[] = [
    { key: "number", header: "Pedido", cardTitle: true, render: (p) => <span className="font-mono font-semibold text-ink">{p.number}</span> },
    { key: "created_at", header: "Fecha", render: (p) => fecha(p.created_at) },
    { key: "customer", header: "Cliente", render: (p) => p.customer },
    { key: "metodo", header: "Método", render: (p) => p.metodo },
    { key: "is_new_customer", header: "Cliente nuevo", render: (p) => p.is_new_customer ? <Badge tone="ok">Sí</Badge> : "No" },
    { key: "status", header: "Estado", render: (p) => <Badge tone="neutral">{p.status}</Badge> },
    { key: "collected", header: "Cobrado", align: "right", render: (p) => soles(p.collected) },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Inversión, leads, pedidos, clientes nuevos y lo cobrado por anuncio o campaña; costo por lead, por pedido, por cliente nuevo y retorno con ventas cobradas." />
      {error && <Alert tone="bad">{error}</Alert>}

      <BarraPeriodo desde={f.desde} hasta={f.hasta} onChange={(desde, hasta) => setF({ ...f, desde, hasta })}>
        <div className="flex rounded-lg border border-line bg-surface-2 p-0.5">
          <Button size="sm" variant={f.por === "ad" ? "primary" : "ghost"} onClick={() => setF({ ...f, por: "ad", anuncio: "" })}>Por anuncio</Button>
          <Button size="sm" variant={f.por === "campaign" ? "primary" : "ghost"} onClick={() => setF({ ...f, por: "campaign", anuncio: "" })}>Por campaña</Button>
        </div>
      </BarraPeriodo>

      {t && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Cifra titulo="Inversión" valor={soles(t.spend)} icono={Megaphone} destacada />
          <Cifra titulo="Leads" valor={numero(t.leads)} icono={Users} detalle={`costo ${t.cpl !== null ? soles(t.cpl) : "—"}`} />
          <Cifra titulo="Pedidos" valor={numero(t.orders)} icono={ShoppingBag} detalle={`costo ${t.cpo !== null ? soles(t.cpo) : "—"}`} />
          <Cifra titulo="Clientes nuevos" valor={numero(t.new_customers)} icono={UserPlus} detalle={`costo ${t.cpn !== null ? soles(t.cpn) : "—"}`} />
          <Cifra titulo="Cobrado" valor={soles(t.collected)} icono={DollarSign} detalle="pagos confirmados" />
          <Cifra titulo="Retorno (ROAS)" valor={t.roas !== null ? numero(t.roas, 2) : "—"} icono={TrendingUp} tono={t.roas !== null ? (t.roas >= 2 ? "ok" : "warn") : undefined} detalle="soles cobrados por sol" />
        </div>
      )}

      <DataTable
        rowKey={(r) => r.key}
        columns={cols}
        rows={filtradas}
        loading={!res && !error}
        onRowClick={abrirPedidos}
        empty="Sin resultados publicitarios en el período seleccionado."
        search={{ value: buscar, onChange: setBuscar, placeholder: f.por === "ad" ? "Buscar anuncio, código o campaña…" : "Buscar campaña…" }}
        toolbar={
          <>
            <FiltroSelect etiqueta="Plataforma" todos="todas" ancho={160} value={f.plataforma} onChange={(v) => setF({ ...f, plataforma: v })} options={PLATAFORMAS} />
            <FiltroSelect etiqueta="Marca" todos="todas" ancho={175} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={res?.opciones.marcas ?? []} />
            <FiltroSelect etiqueta="Campaña" todos="todas" ancho={240} value={f.campana} onChange={(v) => setF({ ...f, campana: v })} options={res?.opciones.campanas ?? []} />
          </>
        }
      />

      <Alert tone="info">
        El monto cobrado suma únicamente los pagos confirmados aplicados a pedidos atribuidos no anulados; un pedido solo confirmado o un cobro revertido no suman al retorno. Haz clic en cualquier fila para ver sus pedidos atribuidos.
      </Alert>

      {modalPedidos && (
        <Modal
          open
          onClose={() => setModalPedidos(null)}
          size="lg"
          title={modalPedidos.titulo}
          footer={<Button variant="primary" onClick={() => setModalPedidos(null)}>Cerrar</Button>}
        >
          <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-3">
              <Cifra titulo="Pedidos" valor={numero(modalPedidos.pedidos.length)} icono={ShoppingBag} />
              <Cifra titulo="Clientes nuevos" valor={numero(modalPedidos.pedidos.filter((p) => p.is_new_customer).length)} icono={UserPlus} />
              <Cifra titulo="Cobrado" valor={soles(modalPedidos.pedidos.reduce((acc, p) => acc + p.collected, 0))} icono={DollarSign} />
            </div>
            <DataTable
              rowKey={(p) => p.id}
              columns={colPedidos}
              rows={modalPedidos.pedidos}
              empty="No hay pedidos atribuidos en este rango de fechas."
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function ResultadosPorAnuncio() {
  return <Suspense><ResultadosPorAnuncioVista /></Suspense>;
}
