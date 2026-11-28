"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, DollarSign, Megaphone, PauseCircle, PlayCircle, Plus, RefreshCw, Unplug } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, Field, FiltroSelect, Input, Modal, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, numero, soles } from "@/lib/formato";
import { InsigniaPlataforma, PLATAFORMAS, TONO_ESTADO, type Opcion } from "@/modulos/ads/comun";

type Cuenta = {
  id: string; platform: string; plataforma: string; brand_id: string; brand_name: string; brand_code: string;
  name: string; external_id: string; currency: string; timezone: string; supplier_id: string | null; proveedor: string;
  connected_at: string; last_import_at: string | null; ultimo_estado: string | null; ultimo_error: string | null;
  gasto_mes_pen: number; campanas_count: number; status: string; estado: string;
  tc_hoy?: number;
  campanas?: { id: string; code: string; name: string; objective: string; daily_budget: number; status: string; anuncios_count: number }[];
};

type RespCuentas = {
  data: Cuenta[];
  cifras: { conectadas: number; total: number; gasto_mes_pen: number; mes_etiqueta: string; en_dolares: number; fallidas: number; fallidas_nombres: string[] };
  tc_hoy: number;
  hora_importacion: string;
  opciones: { marcas: Opcion[]; proveedores: Opcion[] };
  puede: boolean;
};

/** ADS-01 Cuentas publicitarias: conectar cuentas de Google Ads, Meta Ads y TikTok Ads; marca, moneda, zona horaria, proveedor y última importación. */
export default function CuentasPublicitarias() {
  const [f, setF] = useState({ plataforma: "", marca: "", estado: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [res, setRes] = useState<RespCuentas | null>(null);
  const [error, setError] = useState("");
  const [detalle, setDetalle] = useState<Cuenta | null>(null);
  const [modalNueva, setModalNueva] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [nueva, setNueva] = useState({ platform: "META", brand_id: "", external_id: "", name: "", currency: "USD", timezone: "America/Lima", supplier_id: "" });

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 350);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargar = () => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<RespCuentas>(`/v1/ads/cuentas?${q}`).then((r) => {
      setRes(r);
      setError("");
      if (!nueva.brand_id && r.opciones.marcas[0]) {
        setNueva((n) => ({ ...n, brand_id: r.opciones.marcas[0].value, supplier_id: r.opciones.proveedores[0]?.value ?? "" }));
      }
    }).catch((e) => setError(mensajeDe(e)));
  };
  useEffect(cargar, [f]);

  async function abrirDetalle(a: Cuenta) {
    try {
      const r = await api<Cuenta>(`/v1/ads/cuentas/${a.id}`);
      setDetalle(r);
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function cambiarEstado(a: Cuenta, status: string) {
    try {
      const r = await api<Cuenta>(`/v1/ads/cuentas/${a.id}/estado`, { method: "POST", body: { status } });
      setDetalle(r);
      toast.ok(`Cuenta ${r.estado.toLowerCase()}`);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function importarAyer(a: Cuenta) {
    try {
      const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const r = await api<{ rows_read: number; rows_upserted: number }>("/v1/ads/importaciones/reimportar", {
        method: "POST",
        body: { account_id: a.id, from: ayer, to: ayer },
      });
      toast.ok(`Importación lista: ${r.rows_read} filas leídas, ${r.rows_upserted} actualizadas`);
      cargar();
      abrirDetalle(a);
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function conectar() {
    setEnviando(true);
    setErrores({});
    try {
      await api("/v1/ads/cuentas", { method: "POST", body: { ...nueva, supplier_id: nueva.supplier_id || null } });
      toast.ok(`Cuenta ${nueva.name} conectada`);
      setModalNueva(false);
      setNueva((n) => ({ ...n, external_id: "", name: "" }));
      cargar();
    } catch (e) {
      setErrores(erroresDe(e));
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  const c = res?.cifras;
  const cols: Column<Cuenta>[] = [
    { key: "platform", header: "Plataforma", render: (a) => <InsigniaPlataforma p={a.platform} label={a.plataforma} /> },
    {
      key: "name", header: "Cuenta", cardTitle: true,
      render: (a) => (
        <button type="button" onClick={() => abrirDetalle(a)} className="cursor-pointer text-left font-semibold text-ink hover:text-primary">
          {a.name}
        </button>
      ),
    },
    { key: "brand_name", header: "Marca", render: (a) => a.brand_name },
    { key: "external_id", header: "ID externo", render: (a) => <span className="font-mono text-[12px]">{a.external_id}</span> },
    { key: "currency", header: "Moneda", render: (a) => a.currency },
    { key: "timezone", header: "Zona horaria", hideOnMobile: true, render: (a) => <span className="text-[12px] text-muted">{a.timezone}</span> },
    { key: "proveedor", header: "Proveedor (factura)", hideOnMobile: true, render: (a) => a.proveedor },
    { key: "gasto_mes_pen", header: "Inversión mes", align: "right", render: (a) => soles(a.gasto_mes_pen) },
    {
      key: "last_import_at", header: "Última importación",
      render: (a) => a.last_import_at ? (
        <div className="flex items-center gap-1.5 text-[12px]">
          <span>{fechaHora(a.last_import_at)}</span>
          {a.ultimo_estado && <Badge tone={TONO_ESTADO[a.ultimo_estado] ?? "neutral"}>{a.ultimo_estado}</Badge>}
        </div>
      ) : "—",
    },
    { key: "status", header: "Estado", render: (a) => <Badge tone={TONO_ESTADO[a.status]}>{a.estado}</Badge> },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader
        description="Cuentas de Google Ads, Meta Ads y TikTok Ads por marca: moneda, zona horaria, proveedor para la factura y estado de la última importación."
        actions={res?.puede ? <Button variant="primary" icon={Plus} onClick={() => setModalNueva(true)}>Conectar cuenta</Button> : undefined}
      />
      {error && <Alert tone="bad">{error}</Alert>}
      {c && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra titulo="Cuentas conectadas" valor={numero(c.conectadas)} icono={CheckCircle2} destacada detalle={`${numero(c.total)} en total`} />
            <Cifra titulo={`Inversión (${c.mes_etiqueta})`} valor={soles(c.gasto_mes_pen)} icono={Megaphone} detalle="en soles" />
            <Cifra titulo="Cuentas en dólares" valor={numero(c.en_dolares)} icono={DollarSign} detalle={`TC venta hoy S/ ${numero(res?.tc_hoy, 3)}`} />
            <Link href="/m/ads/ads-04" className="contents">
              <Cifra titulo="Última importación fallida" valor={numero(c.fallidas)} icono={AlertTriangle} tono={c.fallidas ? "bad" : "ok"} detalle={c.fallidas_nombres.join(", ") || "ninguna"} />
            </Link>
          </div>
          {c.fallidas > 0 && (
            <Alert tone="bad">
              La corrida diaria de las {res?.hora_importacion} falló para <strong>{c.fallidas_nombres.join(", ")}</strong>. Reconecta la cuenta y reimporta el rango en <Link href="/m/ads/ads-04" className="font-semibold underline">Importaciones</Link>.
            </Alert>
          )}
        </>
      )}

      <DataTable
        rowKey={(a) => a.id}
        columns={cols}
        rows={res?.data ?? []}
        loading={!res && !error}
        onRowClick={abrirDetalle}
        empty="Aún no hay cuentas publicitarias conectadas."
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar cuenta, ID externo o marca…" }}
        toolbar={
          <>
            <FiltroSelect etiqueta="Plataforma" todos="todas" ancho={165} value={f.plataforma} onChange={(v) => setF({ ...f, plataforma: v })} options={PLATAFORMAS} />
            <FiltroSelect etiqueta="Marca" todos="todas" ancho={180} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={res?.opciones.marcas ?? []} />
            <FiltroSelect etiqueta="Estado" todos="todos" ancho={165} value={f.estado} onChange={(v) => setF({ ...f, estado: v })}
              options={[{ value: "ACTIVE", label: "Activa" }, { value: "PAUSED", label: "Pausada" }, { value: "DISCONNECTED", label: "Desconectada" }]} />
          </>
        }
      />

      {detalle && (
        <Modal
          open
          onClose={() => setDetalle(null)}
          title={detalle.name}
          description={`${detalle.plataforma} · ${detalle.brand_name}`}
          footer={
            <div className="flex flex-wrap justify-between gap-2 w-full">
              <div className="flex flex-wrap gap-2">
                {res?.puede && <Button variant="primary" size="sm" icon={RefreshCw} onClick={() => importarAyer(detalle)}>Importar ayer</Button>}
                {res?.puede && (detalle.status === "ACTIVE"
                  ? <Button variant="ghost" size="sm" icon={PauseCircle} onClick={() => cambiarEstado(detalle, "PAUSED")}>Pausar</Button>
                  : <Button variant="ghost" size="sm" icon={PlayCircle} onClick={() => cambiarEstado(detalle, "ACTIVE")}>Reconectar</Button>)}
                {res?.puede && detalle.status !== "DISCONNECTED" && (
                  <Button variant="danger" size="sm" icon={Unplug} onClick={() => cambiarEstado(detalle, "DISCONNECTED")}>Desconectar</Button>
                )}
              </div>
              <Button variant="ghost" onClick={() => setDetalle(null)}>Cerrar</Button>
            </div>
          }
        >
          <div className="grid gap-4">
            <DetailList
              items={[
                { label: "Plataforma", value: <InsigniaPlataforma p={detalle.platform} label={detalle.plataforma} /> },
                { label: "Marca", value: detalle.brand_name },
                { label: "ID externo", value: <span className="font-mono text-[12.5px]">{detalle.external_id}</span> },
                { label: "Moneda", value: `${detalle.currency}${detalle.currency !== "PEN" && detalle.tc_hoy ? ` (TC venta hoy S/ ${numero(detalle.tc_hoy, 3)})` : ""}` },
                { label: "Zona horaria", value: `${detalle.timezone} · el gasto se asigna al día de esta zona` },
                { label: "Proveedor (factura)", value: detalle.proveedor },
                { label: "Conectada desde", value: fechaHora(detalle.connected_at) },
                { label: "Última importación", value: fechaHora(detalle.last_import_at) },
                { label: "Estado", value: <Badge tone={TONO_ESTADO[detalle.status]}>{detalle.estado}</Badge> },
              ]}
            />
            {detalle.campanas && detalle.campanas.length > 0 && (
              <div className="grid gap-2">
                <p className="text-[12.5px] font-semibold text-ink">Campañas de la cuenta</p>
                <div className="divide-y divide-line rounded-lg border border-line">
                  {detalle.campanas.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                      <div>
                        <span className="font-mono font-semibold text-ink">{c.code}</span> · <span>{c.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted">{c.anuncios_count} anuncios</span>
                        <Badge tone={TONO_ESTADO[c.status]}>{c.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {modalNueva && res && (
        <Modal
          open
          onClose={() => setModalNueva(false)}
          title="Conectar cuenta publicitaria"
          description="La conexión se autoriza una vez en la plataforma. Después, la importación corre sola cada día a las 06:00."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalNueva(false)}>Cancelar</Button>
              <Button variant="primary" loading={enviando} disabled={!nueva.name.trim() || !nueva.external_id.trim()} onClick={conectar}>Conectar cuenta</Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Plataforma" required>
              <Select
                value={nueva.platform}
                onChange={(e) => setNueva({ ...nueva, platform: e.target.value, currency: e.target.value === "GOOGLE" ? "PEN" : "USD" })}
                options={PLATAFORMAS}
              />
            </Field>
            <Field label="Marca" required>
              <Select value={nueva.brand_id} onChange={(e) => setNueva({ ...nueva, brand_id: e.target.value })} options={res.opciones.marcas} />
            </Field>
            <Field label="ID de la cuenta en la plataforma" required error={errores.external_id}>
              <Input className="font-mono" placeholder="act_1234567890" value={nueva.external_id} onChange={(e) => setNueva({ ...nueva, external_id: e.target.value })} />
            </Field>
            <Field label="Nombre" required error={errores.name}>
              <Input placeholder="Meta Ads · Don Guando" value={nueva.name} onChange={(e) => setNueva({ ...nueva, name: e.target.value })} />
            </Field>
            <Field label="Moneda" required>
              <Select value={nueva.currency} onChange={(e) => setNueva({ ...nueva, currency: e.target.value })}
                options={[{ value: "PEN", label: "Soles (PEN)" }, { value: "USD", label: "Dólares (USD)" }]} />
            </Field>
            <Field label="Zona horaria" required>
              <Select value={nueva.timezone} onChange={(e) => setNueva({ ...nueva, timezone: e.target.value })}
                options={[{ value: "America/Lima", label: "America/Lima" }, { value: "UTC", label: "UTC" }, { value: "America/Los_Angeles", label: "America/Los_Angeles" }]} />
            </Field>
            <Field label="Proveedor para la factura" className="sm:col-span-2">
              <Select value={nueva.supplier_id} onChange={(e) => setNueva({ ...nueva, supplier_id: e.target.value })} options={res.opciones.proveedores} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
