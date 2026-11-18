"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, CircleSlash, FileUp, History, Plus, Tags } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, Field, Input, PageHeader, Select, Tabs, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import type { FilaCsv, ListaPrecio, PrecioLista, Variante } from "@/modulos/cat/tipos";

type Cuando = "NOW" | "FUTURE" | "PAST" | "ALL";
type Respuesta = {
  filas: PrecioLista[];
  resumen: { vigentes: number; programados: number; historicos: number; sin_precio: number; sin_precio_ejemplos: { id: string; sku: string; name: string }[] };
};
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
const manana = () => new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "America/Lima" });

/** CAT-06 Precios de la lista. ?lista= elige la lista; &cuando=FUTURE abre los programados. */
export default function PreciosDeLaLista({ searchParams }: PageProps<"/m/cat/cat-06">) {
  const params = use(searchParams);
  const router = useRouter();
  const { marca, can } = useSesion();
  const puedeEditar = can("cat.price.manage");
  const [listas, setListas] = useState<ListaPrecio[]>([]);
  const elegida = typeof params.lista === "string" ? params.lista : "";
  const [cuando, setCuando] = useState<Cuando>(() => (["NOW", "FUTURE", "PAST", "ALL"].includes(String(params.cuando)) ? params.cuando as Cuando : "NOW"));
  const [buscar, setBuscar] = useState("");
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [dialogo, setDialogo] = useState<{ tipo: "precio"; item: PrecioLista | null } | { tipo: "cerrar"; item: PrecioLista } | { tipo: "csv" } | null>(null);

  useEffect(() => {
    let vigente = true;
    api<ListaPrecio[]>(`/v1/cat/listas${marca !== "ALL" ? `?brand_id=${marca}` : ""}`).then((l) => vigente && setListas(l)).catch(() => {});
    return () => { vigente = false; };
  }, [marca, version]);

  const lista = listas.find((l) => l.id === elegida) ?? listas.find((l) => l.code === "DG-WA") ?? listas[0];
  const listaId = lista?.id ?? "";

  useEffect(() => {
    if (!listaId) return;
    let vigente = true;
    const q = new URLSearchParams({ cuando, q: buscar.trim() });
    api<Respuesta>(`/v1/cat/listas/${listaId}/precios?${q}`)
      .then((r) => { if (vigente) { setDatos(r); setError(""); } }).catch((err) => vigente && setError(mensajeDe(err)));
    return () => { vigente = false; };
  }, [listaId, cuando, buscar, version]);
  const recargar = () => setVersion((n) => n + 1);

  const r = datos?.resumen;
  const h = hoy();
  const columnas: Column<PrecioLista>[] = [
    { key: "sku", header: "SKU", render: (x) => <span className="whitespace-nowrap font-mono font-semibold">{x.sku}</span> },
    { key: "name", header: "Variante", cardTitle: true, render: (x) => <div className="min-w-[180px]">{x.name}{x.reason && <div className="text-[12px] text-muted">{x.reason}</div>}</div> },
    { key: "basis", header: "Base", hideOnMobile: true, render: (x) => <span className="whitespace-nowrap">{x.basis === "KG" ? "Por kg" : "Por unidad"}</span> },
    { key: "min_qty", header: "Cant. mín.", align: "right", hideOnMobile: true, render: (x) => x.min_qty ? <span className="tabular-nums">{numero(x.min_qty, 2)}</span> : <span className="text-muted">—</span> },
    { key: "price", header: "Precio", align: "right", render: (x) => <b className="whitespace-nowrap tabular-nums">{soles(x.price)}{x.basis === "KG" ? "/kg" : ""}</b> },
    { key: "previous_price", header: "Anterior", align: "right", hideOnMobile: true, render: (x) => x.previous_price
      ? <span className="whitespace-nowrap tabular-nums text-muted">{soles(x.previous_price)} <Variacion antes={x.previous_price} ahora={x.price} /></span> : <span className="text-muted">—</span> },
    { key: "valid_from", header: "Desde", render: (x) => <span className="whitespace-nowrap">{fecha(x.valid_from)}</span> },
    { key: "valid_to", header: "Hasta", render: (x) => x.valid_to ? <span className="whitespace-nowrap" title={x.closed_reason ?? undefined}>{fecha(x.valid_to)}</span> : <span className="text-muted">Sin fin</span> },
    { key: "created_by", header: "Cargó", hideOnMobile: true, render: (x) => <span className="text-[12.5px]">{x.created_by ?? "—"}</span> },
    ...(puedeEditar ? [{ key: "acciones", header: "", align: "right" as const, render: (x: PrecioLista) => (!x.valid_to || x.valid_to >= h) && (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" onClick={() => setDialogo({ tipo: "precio", item: x })}>Cambiar</Button>
        {!x.valid_to && <Button size="sm" variant="ghost" onClick={() => setDialogo({ tipo: "cerrar", item: x })}>Cerrar</Button>}
      </div>
    ) }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Grilla variante × precio con base (unidad o kg), cantidad mínima y vigencia propia. Un cambio cierra la vigencia anterior; la importación CSV muestra la diferencia antes de aplicar."
        actions={<>
          <div className="w-72"><Select value={listaId} onChange={(e) => router.replace(`/m/cat/cat-06?lista=${e.target.value}`)}
            options={listas.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))} /></div>
          {puedeEditar && lista && <Button icon={FileUp} onClick={() => setDialogo({ tipo: "csv" })}>Importar CSV</Button>}
          {puedeEditar && lista && <Button variant="primary" icon={Plus} onClick={() => setDialogo({ tipo: "precio", item: null })}>Agregar precio</Button>}
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Vigentes hoy" icono={Tags} destacada valor={r ? numero(r.vigentes) : undefined} detalle={lista ? lista.name : undefined} />
        <Cifra titulo="Programados" icono={CalendarClock} valor={r ? numero(r.programados) : undefined} detalle="Con vigencia futura" />
        <Cifra titulo="Históricos" icono={History} valor={r ? numero(r.historicos) : undefined} detalle="Vigencias cerradas" />
        <Cifra titulo="Variantes sin precio" icono={CircleSlash} valor={r ? numero(r.sin_precio) : undefined}
          detalle={r?.sin_precio ? r.sin_precio_ejemplos.slice(0, 2).map((v) => v.sku).join(", ") : "Todas tienen precio"} />
      </div>

      {lista && lista.status !== "ACTIVE" && (
        <Alert tone="warn">La lista está {lista.status === "DRAFT" ? "en borrador" : "inactiva"}: no se usa para vender hasta activarla en <Link href="/m/cat/cat-05" className="text-primary underline">Listas de precio</Link>.</Alert>
      )}

      <Tabs value={cuando} onChange={setCuando} tabs={[
        { key: "NOW", label: "Vigentes", count: r?.vigentes }, { key: "FUTURE", label: "Programados", count: r?.programados },
        { key: "PAST", label: "Históricos", count: r?.historicos }, { key: "ALL", label: "Todos" },
      ]} />

      <DataTable columns={columnas} rows={datos?.filas ?? []} rowKey={(x) => x.id} loading={!datos && !error} error={error} onRetry={recargar}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar SKU o variante…" }}
        empty={cuando === "NOW" ? "La lista no tiene precios vigentes hoy." : "No hay precios en esta vista."} />

      {lista && dialogo?.tipo === "precio" && (
        <PrecioForm lista={lista} item={dialogo.item} onClose={() => setDialogo(null)} onHecho={() => { setDialogo(null); recargar(); }} />
      )}
      {lista && dialogo?.tipo === "cerrar" && (
        <CerrarForm lista={lista} item={dialogo.item} onClose={() => setDialogo(null)} onHecho={() => { setDialogo(null); recargar(); }} />
      )}
      {lista && dialogo?.tipo === "csv" && (
        <ImportarCsv lista={lista} onClose={() => setDialogo(null)} onHecho={() => { setDialogo(null); setCuando("ALL"); recargar(); }} />
      )}
    </div>
  );
}

function Variacion({ antes, ahora }: { antes: number; ahora: number }) {
  const d = (ahora - antes) / antes * 100;
  if (!antes || Math.abs(d) < 0.05) return null;
  return <span className={d > 0 ? "text-bad" : "text-ok"}>{d > 0 ? "▲" : "▼"}{porcentaje(Math.abs(d), 1)}</span>;
}

/** Agregar un precio o cambiar uno vigente (cierra el anterior el día previo, RN-CAT-06). */
function PrecioForm({ lista, item, onClose, onHecho }: { lista: ListaPrecio; item: PrecioLista | null; onClose: () => void; onHecho: () => void }) {
  const [variantes, setVariantes] = useState<Variante[]>([]);
  const [filtro, setFiltro] = useState("");
  const [v, setV] = useState({
    variant_id: item?.variant_id ?? "", price: item ? String(item.price) : "", basis: item?.basis ?? "",
    min_qty: item?.min_qty ? String(item.min_qty) : "0", valid_from: manana(), valid_to: "", reason: "", cerrar_anterior: Boolean(item),
  });

  useEffect(() => {
    if (item) return;
    let vigente = true;
    const q = new URLSearchParams({ status: "ACTIVE", per_page: "100", q: filtro });
    if (lista.brand_id) q.set("brand_id", lista.brand_id);
    api<{ data: Variante[] }>(`/v1/cat/variantes?${q}`).then((r) => vigente && setVariantes(r.data.filter((x) => x.sellable))).catch(() => {});
    return () => { vigente = false; };
  }, [item, lista.brand_id, filtro]);

  const elegida = variantes.find((x) => x.id === v.variant_id);
  const base = v.basis || (item ? item.basis : elegida ? (elegida.sale_mode === "UNIT" ? "UNIT" : "KG") : "");
  const opciones = useMemo(() => variantes.map((x) => ({ value: x.id, label: `${x.sku} · ${x.name}` })), [variantes]);

  return (
    <Dialogo titulo={item ? `Cambiar precio · ${item.name}` : `Agregar precio · ${lista.name}`} boton={item ? "Cambiar precio" : "Agregar precio"} onClose={onClose}
      aviso={item ? `Precio actual ${soles(item.price)} desde el ${fecha(item.valid_from)}. El nuevo cierra esa vigencia el día anterior (RN-CAT-06).` : undefined}
      enviar={async () => {
        await api(`/v1/cat/listas/${lista.id}/precios`, { method: "POST", body: {
          ...v, price: Number(v.price), min_qty: Number(v.min_qty) || 0, basis: base || null, valid_to: v.valid_to || null, reason: v.reason || null,
        } });
        toast.ok(item ? "Precio cambiado" : "Precio agregado");
        onHecho();
      }}>
      {(errores) => <>
        {!item && <>
          <Field label="Buscar variante" className="sm:col-span-2"><Input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="SKU o nombre…" /></Field>
          <Field label="Variante" required error={errores.variant_id} className="sm:col-span-2">
            <Select value={v.variant_id} onChange={(e) => setV({ ...v, variant_id: e.target.value, basis: "" })} placeholder="Elige la variante" options={opciones} />
          </Field>
        </>}
        <Field label={`Precio (S/${base === "KG" ? " por kg" : base === "UNIT" ? " por unidad" : ""})`} required error={errores.price}>
          <Input type="number" step="0.01" min={0} value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} />
        </Field>
        <Field label="Base" error={errores.basis}>
          <Select value={base} onChange={(e) => setV({ ...v, basis: e.target.value as "KG" | "UNIT" })} options={[{ value: "KG", label: "Por kg" }, { value: "UNIT", label: "Por unidad" }]} />
        </Field>
        <Field label="Cantidad mínima" error={errores.min_qty} hint="Tramo por volumen. 0 = desde la primera unidad.">
          <Input type="number" step="0.001" min={0} value={v.min_qty} onChange={(e) => setV({ ...v, min_qty: e.target.value })} disabled={Boolean(item)} />
        </Field>
        <Field label="Vigente desde" required error={errores.valid_from}>
          <Input type="date" value={v.valid_from} onChange={(e) => setV({ ...v, valid_from: e.target.value })} />
        </Field>
        <Field label="Vigente hasta" error={errores.valid_to} hint="Vacío: sin fecha de fin.">
          <Input type="date" value={v.valid_to} onChange={(e) => setV({ ...v, valid_to: e.target.value })} />
        </Field>
        <Field label="Motivo" error={errores.reason}>
          <Input value={v.reason} maxLength={80} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="Ej.: Alza del proveedor" />
        </Field>
        {!item && <div className="sm:col-span-2"><Checkbox checked={v.cerrar_anterior} onChange={(si) => setV({ ...v, cerrar_anterior: si })}
          label="Si ya tiene un precio vigente, cerrarlo el día anterior" hint="Sin marcar, un precio que se superpone se rechaza (RN-CAT-06)." /></div>}
      </>}
    </Dialogo>
  );
}

/** Cierra la vigencia de un precio en una fecha. */
function CerrarForm({ lista, item, onClose, onHecho }: { lista: ListaPrecio; item: PrecioLista; onClose: () => void; onHecho: () => void }) {
  const [v, setV] = useState({ valid_to: hoy(), reason: "" });
  return (
    <Dialogo titulo={`Cerrar precio · ${item.name}`} boton="Cerrar vigencia" onClose={onClose}
      aviso={`${soles(item.price)} vigente desde el ${fecha(item.valid_from)}. Después de la fecha de cierre la variante queda sin precio en esta lista.`}
      enviar={async () => {
        await api(`/v1/cat/listas/${lista.id}/precios/${item.id}/cerrar`, { method: "PUT", body: { valid_to: v.valid_to, reason: v.reason || null } });
        toast.ok("Vigencia cerrada");
        onHecho();
      }}>
      {(errores) => <>
        <Field label="Último día vigente" required error={errores.valid_to}><Input type="date" value={v.valid_to} onChange={(e) => setV({ ...v, valid_to: e.target.value })} /></Field>
        <Field label="Motivo" error={errores.reason}><Input value={v.reason} maxLength={80} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      </>}
    </Dialogo>
  );
}

/** Importación CSV «sku;precio;desde;cant_min» con vista previa frente al precio actual. */
function ImportarCsv({ lista, onClose, onHecho }: { lista: ListaPrecio; onClose: () => void; onHecho: () => void }) {
  const [texto, setTexto] = useState("sku;precio;desde;cant_min\n");
  const [motivo, setMotivo] = useState("");
  const [vista, setVista] = useState<FilaCsv[] | null>(null);
  const [revisando, setRevisando] = useState(false);
  const validas = vista?.filter((f) => !f.error).length ?? 0;

  async function revisar() {
    setRevisando(true);
    try {
      setVista(await api<FilaCsv[]>(`/v1/cat/listas/${lista.id}/csv/vista`, { method: "POST", body: { texto } }));
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setRevisando(false);
    }
  }

  async function leerArchivo(f: File | undefined) {
    if (!f) return;
    setTexto(await f.text());
    setVista(null);
  }

  return (
    <Dialogo titulo={`Importar precios · ${lista.name}`} boton={vista ? `Aplicar ${validas} precios` : "Revisar"} onClose={onClose}
      aviso="Una fila por precio: sku;precio;desde;cant_min. La fecha va como AAAA-MM-DD (vacía = mañana). Cada precio cierra la vigencia anterior; las filas con error no se aplican."
      enviar={async () => {
        if (!vista) { await revisar(); return; }
        if (!validas) { toast.error("No hay filas válidas para aplicar."); return; }
        const r = await api<{ aplicadas: number; con_error: number }>(`/v1/cat/listas/${lista.id}/csv`, { method: "POST", body: { texto, reason: motivo || null } });
        toast.ok(`${r.aplicadas} precios cargados${r.con_error ? `, ${r.con_error} con error` : ""}`);
        onHecho();
      }}>
      {() => <>
        <Field label="Archivo CSV" className="sm:col-span-2">
          <input type="file" accept=".csv,.txt,text/csv" onChange={(e) => leerArchivo(e.target.files?.[0])}
            className="block w-full text-[13px] file:mr-3 file:rounded-[8px] file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-[13px]" />
        </Field>
        <Field label="O pega las filas" className="sm:col-span-2">
          <Textarea rows={6} value={texto} onChange={(e) => { setTexto(e.target.value); setVista(null); }} className="font-mono text-[12.5px]" />
        </Field>
        <Field label="Motivo" className="sm:col-span-2"><Input value={motivo} maxLength={80} onChange={(e) => setMotivo(e.target.value)} placeholder="Importación CSV" /></Field>
        {revisando && <p className="text-muted sm:col-span-2">Revisando…</p>}
        {vista && (
          <div className="overflow-x-auto rounded-[10px] border border-line sm:col-span-2">
            <table className="w-full text-[12.5px]">
              <thead className="bg-surface-2 text-left text-muted"><tr>
                <th className="px-2.5 py-2">Fila</th><th className="px-2.5 py-2">SKU</th><th className="px-2.5 py-2 text-right">Actual</th>
                <th className="px-2.5 py-2 text-right">Nuevo</th><th className="px-2.5 py-2">Desde</th><th className="px-2.5 py-2">Resultado</th>
              </tr></thead>
              <tbody>{vista.map((f) => (
                <tr key={f.linea} className="border-t border-line">
                  <td className="px-2.5 py-1.5 tabular-nums">{f.linea}</td>
                  <td className="px-2.5 py-1.5"><span className="font-mono">{f.sku}</span>{f.name && <div className="text-muted">{f.name}</div>}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{f.current !== null ? soles(f.current) : "—"}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{soles(f.price)}{f.diff_pct !== null && <div className={f.diff_pct > 0 ? "text-bad" : "text-ok"}>{f.diff_pct > 0 ? "+" : ""}{numero(f.diff_pct, 1)} %</div>}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{fecha(f.valid_from)}</td>
                  <td className="px-2.5 py-1.5">{f.error ? <Badge tone="bad">{f.error}</Badge> : <Badge tone="ok">Se aplica</Badge>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </>}
    </Dialogo>
  );
}
