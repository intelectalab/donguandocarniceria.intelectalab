"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Megaphone, MessageCircle, QrCode } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, DetailList, Field, FiltroSelect, Input, Modal, PageHeader, Select, Tabs, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { numero, soles } from "@/lib/formato";
import { InsigniaPlataforma, PLATAFORMAS, TONO_ESTADO, type Opcion } from "@/modulos/ads/comun";

type Anuncio = {
  id: string; campaign_id: string; campaign_name: string; campaign_code: string;
  brand_id: string; brand_name: string; brand_code: string; platform: string; plataforma: string;
  code: string; name: string; external_id: string; ad_group_name: string;
  destination: string; destino: string; is_ctwa: boolean;
  channel_id: string | null; whatsapp_number: string | null; tracking_code: string | null;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null;
  landing_url: string | null; enlace: string | null; problemas: string[]; sin_rastreo: boolean;
  status: string; estado: string;
};

type Campana = {
  id: string; code: string; name: string; platform: string; plataforma: string;
  brand_id: string; brand_name: string; account_name: string; currency: string;
  objective: string; daily_budget: number; status: string; estado: string; anuncios_count: number;
};

type RespAnuncios = {
  anuncios: Anuncio[];
  sin_rastreo: Anuncio[];
  campanas: Campana[];
  cifras: { campanas_activas: number; anuncios_activos: number; clic_whatsapp: number; sin_rastreo: number };
  opciones: {
    canales_wa: { value: string; label: string; brand_id: string }[];
    destinos: Opcion[];
    marcas: Opcion[];
  };
  puede: boolean;
};

/** ADS-02 Campañas y anuncios: lista por plataforma y marca con destino, número de WhatsApp, código de rastreo y UTM; marca los anuncios activos sin rastreo. */
function CampanasYAnunciosVista() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState("ads");
  const [f, setF] = useState({ plataforma: "", marca: "", destino: "", estado: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [res, setRes] = useState<RespAnuncios | null>(null);
  const [error, setError] = useState("");
  const [detalle, setDetalle] = useState<Anuncio | null>(null);
  const [editando, setEditando] = useState<Anuncio | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    destination: "WHATSAPP", is_ctwa: false, channel_id: "", tracking_code: "",
    utm_source: "", utm_medium: "", utm_campaign: "", utm_content: "", landing_url: "", status: "ACTIVE",
  });

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 350);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargar = () => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<RespAnuncios>(`/v1/ads/anuncios?${q}`).then((r) => {
      setRes(r);
      setError("");
      const adParam = params.get("ad");
      if (adParam) {
        const encontrado = r.anuncios.find((x) => x.id === adParam);
        if (encontrado) setDetalle(encontrado);
      }
    }).catch((e) => setError(mensajeDe(e)));
  };
  useEffect(cargar, [f]);

  function abrirEdicion(a: Anuncio) {
    setDetalle(null);
    setErrores({});
    setForm({
      destination: a.destination,
      is_ctwa: a.is_ctwa,
      channel_id: a.channel_id ?? "",
      tracking_code: a.tracking_code ?? "",
      utm_source: a.utm_source ?? "",
      utm_medium: a.utm_medium ?? "",
      utm_campaign: a.utm_campaign ?? "",
      utm_content: a.utm_content ?? "",
      landing_url: a.landing_url ?? "",
      status: a.status,
    });
    setEditando(a);
  }

  async function guardarRastreo() {
    if (!editando) return;
    setGuardando(true);
    setErrores({});
    try {
      await api(`/v1/ads/anuncios/${editando.id}/rastreo`, {
        method: "PUT",
        body: {
          ...form,
          channel_id: form.channel_id || null,
          tracking_code: form.tracking_code.trim() || null,
          utm_source: form.utm_source.trim() || null,
          utm_medium: form.utm_medium.trim() || null,
          utm_campaign: form.utm_campaign.trim() || null,
          utm_content: form.utm_content.trim() || null,
          landing_url: form.landing_url.trim() || null,
        },
      });
      toast.ok("Rastreo guardado");
      setEditando(null);
      cargar();
    } catch (e) {
      setErrores(erroresDe(e));
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  const c = res?.cifras;
  const colAnuncios: Column<Anuncio>[] = [
    {
      key: "tracking_code", header: "Rastreo",
      render: (a) => a.tracking_code ? (
        <span className="font-mono text-[12px] font-semibold text-ink">{a.tracking_code}</span>
      ) : a.utm_source ? (
        <Badge tone="info">UTM</Badge>
      ) : (
        <Badge tone="bad">—</Badge>
      ),
    },
    {
      key: "name", header: "Anuncio", cardTitle: true,
      render: (a) => (
        <button type="button" onClick={() => setDetalle(a)} className="cursor-pointer text-left font-semibold text-ink hover:text-primary">
          {a.name}
        </button>
      ),
    },
    { key: "campaign_name", header: "Campaña", render: (a) => a.campaign_name },
    { key: "platform", header: "Plataforma", render: (a) => <InsigniaPlataforma p={a.platform} label={a.plataforma} /> },
    { key: "brand_name", header: "Marca", render: (a) => a.brand_name },
    { key: "destino", header: "Destino", render: (a) => a.destino },
    { key: "whatsapp_number", header: "WhatsApp", hideOnMobile: true, render: (a) => <span className="font-mono text-[12px] text-muted">{a.whatsapp_number || "—"}</span> },
    {
      key: "utm", header: "UTM", hideOnMobile: true,
      render: (a) => a.utm_source ? <span className="font-mono text-[11.5px] text-muted">{`${a.utm_source}/${a.utm_medium ?? ""}/${a.utm_campaign ?? ""}`}</span> : "—",
    },
    {
      key: "problemas", header: "Estado de rastreo",
      render: (a) => a.sin_rastreo ? <Badge tone="bad">Sin rastreo: {a.problemas.join(", ")}</Badge> : <Badge tone="ok">OK</Badge>,
    },
    { key: "status", header: "Estado", render: (a) => <Badge tone={TONO_ESTADO[a.status]}>{a.estado}</Badge> },
    ...(res?.puede ? [{
      key: "acc", header: "", align: "right" as const,
      render: (a: Anuncio) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Button variant={a.sin_rastreo ? "primary" : "ghost"} size="sm" onClick={() => abrirEdicion(a)}>
            {a.sin_rastreo ? "Corregir" : "Rastreo"}
          </Button>
        </div>
      ),
    }] : []),
  ];

  const colCampanas: Column<Campana>[] = [
    { key: "code", header: "Código", render: (x) => <span className="font-mono font-semibold">{x.code}</span> },
    { key: "name", header: "Campaña", cardTitle: true, render: (x) => x.name },
    { key: "platform", header: "Plataforma", render: (x) => <InsigniaPlataforma p={x.platform} label={x.plataforma} /> },
    { key: "brand_name", header: "Marca", render: (x) => x.brand_name },
    { key: "objective", header: "Objetivo", render: (x) => x.objective },
    {
      key: "daily_budget", header: "Presupuesto diario", align: "right",
      render: (x) => x.currency === "USD" ? `USD ${numero(x.daily_budget, 2)}` : soles(x.daily_budget),
    },
    { key: "anuncios_count", header: "Anuncios", align: "right", render: (x) => numero(x.anuncios_count) },
    { key: "status", header: "Estado", render: (x) => <Badge tone={TONO_ESTADO[x.status]}>{x.estado}</Badge> },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Campañas y anuncios por plataforma y marca con su destino, número de WhatsApp, código de rastreo y UTM. Los anuncios activos sin rastreo no cuentan para el retorno por anuncio." />
      {error && <Alert tone="bad">{error}</Alert>}
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Campañas activas" valor={numero(c.campanas_activas)} icono={Megaphone} />
          <Cifra titulo="Anuncios activos" valor={numero(c.anuncios_activos)} icono={CheckCircle2} destacada />
          <Cifra titulo="Clic a WhatsApp (Meta)" valor={numero(c.clic_whatsapp)} icono={MessageCircle} />
          <button type="button" className="text-left" onClick={() => setTab("untracked")}>
            <Cifra titulo="Activos sin rastreo" valor={numero(c.sin_rastreo)} icono={AlertTriangle} tono={c.sin_rastreo ? "bad" : "ok"} detalle="clic para revisarlos" />
          </button>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "ads", label: "Anuncios", count: res?.anuncios.length },
          { key: "untracked", label: "Sin rastreo", count: res?.sin_rastreo.length },
          { key: "camps", label: "Campañas", count: res?.campanas.length },
        ]}
      />

      {tab === "untracked" && (
        <Alert tone={(res?.sin_rastreo.length ?? 0) > 0 ? "warn" : "ok"}>
          Todo anuncio activo hacia WhatsApp necesita el número de WhatsApp de su marca y un código único XX-XXXX; los anuncios hacia la web necesitan parámetros UTM. Corrige estos anuncios para que sus pedidos se atribuyan.
        </Alert>
      )}

      {tab !== "camps" ? (
        <DataTable
          rowKey={(a) => a.id}
          columns={colAnuncios}
          rows={tab === "untracked" ? (res?.sin_rastreo ?? []) : (res?.anuncios ?? [])}
          loading={!res && !error}
          onRowClick={setDetalle}
          empty={tab === "untracked" ? "Todos los anuncios activos tienen su rastreo completo." : "No hay anuncios con estos filtros."}
          search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar anuncio, código o campaña…" }}
          toolbar={
            <>
              <FiltroSelect etiqueta="Plataforma" todos="todas" ancho={160} value={f.plataforma} onChange={(v) => setF({ ...f, plataforma: v })} options={PLATAFORMAS} />
              <FiltroSelect etiqueta="Marca" todos="todas" ancho={175} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={res?.opciones.marcas ?? []} />
              <FiltroSelect etiqueta="Destino" todos="todos" ancho={180} value={f.destino} onChange={(v) => setF({ ...f, destino: v })} options={res?.opciones.destinos ?? []} />
              <FiltroSelect etiqueta="Estado" todos="todos" ancho={150} value={f.estado} onChange={(v) => setF({ ...f, estado: v })}
                options={[{ value: "ACTIVE", label: "Activo" }, { value: "PAUSED", label: "Pausado" }]} />
            </>
          }
        />
      ) : (
        <DataTable
          rowKey={(x) => x.id}
          columns={colCampanas}
          rows={res?.campanas ?? []}
          loading={!res && !error}
          onRowClick={(x) => router.push(`/m/ads/ads-05?campana=${x.id}`)}
          empty="No hay campañas para los filtros seleccionados."
        />
      )}

      {detalle && (
        <Modal
          open
          onClose={() => setDetalle(null)}
          title={`${detalle.tracking_code || detalle.code} · ${detalle.name}`}
          description={`${detalle.plataforma} · ${detalle.brand_name}`}
          footer={
            <div className="flex flex-wrap justify-between gap-2 w-full">
              <div className="flex flex-wrap gap-2">
                {res?.puede && <Button variant="primary" size="sm" onClick={() => abrirEdicion(detalle)}>Editar rastreo</Button>}
                <Link href={`/m/ads/ads-03?ad=${detalle.id}`}><Button variant="ghost" size="sm" icon={QrCode}>Enlace y QR</Button></Link>
                <Link href={`/m/ads/ads-05?anuncio=${detalle.id}`}><Button variant="ghost" size="sm">Ver resultados</Button></Link>
              </div>
              <Button variant="ghost" onClick={() => setDetalle(null)}>Cerrar</Button>
            </div>
          }
        >
          <div className="grid gap-4">
            {detalle.sin_rastreo && (
              <Alert tone="warn">
                Anuncio activo sin rastreo ({detalle.problemas.join(", ")}). No cuenta para el retorno por anuncio hasta corregirlo.
              </Alert>
            )}
            <DetailList
              items={[
                { label: "Plataforma", value: <InsigniaPlataforma p={detalle.platform} label={detalle.plataforma} /> },
                { label: "Marca", value: detalle.brand_name },
                { label: "Campaña", value: `${detalle.campaign_name} (${detalle.campaign_code})` },
                { label: "Grupo de anuncios", value: detalle.ad_group_name },
                { label: "ID en la plataforma", value: <span className="font-mono text-[12px]">{detalle.external_id}</span> },
                { label: "Código interno", value: <span className="font-mono text-[12px]">{detalle.code}</span> },
                { label: "Destino", value: detalle.destino },
                { label: "Número de WhatsApp", value: <span className="font-mono text-[12px]">{detalle.whatsapp_number || "—"}</span> },
                { label: "Código de rastreo", value: <span className="font-mono text-[12px] font-semibold">{detalle.tracking_code || "—"}</span> },
                {
                  label: "UTM",
                  value: detalle.utm_source ? <span className="font-mono text-[12px]">{`${detalle.utm_source} / ${detalle.utm_medium ?? ""} / ${detalle.utm_campaign ?? ""} / ${detalle.utm_content ?? ""}`}</span> : "—",
                },
                { label: "Estado", value: <Badge tone={TONO_ESTADO[detalle.status]}>{detalle.estado}</Badge> },
              ]}
            />
          </div>
        </Modal>
      )}

      {editando && res && (
        <Modal
          open
          onClose={() => setEditando(null)}
          title={`Rastreo de ${editando.tracking_code || editando.code}`}
          description={`${editando.name} · ${editando.brand_name}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
              <Button variant="primary" loading={guardando} onClick={guardarRastreo}>Guardar rastreo</Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Destino" required>
              <Select value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} options={res.opciones.destinos} />
            </Field>
            <Field label="Estado" required>
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                options={[{ value: "ACTIVE", label: "Activo" }, { value: "PAUSED", label: "Pausado" }, { value: "ENDED", label: "Terminado" }, { value: "REMOVED", label: "Eliminado" }]} />
            </Field>
            <div className="sm:col-span-2">
              <Checkbox
                checked={form.is_ctwa}
                onChange={() => setForm({ ...form, is_ctwa: !form.is_ctwa })}
                label="Anuncio de clic a WhatsApp (Meta envía el referral automático)"
              />
            </div>
            <Field label="Número de WhatsApp de la marca" error={errores.channel_id}>
              <Select
                value={form.channel_id}
                onChange={(e) => setForm({ ...form, channel_id: e.target.value })}
                options={[{ value: "", label: "— Seleccionar número —" }, ...res.opciones.canales_wa]}
              />
            </Field>
            <Field label="Código de rastreo (XX-XXXX)" error={errores.tracking_code} hint="Va en el mensaje inicial: «Hola, vi el anuncio DG-A12». Único en la empresa.">
              <Input className="font-mono" placeholder="DG-A12" value={form.tracking_code} onChange={(e) => setForm({ ...form, tracking_code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="utm_source" error={errores.utm_source}>
              <Input className="font-mono" placeholder="google, facebook, tiktok" value={form.utm_source} onChange={(e) => setForm({ ...form, utm_source: e.target.value })} />
            </Field>
            <Field label="utm_medium">
              <Input className="font-mono" placeholder="cpc" value={form.utm_medium} onChange={(e) => setForm({ ...form, utm_medium: e.target.value })} />
            </Field>
            <Field label="utm_campaign">
              <Input className="font-mono" placeholder="DG-GO-SRCH" value={form.utm_campaign} onChange={(e) => setForm({ ...form, utm_campaign: e.target.value })} />
            </Field>
            <Field label="utm_content">
              <Input className="font-mono" placeholder="DGGSR2" value={form.utm_content} onChange={(e) => setForm({ ...form, utm_content: e.target.value })} />
            </Field>
            <Field label="Página de destino (landing URL)" className="sm:col-span-2">
              <Input className="font-mono" placeholder="https://www.donguando.com/tienda/" value={form.landing_url} onChange={(e) => setForm({ ...form, landing_url: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function CampanasYAnuncios() {
  return <Suspense><CampanasYAnunciosVista /></Suspense>;
}
