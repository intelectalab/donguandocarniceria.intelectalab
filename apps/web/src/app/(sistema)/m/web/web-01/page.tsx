"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Boxes, Globe, PackageCheck, Pencil, Plug, Plus, Power, RefreshCw, ShoppingBag } from "lucide-react";
import {
  Alert, Badge, Button, Checkbox, Cifra, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, confirmAction, toast,
} from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { numero, porcentaje } from "@/lib/formato";
import { ESTADO_TIENDA, Historial, Seccion, Vacio, cuando, useDatos, type Historia } from "@/modulos/web/comunes";

type Fila = {
  id: string; code: string; name: string; url: string; theme: string | null; status: string; marca: string | null; categorias: string[]; lista: string | null;
  local: string | null; almacenes: string[]; safety_margin_pct: number; vendedora: string | null; sync_catalog: boolean; sync_prices: boolean; sync_stock: boolean;
  sync_orders: boolean; last_test_at: string | null; last_test_ok: boolean | null; last_test_msg: string | null;
};
type Lista = {
  data: Fila[]; puede_editar: boolean;
  cifras: { activas: number; total: number; pedidos_hoy: number; publicados: number; ultimo_stock: { started_at: string; status: string } | null; stock_cada: number };
};
type Conector = { id: string; code: string; name: string; environment: string; status: string; adapter: string } | null;
type Detalle = Fila & {
  brand_id: string; brands: string[]; price_list_id: string; establishment_id: string; warehouse_ids: string[]; default_seller_id: string | null;
  connector_id: string | null; payment_connector_id: string | null; created_by: string | null; listas: { marca: string; lista: string }[];
  conector: Conector; conector_pagos: Conector; webhook: { name: string; url: string; status: string } | null; webhook_pagos: { name: string; url: string; status: string } | null;
  credenciales: { conector: string; name: string; version: number; valor: string }[]; stock_cada: number; consulta_cada: number; history: Historia[]; puede_editar: boolean;
};
type Opciones = {
  marcas: { id: string; name: string }[]; listas: { id: string; code: string; name: string; brand_id: string | null }[]; locales: { id: string; name: string }[];
  almacenes: { id: string; name: string; establishment_id: string }[]; vendedoras: { id: string; name: string }[];
  conectores: { id: string; name: string; kind: string; environment: string }[];
};

const SINCRONIZA: [keyof Fila, string][] = [["sync_catalog", "Catálogo"], ["sync_prices", "Precios"], ["sync_stock", "Stock"], ["sync_orders", "Pedidos"]];

/** WEB-01 Tiendas: la tienda WooCommerce de cada marca, qué sincroniza, su conexión y su estado. */
export default function Tiendas() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const inicial = useSearchParams().get("id");
  const { datos, error, recargar } = useDatos<Lista>("/v1/web/tiendas");
  const [abierta, setAbierta] = useState<string | null>(inicial);
  const [editando, setEditando] = useState<Detalle | "nueva" | null>(null);
  const c = datos?.cifras;

  function cerrar() {
    setAbierta(null);
    if (inicial) router.replace("/m/web/web-01");
  }

  return (
    <div className="space-y-5">
      <PageHeader description="La tienda de cada marca en WooCommerce: lista de precios, almacenes de donde sale el stock, margen de seguridad y qué se sincroniza. Las claves de la tienda y de Mercado Pago se guardan cifradas en Integraciones."
        actions={datos?.puede_editar && <Button variant="primary" icon={Plus} onClick={() => setEditando("nueva")}>Nueva tienda</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Tiendas activas" icono={Globe} destacada valor={c ? `${c.activas} de ${c.total}` : undefined} detalle="Venden en la web" />
        <Cifra titulo="Pedidos web hoy" icono={ShoppingBag} valor={c ? numero(c.pedidos_hoy) : undefined} detalle="Recibidos en la bandeja" />
        <Cifra titulo="Productos publicados" icono={PackageCheck} valor={c ? numero(c.publicados) : undefined} detalle="En las tiendas activas" />
        <Cifra titulo="Último stock enviado" icono={Boxes} tono={c?.ultimo_stock?.status === "FAILED" ? "bad" : undefined}
          valor={c ? (c.ultimo_stock ? cuando(c.ultimo_stock.started_at) : "—") : undefined} detalle={c ? `Cada ${c.stock_cada} min y tras cada venta` : undefined} />
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {!datos ? <Vacio>Cargando…</Vacio> : !datos.data.length ? <Seccion><Vacio>Todavía no hay tiendas web. Crea la primera con «Nueva tienda».</Vacio></Seccion> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {datos.data.map((s) => (
            <button key={s.id} type="button" onClick={() => setAbierta(s.id)}
              className="min-w-0 cursor-pointer rounded-xl border border-line bg-surface p-4 text-left shadow-card transition-colors hover:bg-surface-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-ink">{s.name}</div>
                  <div className="truncate text-[12.5px] text-muted">{s.url}{s.theme ? ` · ${s.theme}` : ""}</div>
                </div>
                <StatusBadge status={s.status} labels={ESTADO_TIENDA} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-muted">Marca</dt><dd className="min-w-0 truncate text-ink">{s.marca ?? "—"}{s.categorias.length ? ` +${s.categorias.length}` : ""}</dd>
                <dt className="text-muted">Lista</dt><dd className="text-ink">{s.lista ?? "—"}</dd>
                <dt className="text-muted">Margen</dt><dd className="text-ink">{porcentaje(s.safety_margin_pct)}</dd>
                <dt className="text-muted">Vendedora</dt><dd className="min-w-0 truncate text-ink">{s.vendedora ?? "—"}</dd>
              </dl>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {SINCRONIZA.map(([k, t]) => <Badge key={k} tone={s[k] ? "info" : "neutral"}>{s[k] ? t : `Sin ${t.toLowerCase()}`}</Badge>)}
              </div>
              <p className={`mt-3 text-[12.5px] ${s.last_test_ok ? "text-ok" : s.last_test_ok === false ? "text-bad" : "text-muted"}`}>
                {s.last_test_at ? `Prueba de conexión ${s.last_test_ok ? "correcta" : "fallida"} · ${cuando(s.last_test_at)}` : "Sin prueba de conexión"}
              </p>
            </button>
          ))}
        </div>
      )}
      {abierta && <FichaTienda id={abierta} onClose={cerrar} onCambio={recargar} onEditar={(d) => setEditando(d)} />}
      {editando && <FormTienda tienda={editando === "nueva" ? null : editando} onClose={() => setEditando(null)}
        onGuardada={(d) => { setEditando(null); recargar(); setAbierta(d.id); }} />}
    </div>
  );
}

function FichaTienda({ id, onClose, onCambio, onEditar }: { id: string; onClose: () => void; onCambio: () => void; onEditar: (d: Detalle) => void }) {
  const { datos: s, error, recargar } = useDatos<Detalle>(`/v1/web/tiendas/${id}`);
  const [probando, setProbando] = useState(false);

  async function probar() {
    setProbando(true);
    try {
      const r = await api<{ ok: boolean; mensaje: string }>(`/v1/web/tiendas/${id}/probar`, { method: "POST" });
      if (r.ok) toast.ok(r.mensaje); else toast.error(r.mensaje);
      recargar();
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProbando(false);
    }
  }

  async function estado(nuevo: string) {
    if (!s) return;
    const r = await confirmAction({ title: `¿Pasar ${s.name} a «${ESTADO_TIENDA[nuevo][0]}»?`, confirmLabel: "Cambiar estado", danger: nuevo === "DISABLED",
      message: nuevo === "ACTIVE" ? "La tienda empieza a recibir pedidos y a publicar precios y stock." : nuevo === "DISABLED" ? "Deja de sincronizar y de recibir pedidos." : undefined,
      reason: { label: "Motivo", min: 10 } });
    if (!r) return;
    try {
      await api(`/v1/web/tiendas/${id}/estado`, { method: "POST", body: { status: nuevo, reason: r.reason } });
      toast.ok("Estado cambiado.");
      recargar();
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const estados = s ? Object.keys(ESTADO_TIENDA).filter((k) => k !== s.status && k !== "PENDING") : [];
  return (
    <Modal open onClose={onClose} title={s?.name ?? "Tienda"} description={s ? `${s.code} · ${s.url}` : undefined} size="lg"
      footer={<>
        {s?.puede_editar && <Button icon={Plug} loading={probando} onClick={probar}>Probar conexión</Button>}
        {s?.puede_editar && <Button icon={Pencil} onClick={() => onEditar(s)}>Editar</Button>}
        <Button variant="primary" onClick={onClose}>Cerrar</Button>
      </>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!s ? <Vacio>Cargando…</Vacio> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={s.status} labels={ESTADO_TIENDA} />
            {s.puede_editar && estados.map((k) => (
              <Button key={k} size="sm" variant="ghost" icon={Power} onClick={() => estado(k)}>{ESTADO_TIENDA[k][0]}</Button>
            ))}
          </div>
          {s.last_test_at && (
            <Alert tone={s.last_test_ok ? "ok" : "bad"} title={`Prueba de conexión ${s.last_test_ok ? "correcta" : "fallida"} · ${cuando(s.last_test_at)}`}>{s.last_test_msg}</Alert>
          )}
          {!s.last_test_ok && s.status !== "ACTIVE" && <Alert tone="info">Para activar la tienda primero prueba la conexión con resultado correcto (RN-WEB-10).</Alert>}
          <DetailList items={[
            { label: "Marca", value: s.marca ?? "—" },
            { label: "Listas de precios", value: s.listas.map((l) => `${l.marca}: ${l.lista}`).join(" · ") || "—" },
            { label: "Local", value: s.local ?? "—" },
            { label: "Almacenes de stock", value: s.almacenes.join(", ") || "—" },
            { label: "Margen de seguridad", value: `${porcentaje(s.safety_margin_pct)} (se publica el disponible × ${numero(1 - s.safety_margin_pct / 100, 2)}, hacia abajo)` },
            { label: "Vendedora por defecto", value: s.vendedora ?? "—" },
            { label: "Sincroniza", value: SINCRONIZA.filter(([k]) => s[k]).map(([, t]) => t).join(", ") || "Nada" },
            { label: "Frecuencia", value: `Stock cada ${s.stock_cada} min y tras cada venta · consulta de pedidos cada ${s.consulta_cada} min` },
          ]} />
          <Seccion titulo="Conexión (Integraciones)">
            <div className="space-y-2 text-[13.5px]">
              {[{ t: "WooCommerce", cn: s.conector, wh: s.webhook }, { t: "Mercado Pago", cn: s.conector_pagos, wh: s.webhook_pagos }].map(({ t, cn, wh }) => (
                <div key={t} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{t}</span>
                    {cn ? <Badge tone={cn.environment === "SANDBOX" ? "info" : "primary"}>{cn.environment === "SANDBOX" ? "Prueba" : "Producción"}</Badge> : <Badge tone="warn">Sin conector</Badge>}
                  </div>
                  {cn && <div className="text-muted">{cn.name}</div>}
                  {wh && <div className="mt-1 break-all text-[12.5px] text-muted">Webhook: {wh.url}</div>}
                </div>
              ))}
              {s.credenciales.length > 0 && (
                <ul className="text-[12.5px] text-muted">
                  {s.credenciales.map((k) => <li key={`${k.conector}-${k.name}`}>{k.conector} · {k.name} v{k.version} · {k.valor}</li>)}
                </ul>
              )}
              <p className="text-[12.5px] text-muted">Las claves se cargan y rotan en Integraciones (INT-03) y nunca vuelven al navegador.</p>
            </div>
          </Seccion>
          <Seccion titulo="Historial"><Historial items={s.history} /></Seccion>
        </div>
      )}
    </Modal>
  );
}

type Form = {
  name: string; url: string; theme: string; brand_id: string; brands: string[]; price_list_id: string; establishment_id: string; warehouse_ids: string[];
  safety_margin_pct: string; default_seller_id: string; sync_catalog: boolean; sync_prices: boolean; sync_stock: boolean; sync_orders: boolean;
  connector_id: string; payment_connector_id: string;
};

function FormTienda({ tienda, onClose, onGuardada }: { tienda: Detalle | null; onClose: () => void; onGuardada: (d: Detalle) => void }) {
  const { datos: op } = useDatos<Opciones>("/v1/web/tiendas/opciones");
  const [f, setF] = useState<Form>(() => ({
    name: tienda?.name ?? "", url: tienda?.url ?? "https://", theme: tienda?.theme ?? "", brand_id: tienda?.brand_id ?? "",
    brands: (tienda?.brands ?? []).filter((b) => b !== tienda?.brand_id), price_list_id: tienda?.price_list_id ?? "", establishment_id: tienda?.establishment_id ?? "",
    warehouse_ids: tienda?.warehouse_ids ?? [], safety_margin_pct: String(tienda?.safety_margin_pct ?? 10), default_seller_id: tienda?.default_seller_id ?? "",
    sync_catalog: tienda?.sync_catalog ?? true, sync_prices: tienda?.sync_prices ?? true, sync_stock: tienda?.sync_stock ?? true, sync_orders: tienda?.sync_orders ?? true,
    connector_id: tienda?.connector_id ?? "", payment_connector_id: tienda?.payment_connector_id ?? "",
  }));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState("");
  const [guardando, setGuardando] = useState(false);
  const poner = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const alternar = (k: "brands" | "warehouse_ids", id: string, si: boolean) => setF((x) => ({ ...x, [k]: si ? [...x[k], id] : x[k].filter((y) => y !== id) }));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setErrores({});
    setGeneral("");
    try {
      const body = { ...f, safety_margin_pct: Number(f.safety_margin_pct), default_seller_id: f.default_seller_id || null, connector_id: f.connector_id || null,
        payment_connector_id: f.payment_connector_id || null, theme: f.theme || null };
      const d = await api<Detalle>(tienda ? `/v1/web/tiendas/${tienda.id}` : "/v1/web/tiendas", { method: tienda ? "PUT" : "POST", body });
      toast.ok(tienda ? "Tienda guardada." : "Tienda creada: prueba la conexión para activarla.");
      onGuardada(d);
    } catch (err) {
      setErrores(erroresDe(err));
      setGeneral(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  const listas = (op?.listas ?? []).filter((l) => !f.brand_id || !l.brand_id || l.brand_id === f.brand_id);
  const almacenes = (op?.almacenes ?? []).filter((w) => w.establishment_id === f.establishment_id);
  return (
    <Modal open onClose={onClose} title={tienda ? `Editar ${tienda.name}` : "Nueva tienda"} size="lg" dismissable={!guardando}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-tienda" loading={guardando}>Guardar</Button></>}>
      {!op ? <Vacio>Cargando…</Vacio> : (
        <form id="f-tienda" onSubmit={guardar} className="space-y-4">
          {general && <Alert tone="bad">{general}</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre" required error={errores.name}><Input value={f.name} onChange={(e) => poner("name", e.target.value)} maxLength={80} required /></Field>
            <Field label="URL de la tienda" required error={errores.url} hint="Solo HTTPS"><Input value={f.url} onChange={(e) => poner("url", e.target.value)} maxLength={200} required inputMode="url" /></Field>
            <Field label="Tema" error={errores.theme}><Input value={f.theme} onChange={(e) => poner("theme", e.target.value)} placeholder="WoodMart" maxLength={80} /></Field>
            <Field label="Marca" required error={errores.brand_id}>
              <Select value={f.brand_id} placeholder="Elige la marca" onChange={(e) => setF((x) => ({ ...x, brand_id: e.target.value, price_list_id: "", brands: x.brands.filter((b) => b !== e.target.value) }))}
                options={op.marcas.map((m) => ({ value: m.id, label: m.name }))} required />
            </Field>
            <Field label="Lista de precios (canal web)" required error={errores.price_list_id}>
              <Select value={f.price_list_id} placeholder="Elige la lista" onChange={(e) => poner("price_list_id", e.target.value)}
                options={listas.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))} required />
            </Field>
            <Field label="Vendedora por defecto" error={errores.default_seller_id} hint="Atiende los pedidos web y completa el pin">
              <Select value={f.default_seller_id} placeholder="Sin vendedora" onChange={(e) => poner("default_seller_id", e.target.value)}
                options={op.vendedoras.map((v) => ({ value: v.id, label: v.name }))} />
            </Field>
            <Field label="Local" required error={errores.establishment_id}>
              <Select value={f.establishment_id} placeholder="Elige el local" onChange={(e) => setF((x) => ({ ...x, establishment_id: e.target.value, warehouse_ids: [] }))}
                options={op.locales.map((l) => ({ value: l.id, label: l.name }))} required />
            </Field>
            <Field label="Margen de seguridad" required error={errores.safety_margin_pct} hint="De 0 % a 50 %">
              <Input type="number" min={0} max={50} step="0.5" suffix="%" value={f.safety_margin_pct} onChange={(e) => poner("safety_margin_pct", e.target.value)} required />
            </Field>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-[12.5px] font-medium text-muted">Almacenes de stock (de venta, del local)</legend>
            {!f.establishment_id ? <Vacio>Elige primero el local.</Vacio> : !almacenes.length ? <Vacio>Ese local no tiene almacenes de venta.</Vacio> : (
              <div className="grid gap-2 sm:grid-cols-2">
                {almacenes.map((w) => <Checkbox key={w.id} label={w.name} checked={f.warehouse_ids.includes(w.id)} onChange={(v) => alternar("warehouse_ids", w.id, v)} />)}
              </div>
            )}
            {errores.warehouse_ids && <small className="text-[12px] text-bad">{errores.warehouse_ids}</small>}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-[12.5px] font-medium text-muted">Otras marcas que se venden en esta tienda</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {op.marcas.filter((m) => m.id !== f.brand_id).map((m) => <Checkbox key={m.id} label={m.name} checked={f.brands.includes(m.id)} onChange={(v) => alternar("brands", m.id, v)} />)}
            </div>
            <p className="text-[12px] text-muted">Un carrito con productos de varias marcas crea un pedido por marca con el mismo pago (D-WEB-01).</p>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-[12.5px] font-medium text-muted">Qué se sincroniza</legend>
            <div className="grid grid-cols-2 gap-2">
              {SINCRONIZA.map(([k, t]) => <Checkbox key={k} label={t} checked={Boolean(f[k as keyof Form])} onChange={(v) => poner(k as keyof Form, v as never)} />)}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Conector de WooCommerce" error={errores.connector_id}>
              <Select value={f.connector_id} placeholder="Sin conector" onChange={(e) => poner("connector_id", e.target.value)}
                options={op.conectores.filter((c) => c.kind === "COMMERCE").map((c) => ({ value: c.id, label: `${c.name}${c.environment === "SANDBOX" ? " (prueba)" : ""}` }))} />
            </Field>
            <Field label="Conector de Mercado Pago" error={errores.payment_connector_id}>
              <Select value={f.payment_connector_id} placeholder="Sin conector" onChange={(e) => poner("payment_connector_id", e.target.value)}
                options={op.conectores.filter((c) => c.kind === "PAYMENTS").map((c) => ({ value: c.id, label: `${c.name}${c.environment === "SANDBOX" ? " (prueba)" : ""}` }))} />
            </Field>
          </div>
          <p className="text-[12px] text-muted">
            <RefreshCw size={12} className="mr-1 inline" aria-hidden="true" />
            Si cambias el conector o la URL, hay que volver a probar la conexión.
          </p>
        </form>
      )}
    </Modal>
  );
}
