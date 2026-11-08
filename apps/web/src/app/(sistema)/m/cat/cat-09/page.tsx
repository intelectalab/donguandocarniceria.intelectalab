"use client";

import { useEffect, useMemo, useState } from "react";
import { CloudUpload, Globe, PackageX, ShieldAlert } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, Field, Input, PageHeader, Select, Textarea, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { SINCRONIZACION, type ProductoWeb } from "@/modulos/cat/tipos";

type Respuesta = { filas: ProductoWeb[]; resumen: { publicados: number; de_venta: number; pendientes: number; variantes_web: number; sin_stock: number; sin_stock_pct: number; bloqueados: number } };
const TONO_SYNC: Record<string, Tone> = { PENDING: "warn", SYNCED: "ok", NOT_PUBLISHED: "neutral", REMOVED: "neutral" };

/** CAT-09 Publicación web: qué va a la tienda de cada marca, con título, descripción, imagen y sincronización. */
export default function PublicacionWeb() {
  const { me, marca, can } = useSesion();
  const puedeEditar = can("cat.product.publish_web");
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [buscar, setBuscar] = useState("");
  const [marcaFiltro, setMarcaFiltro] = useState("");
  const [web, setWeb] = useState("");
  const [sync, setSync] = useState("");
  const [abierto, setAbierto] = useState<ProductoWeb | null>(null);
  const brand = marca !== "ALL" ? marca : marcaFiltro;

  useEffect(() => {
    let vigente = true;
    api<Respuesta>(`/v1/cat/web${brand ? `?brand_id=${brand}` : ""}`)
      .then((d) => { if (vigente) { setDatos(d); setError(""); } }).catch((err) => vigente && setError(mensajeDe(err)));
    return () => { vigente = false; };
  }, [brand, version]);
  const recargar = () => setVersion((n) => n + 1);

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (datos?.filas ?? []).filter((p) => (!web || String(p.web_publishable) === web) && (!sync || p.web_sync_status === sync)
      && (!q || p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || (p.web_title ?? "").toLowerCase().includes(q)));
  }, [datos, buscar, web, sync]);

  async function accion(p: ProductoWeb, tipo: "publicar" | "enviar") {
    try {
      if (tipo === "publicar") {
        await api(`/v1/cat/web/${p.id}/publicar`, { method: "PUT", body: { web_publishable: !p.web_publishable } });
        toast.ok(p.web_publishable ? "Retirado de la web: pendiente de envío" : "Marcado para la web: pendiente de envío");
      } else {
        await api(`/v1/cat/web/${p.id}/enviar`, { method: "POST" });
        toast.ok("Enviado a la web");
      }
      recargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    }
  }

  const r = datos?.resumen;
  const columnas: Column<ProductoWeb>[] = [
    { key: "name", header: "Producto", cardTitle: true, render: (p) => (
      <div className="min-w-[200px]"><div>{p.web_title || p.name}</div><div className="text-[12px] text-muted">{p.code} · {p.image_url || "Sin imagen"}</div></div>
    ) },
    ...(brand ? [] : [{ key: "brand", header: "Tienda", render: (p: ProductoWeb) => p.brand_name ? <Badge tone="primary">{p.brand_name}</Badge> : "—" }]),
    { key: "variantes_web", header: "Variantes web", align: "right", hideOnMobile: true, render: (p) => <span className="tabular-nums">{p.variantes_web} de {p.variantes.length}</span> },
    { key: "stock", header: "Stock publicable", align: "right", hideOnMobile: true, render: (p) => p.stock_publicable > 0
      ? <span className="tabular-nums">{numero(p.stock_publicable, 1)}</span> : <Badge tone={p.web_publishable ? "bad" : "neutral"}>0</Badge> },
    { key: "sanitario", header: "Registro", render: (p) => p.sanitario.code === "NA" ? <span className="text-muted">No requiere</span> : <Badge tone={p.sanitario.tone as Tone}>{p.sanitario.label}</Badge> },
    { key: "web", header: "Publicado", render: (p) => p.web_publishable ? <Badge tone="ok">Sí</Badge> : <span className="text-muted">No</span> },
    { key: "sync", header: "Sincronización", render: (p) => (
      <div className="whitespace-nowrap"><Badge tone={TONO_SYNC[p.web_sync_status ?? "NOT_PUBLISHED"] ?? "neutral"}>{SINCRONIZACION[p.web_sync_status ?? "NOT_PUBLISHED"] ?? p.web_sync_status}</Badge>
        {p.web_synced_at && <div className="text-[11.5px] text-muted">{fechaHora(p.web_synced_at)}</div>}</div>
    ) },
    ...(puedeEditar ? [{ key: "acciones", header: "", align: "right" as const, render: (p: ProductoWeb) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" onClick={() => accion(p, "publicar")}>{p.web_publishable ? "Retirar" : "Publicar"}</Button>
        {p.web_sync_status === "PENDING" && <Button size="sm" variant="primary" onClick={() => accion(p, "enviar")}>Enviar</Button>}
      </div>
    ) }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Productos y variantes marcados para la tienda de cada marca, con título, descripción, imagen y estado de sincronización (lo envía WEB a WooCommerce)." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Productos publicados" icono={Globe} destacada valor={r ? numero(r.publicados) : undefined} detalle={r ? `De ${numero(r.de_venta)} de venta` : undefined} />
        <Cifra titulo="Pendientes de envío" icono={CloudUpload} valor={r ? numero(r.pendientes) : undefined} detalle="Cambios por enviar a la tienda" />
        <Cifra titulo="Publicados sin stock" icono={PackageX} valor={r ? porcentaje(r.sin_stock_pct, 1) : undefined} detalle={r ? `${r.sin_stock} de ${r.variantes_web} variantes · KPI-CAT-02` : undefined} />
        <Cifra titulo="Bloqueados por registro vencido" icono={ShieldAlert} valor={r ? numero(r.bloqueados) : undefined} detalle="RN-CAT-09" />
      </div>

      <Alert tone="info">El envío a WooCommerce lo hace WEB. Mientras tanto, «Enviar» marca el cambio como enviado con la fecha y hora.</Alert>

      <DataTable columns={columnas} rows={visibles} rowKey={(p) => p.id} loading={!datos && !error} error={error} onRetry={recargar}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar producto o título web…" }}
        onRowClick={(p) => setAbierto(p)} empty="No hay productos con esos filtros."
        toolbar={<>
          {marca === "ALL" && me.brands.length > 1 && (
            <div className="w-44"><Select value={marcaFiltro} onChange={(e) => setMarcaFiltro(e.target.value)} placeholder="Tienda: todas" options={me.brands.map((b) => ({ value: b.id, label: b.name }))} /></div>
          )}
          <div className="w-40"><Select value={web} onChange={(e) => setWeb(e.target.value)} placeholder="Web: todos" options={[{ value: "true", label: "Publicados" }, { value: "false", label: "No publicados" }]} /></div>
          <div className="w-44"><Select value={sync} onChange={(e) => setSync(e.target.value)} placeholder="Sincronización: todas" options={Object.entries(SINCRONIZACION).map(([value, label]) => ({ value, label }))} /></div>
        </>} />

      {abierto && <DatosWeb producto={abierto} puedeEditar={puedeEditar} onClose={() => setAbierto(null)} onHecho={() => { setAbierto(null); recargar(); }} />}
    </div>
  );
}

function DatosWeb({ producto: p, puedeEditar, onClose, onHecho }: { producto: ProductoWeb; puedeEditar: boolean; onClose: () => void; onHecho: () => void }) {
  const [v, setV] = useState({ web_title: p.web_title ?? "", web_description: p.web_description ?? "", image_url: p.image_url ?? "" });
  const [vars, setVars] = useState<Record<string, boolean>>(() => Object.fromEntries(p.variantes.map((x) => [x.id, x.web_publishable])));
  const vencido = p.sanitario.code === "EXPIRED";
  return (
    <Dialogo titulo={`Publicación web · ${p.name}`} boton={puedeEditar ? "Guardar" : "Cerrar"} onClose={onClose}
      aviso={p.web_publishable ? "Al guardar queda pendiente de envío a la tienda." : "El producto no está publicado: estos datos se usan cuando lo publiques."}
      enviar={async () => {
        if (!puedeEditar) { onClose(); return; }
        await api(`/v1/cat/web/${p.id}`, { method: "PUT", body: { ...v, web_title: v.web_title || null, web_description: v.web_description || null, image_url: v.image_url || null, variantes: vars } });
        toast.ok("Datos web guardados");
        onHecho();
      }}>
      {(errores) => <>
        {vencido && <div className="sm:col-span-2"><Alert tone="bad">RN-CAT-09: el registro sanitario está vencido. No se puede publicar hasta renovarlo.</Alert></div>}
        <Field label="Título en la tienda" error={errores.web_title} className="sm:col-span-2" hint={`Vacío: se usa «${p.name}».`}>
          <Input value={v.web_title} maxLength={255} disabled={!puedeEditar} onChange={(e) => setV({ ...v, web_title: e.target.value })} />
        </Field>
        <Field label="Descripción" error={errores.web_description} className="sm:col-span-2">
          <Textarea rows={4} value={v.web_description} maxLength={5000} disabled={!puedeEditar} onChange={(e) => setV({ ...v, web_description: e.target.value })} />
        </Field>
        <Field label="Imagen" error={errores.image_url} className="sm:col-span-2" hint="Ruta del archivo en INT/archivos.">
          <Input value={v.image_url} maxLength={500} disabled={!puedeEditar} onChange={(e) => setV({ ...v, image_url: e.target.value })} placeholder="cat/cuy-entero.jpg" />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-[13px] font-medium">Variantes que se publican</legend>
          <div className="grid gap-2">
            {p.variantes.map((x) => (
              <Checkbox key={x.id} checked={Boolean(vars[x.id])} disabled={!puedeEditar || (vencido && !vars[x.id])}
                onChange={(si) => setVars({ ...vars, [x.id]: si })} label={<><span className="font-mono text-[12px]">{x.sku}</span> · {x.name}</>}
                hint={`Stock publicable: ${numero(x.stock, 1)}`} />
            ))}
            {!p.variantes.length && <p className="text-[13px] text-muted">No tiene variantes activas.</p>}
          </div>
        </fieldset>
      </>}
    </Dialogo>
  );
}
