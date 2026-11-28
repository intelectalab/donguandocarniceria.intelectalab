"use client";

import { useState } from "react";
import { Plus, Power } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, StatusBadge, confirmAction, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useDatos } from "@/modulos/fac/comunes";

type Serie = {
  id: string; series: string; doc_type: string; tipo: string; brand_id: string | null; brand: string | null; establishment_id: string | null; site: string | null; all_sites: boolean;
  applies_to: string | null; next_number: number; status: string; status_reason: string | null; is_electronic: boolean; note: string | null; company_id: string; ultimo: string | null; emitidos: number; uso: number;
};
type Respuesta = {
  series: Serie[];
  opciones: { empresas: { id: string; legal_name: string; ruc: string }[]; marcas: { id: string; name: string }[]; locales: { id: string; name: string; short: string | null }[] };
};

const TIPOS: Record<string, string> = { INVOICE: "Factura", RECEIPT: "Boleta", CREDIT_NOTE: "Nota de crédito", DEBIT_NOTE: "Nota de débito", DISPATCH_GUIDE: "Guía de remisión" };
const EJEMPLO: Record<string, string> = { INVOICE: "F001", RECEIPT: "B001", CREDIT_NOTE: "FC01 o BC01", DEBIT_NOTE: "FD01 o BD01", DISPATCH_GUIDE: "T001" };
const ESTADO: Record<string, [string, "ok" | "neutral"]> = { ACTIVE: ["Activa", "ok"], INACTIVE: ["Inactiva", "neutral"] };

/** FAC-10 Series: por tipo, marca y local, con el correlativo siguiente y su estado. */
export default function Series() {
  const { can, marca } = useSesion();
  const [tipo, setTipo] = useState("");
  const p = new URLSearchParams(Object.entries({ doc_type: tipo, brand: marca !== "ALL" ? marca : "" }).filter(([, v]) => v));
  const { datos: d, error, cargando, recargar } = useDatos<Respuesta>(`/v1/fac/series?${p}`);
  const [nueva, setNueva] = useState(false);
  const gestiona = can("fac.series.manage");

  async function cambiar(s: Serie) {
    const activar = s.status !== "ACTIVE";
    const r = await confirmAction({
      title: `${activar ? "Activar" : "Desactivar"} la serie ${s.series}`, danger: !activar, confirmLabel: activar ? "Activar" : "Desactivar",
      message: activar ? "Vuelve a numerar comprobantes." : "Una serie inactiva no numera: los comprobantes usarán otra serie activa de la marca y el local.",
      reason: { label: "Motivo (10 a 40 letras)", min: 10 },
    });
    if (!r) return;
    try {
      await api(`/v1/fac/series/${s.id}/estado`, { method: "PUT", body: { status: activar ? "ACTIVE" : "INACTIVE", reason: (r.reason ?? "").slice(0, 40) } });
      toast.ok(`Serie ${s.series} ${activar ? "activada" : "desactivada"}.`);
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const columnas: Column<Serie>[] = [
    { key: "series", header: "Serie", cardTitle: true, render: (s) => <div><div className="font-mono font-semibold">{s.series}</div><div className="text-[12px] text-muted">{s.tipo}{s.applies_to ? ` · de ${s.applies_to === "INVOICE" ? "facturas" : "boletas"}` : ""}</div></div> },
    { key: "brand", header: "Marca", render: (s) => s.brand ?? <span className="text-muted">Mostrador o todas</span> },
    { key: "site", header: "Local", render: (s) => (s.all_sites ? "Todos" : s.site ?? "Todos") },
    { key: "next_number", header: "Siguiente", align: "right", render: (s) => <div><div className="font-mono tabular-nums">{String(s.next_number).padStart(8, "0")}</div>{s.uso >= 80 && <div className="text-[11.5px] text-warn">{numero(s.uso, 1)} % usado</div>}</div> },
    { key: "emitidos", header: "Emitidos", align: "right", hideOnMobile: true, render: (s) => <div>{numero(s.emitidos)}<div className="text-[11.5px] text-muted">{s.ultimo ? fechaHora(s.ultimo) : "—"}</div></div> },
    { key: "status", header: "Estado", render: (s) => <div><StatusBadge status={s.status} labels={ESTADO} />{s.status_reason && <div className="text-[11.5px] text-muted">{s.status_reason}</div>}{!s.is_electronic && <Badge>No electrónica</Badge>}</div> },
    { key: "acc", header: "", align: "right", render: (s) => gestiona ? <Button size="sm" icon={Power} onClick={(e) => { e.stopPropagation(); cambiar(s); }}>{s.status === "ACTIVE" ? "Desactivar" : "Activar"}</Button> : null },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Cada marca emite con su propia serie (F001, B001…) y el mismo RUC de la empresa. Una nota usa la serie de su tipo y del comprobante que modifica (FC01 para facturas, BC01 para boletas)."
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => setNueva(true)}>Nueva serie</Button>} />
      {error && <Alert tone="bad">{error}</Alert>}
      <DataTable rows={d?.series ?? []} columns={columnas} loading={cargando && !d} empty="No hay series de este tipo."
        toolbar={<FiltroSelect etiqueta="Tipo" value={tipo} onChange={setTipo} options={Object.entries(TIPOS).map(([value, label]) => ({ value, label }))} ancho={180} />} />
      {d && <NuevaSerie abierta={nueva} cerrar={() => setNueva(false)} opciones={d.opciones} listo={() => { setNueva(false); recargar(); }} />}
    </div>
  );
}

function NuevaSerie({ abierta, cerrar, opciones, listo }: { abierta: boolean; cerrar: () => void; opciones: Respuesta["opciones"]; listo: () => void }) {
  const [v, setV] = useState({ company_id: "", doc_type: "INVOICE", series: "", establishment_id: "", brand_id: "", next_number: "1", note: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const empresa = v.company_id || opciones.empresas[0]?.id || "";
  const set = (k: keyof typeof v, x: string) => setV({ ...v, [k]: x });

  async function guardar() {
    setGuardando(true);
    setErrores({});
    try {
      const s = await api<{ series: string }>("/v1/fac/series", { method: "POST", body: {
        company_id: empresa, doc_type: v.doc_type, series: v.series.trim().toUpperCase(), establishment_id: v.establishment_id || null, brand_id: v.brand_id || null,
        next_number: Number(v.next_number || 1), note: v.note.trim() || null,
      } });
      toast.ok(`Serie ${s.series} creada.`);
      setV({ ...v, series: "", note: "" });
      listo();
    } catch (e) {
      setErrores(erroresDe(e));
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open={abierta} onClose={cerrar} title="Nueva serie" description="Formato SUNAT, única en la empresa. El correlativo no se reutiliza."
      footer={<><Button onClick={cerrar}>Cancelar</Button><Button variant="primary" loading={guardando} disabled={!v.series.trim()} onClick={guardar}>Crear serie</Button></>}>
      <div className="space-y-3">
        {opciones.empresas.length > 1 && (
          <Field label="Empresa" error={errores.company_id}>
            <Select value={empresa} onChange={(e) => set("company_id", e.target.value)} options={opciones.empresas.map((x) => ({ value: x.id, label: `${x.legal_name} · ${x.ruc}` }))} />
          </Field>
        )}
        <Field label="Tipo" error={errores.doc_type}>
          <Select value={v.doc_type} onChange={(e) => set("doc_type", e.target.value)} options={Object.entries(TIPOS).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Serie" hint={`Por ejemplo ${EJEMPLO[v.doc_type]}.`} error={errores.series}>
          <Input value={v.series} maxLength={4} onChange={(e) => set("series", e.target.value.toUpperCase())} className="font-mono" />
        </Field>
        <Field label="Marca" hint="Sin marca, la serie es del mostrador o de todas." error={errores.brand_id}>
          <Select value={v.brand_id} onChange={(e) => set("brand_id", e.target.value)} placeholder="Sin marca" options={opciones.marcas.map((x) => ({ value: x.id, label: x.name }))} />
        </Field>
        <Field label="Local" error={errores.establishment_id}>
          <Select value={v.establishment_id} onChange={(e) => set("establishment_id", e.target.value)} placeholder="Todos los locales" options={opciones.locales.map((x) => ({ value: x.id, label: x.name }))} />
        </Field>
        <Field label="Correlativo inicial" hint="Si la serie ya se usó en otro sistema, el siguiente número libre." error={errores.next_number}>
          <Input type="number" inputMode="numeric" min={1} value={v.next_number} onChange={(e) => set("next_number", e.target.value)} />
        </Field>
        <Field label="Nota" error={errores.note}><Input value={v.note} maxLength={255} onChange={(e) => set("note", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
