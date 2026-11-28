"use client";

import { useEffect, useState } from "react";
import { Clock, Megaphone, Plus, Sparkles } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, Textarea, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, numero, porcentaje, soles } from "@/lib/formato";
import { BarraPeriodo, InsigniaPlataforma, TONO_ESTADO, type Opcion } from "@/modulos/ads/comun";

type ResumenCampana = {
  campaign_id: string; campaign_name: string; platform: string; plataforma: string; brand_name: string;
  creators_pen: number; ads_spend_pen: number; total_cost_pen: number; weight_pct: number | null; count: number;
};

type GastoCreador = {
  id: string; number: string; issue_date: string; creador: string; doc: string;
  campaign_id: string; campaign_name: string; platform: string; plataforma: string;
  brand_name: string; description: string; amount_pen: number; withholding_amount: number;
  status: string; estado: string;
};

type RespCreadores = {
  desde: string; hasta: string;
  data: GastoCreador[];
  por_campana: ResumenCampana[];
  cifras: { costo_aprobado_pen: number; campanas_con_creadores: number; pendientes_aprobar: number };
  opciones: { creadores: Opcion[]; campanas: Opcion[]; marcas: Opcion[] };
  puede_registrar: boolean;
};

/** ADS-08 Creadores de contenido: gastos de creadores (recibo por honorarios) por campaña y su peso en el costo de la campaña. */
export default function CreadoresDeContenido() {
  const [f, setF] = useState({ desde: "2026-09-01", hasta: "2026-10-31", marca: "", estado: "" });
  const [res, setRes] = useState<RespCreadores | null>(null);
  const [error, setError] = useState("");
  const [buscar, setBuscar] = useState("");
  const [modalNuevo, setModalNuevo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [nuevo, setNuevo] = useState({ supplier_id: "", ad_campaign_id: "", doc_number: "", issue_date: "2026-10-08", amount: "", description: "" });

  const cargar = () => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<RespCreadores>(`/v1/ads/creadores?${q}`).then((r) => {
      setRes(r);
      setError("");
      if (!nuevo.supplier_id && r.opciones.creadores[0]) {
        setNuevo((n) => ({
          ...n,
          supplier_id: r.opciones.creadores[0]?.value ?? "",
          ad_campaign_id: r.opciones.campanas[0]?.value ?? "",
        }));
      }
    }).catch((e) => setError(mensajeDe(e)));
  };
  useEffect(cargar, [f]);

  async function registrar() {
    setGuardando(true);
    setErrores({});
    try {
      const r = await api<{ number: string }>("/v1/ads/creadores", {
        method: "POST",
        body: { ...nuevo, amount: Number(nuevo.amount) },
      });
      toast.ok(`Gasto ${r.number} enviado a aprobación en Gastos`);
      setModalNuevo(false);
      setNuevo((n) => ({ ...n, doc_number: "", amount: "", description: "" }));
      cargar();
    } catch (e) {
      setErrores(erroresDe(e));
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  const c = res?.cifras;
  const colResumen: Column<ResumenCampana>[] = [
    { key: "campaign_name", header: "Campaña", cardTitle: true, render: (x) => <span className="font-semibold text-ink">{x.campaign_name}</span> },
    { key: "platform", header: "Plataforma", render: (x) => <InsigniaPlataforma p={x.platform} label={x.plataforma} /> },
    { key: "brand_name", header: "Marca", render: (x) => x.brand_name },
    { key: "creators_pen", header: "Creadores", align: "right", render: (x) => soles(x.creators_pen) },
    { key: "ads_spend_pen", header: "Inversión en anuncios", align: "right", render: (x) => soles(x.ads_spend_pen) },
    { key: "total_cost_pen", header: "Costo total", align: "right", render: (x) => <span className="font-semibold text-ink">{soles(x.total_cost_pen)}</span> },
    { key: "weight_pct", header: "Peso de creadores", align: "right", render: (x) => x.weight_pct !== null ? porcentaje(x.weight_pct, 1) : "—" },
  ];

  const colGastos: Column<GastoCreador>[] = [
    { key: "number", header: "Gasto", cardTitle: true, render: (e) => <span className="font-mono font-semibold text-ink">{e.number}</span> },
    { key: "issue_date", header: "Fecha", render: (e) => fecha(e.issue_date) },
    { key: "creador", header: "Creador", render: (e) => e.creador },
    { key: "doc", header: "Recibo por honorarios", render: (e) => <span className="font-mono text-[12px]">{e.doc}</span> },
    { key: "campaign_name", header: "Campaña", render: (e) => e.campaign_name },
    { key: "description", header: "Detalle", render: (e) => e.description },
    { key: "amount_pen", header: "Monto", align: "right", render: (e) => soles(e.amount_pen) },
    { key: "withholding_amount", header: "Retención 4.ª", align: "right", hideOnMobile: true, render: (e) => soles(e.withholding_amount) },
    { key: "status", header: "Estado", render: (e) => <Badge tone={TONO_ESTADO[e.status]}>{e.estado}</Badge> },
  ];

  const filtrados = (res?.data ?? []).filter((e) => {
    const s = buscar.trim().toLowerCase();
    return s.length < 2 || [e.number, e.creador, e.campaign_name, e.description, e.doc].some((v) => v.toLowerCase().includes(s));
  });

  return (
    <div className="grid gap-5">
      <PageHeader
        description="Gastos de creadores de contenido (recibo por honorarios) por campaña y su peso en el costo total de la campaña. Se registran en Gastos con la campaña obligatoria."
        actions={res?.puede_registrar ? <Button variant="primary" icon={Plus} onClick={() => setModalNuevo(true)}>Registrar gasto de creador</Button> : undefined}
      />
      {error && <Alert tone="bad">{error}</Alert>}

      <BarraPeriodo desde={f.desde} hasta={f.hasta} onChange={(desde, hasta) => setF({ ...f, desde, hasta })}>
        <FiltroSelect etiqueta="Marca" todos="todas" ancho={180} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={res?.opciones.marcas ?? []} />
      </BarraPeriodo>

      {c && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Cifra titulo="Costo de creadores" valor={soles(c.costo_aprobado_pen)} icono={Sparkles} destacada detalle="aprobados o pagados" />
          <Cifra titulo="Campañas con creadores" valor={numero(c.campanas_con_creadores)} icono={Megaphone} />
          <Cifra titulo="Pendientes de aprobar en GAS" valor={numero(c.pendientes_aprobar)} icono={Clock} tono={c.pendientes_aprobar ? "warn" : undefined} />
        </div>
      )}

      <section className="grid gap-2">
        <h2 className="text-[14px] font-semibold text-ink">Peso en el costo de cada campaña</h2>
        <DataTable
          rowKey={(x) => x.campaign_id}
          columns={colResumen}
          rows={res?.por_campana ?? []}
          loading={!res && !error}
          empty="Sin gastos de creadores aprobados en el período."
        />
      </section>

      <section className="grid gap-2">
        <h2 className="text-[14px] font-semibold text-ink">Recibos por honorarios de creadores</h2>
        <DataTable
          rowKey={(e) => e.id}
          columns={colGastos}
          rows={filtrados}
          loading={!res && !error}
          empty="No hay gastos de creadores en el período."
          search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar creador, recibo o campaña…" }}
          toolbar={
            <FiltroSelect etiqueta="Estado" todos="todos" ancho={165} value={f.estado} onChange={(v) => setF({ ...f, estado: v })}
              options={[{ value: "SUBMITTED", label: "Enviado" }, { value: "APPROVED", label: "Aprobado" }, { value: "PAID", label: "Pagado" }]} />
          }
        />
      </section>

      {modalNuevo && res && (
        <Modal
          open
          onClose={() => setModalNuevo(false)}
          title="Registrar gasto de creador de contenido"
          description="Se registra en Gastos con recibo por honorarios y campaña obligatoria; suma al costo de la campaña cuando es aprobado."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalNuevo(false)}>Cancelar</Button>
              <Button variant="primary" loading={guardando} disabled={!nuevo.supplier_id || !nuevo.ad_campaign_id || !nuevo.doc_number.trim() || !nuevo.amount} onClick={registrar}>
                Enviar a Gastos (GAS)
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Creador de contenido" required error={errores.supplier_id} className="sm:col-span-2">
              <Select value={nuevo.supplier_id} onChange={(e) => setNuevo({ ...nuevo, supplier_id: e.target.value })} options={res.opciones.creadores} />
            </Field>
            <Field label="Campaña publicitaria" required error={errores.ad_campaign_id} className="sm:col-span-2">
              <Select value={nuevo.ad_campaign_id} onChange={(e) => setNuevo({ ...nuevo, ad_campaign_id: e.target.value })} options={res.opciones.campanas} />
            </Field>
            <Field label="Número del recibo (E001-…)" required error={errores.doc_number}>
              <Input className="font-mono" placeholder="58" value={nuevo.doc_number} onChange={(e) => setNuevo({ ...nuevo, doc_number: e.target.value })} />
            </Field>
            <Field label="Fecha de emisión" required>
              <Input type="date" value={nuevo.issue_date} onChange={(e) => setNuevo({ ...nuevo, issue_date: e.target.value })} />
            </Field>
            <Field label="Monto (S/)" required error={errores.amount} hint="Sobre S/ 1 500 se calcula 8 % de retención de 4.ª categoría." className="sm:col-span-2">
              <Input type="number" step="0.01" min="0.01" placeholder="900.00" value={nuevo.amount} onChange={(e) => setNuevo({ ...nuevo, amount: e.target.value })} />
            </Field>
            <Field label="Contenido entregado" className="sm:col-span-2">
              <Textarea rows={2} maxLength={500} placeholder="Video receta caldo de huesos (3 piezas)" value={nuevo.description} onChange={(e) => setNuevo({ ...nuevo, description: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
