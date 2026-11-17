"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Map as IconoMapa, MapPinOff, Pencil, Plus, Save, Truck, Undo2, X } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, Field, Input, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { MapaZonas } from "@/modulos/cli/MapaZonas";
import type { Local, Zona } from "@/modulos/cli/tipos";

type Datos = { zonas: Zona[]; locales: Local[]; resumen: { activas: number; tarifa_promedio_lima: number; fuera_de_cobertura: number } };
type Edicion = { id: string | null; v: Record<string, string | boolean>; polygon: [number, number][] | null };

const vacia = (z?: Zona): Edicion["v"] => ({
  code: z?.code ?? "", name: z?.name ?? "", establishment_id: z?.establishment_id ?? "", priority: String(z?.priority ?? 100),
  delivery_fee: z ? String(z.delivery_fee) : "10", min_order_amount: z ? String(z.min_order_amount) : "30",
  free_from_units: z?.free_from_units != null ? String(z.free_from_units) : "", free_from_kg: z?.free_from_kg != null ? String(z.free_from_kg) : "",
  free_from_amount: z?.free_from_amount != null ? String(z.free_from_amount) : "", districts: (z?.districts ?? []).join(", "),
  province: z?.province ?? false, status: z?.status ?? "ACTIVE",
});

/**
 * CLI-08 Zonas de reparto: cada zona por polígono o por distritos, con el local que la atiende,
 * tarifa, pedido mínimo, delivery gratis desde (unidades, kg o monto) y prioridad. Si un pin cae en
 * dos zonas gana la de menor prioridad; el polígono se revisa antes que el distrito.
 */
export default function ZonasDeReparto() {
  const { can } = useSesion();
  const puede = can("cli.zone.manage");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [version, setVersion] = useState(0);
  const [elegida, setElegida] = useState<string | null>(null);
  const [ed, setEd] = useState<Edicion | null>(null);
  const [dibujando, setDibujando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vigente = true;
    api<Datos>("/v1/cli/zonas").then((d) => vigente && setDatos(d)).catch((e) => toast.error(mensajeDe(e)));
    return () => { vigente = false; };
  }, [version]);

  const zonas = datos?.zonas ?? [];
  function editar(z?: Zona) {
    setEd({ id: z?.id ?? null, v: vacia(z), polygon: z?.polygon ?? null });
    setElegida(z?.id ?? null);
    setDibujando(false); setErrores({}); setError("");
  }
  const set = (k: string) => (x: string | boolean) => setEd((e) => e && { ...e, v: { ...e.v, [k]: x } });

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!ed) return;
    setGuardando(true); setErrores({}); setError("");
    const v = ed.v;
    const n = (x: string | boolean) => (x === "" ? null : Number(x));
    const body = {
      code: v.code, name: v.name, establishment_id: v.establishment_id, priority: n(v.priority), delivery_fee: n(v.delivery_fee), min_order_amount: n(v.min_order_amount),
      free_from_units: n(v.free_from_units), free_from_kg: n(v.free_from_kg), free_from_amount: n(v.free_from_amount),
      districts: String(v.districts).split(/[,\n]/).map((d) => d.trim()).filter(Boolean), province: v.province, status: v.status,
      polygon: ed.polygon && ed.polygon.length >= 3 ? ed.polygon : null,
    };
    try {
      await api(ed.id ? `/v1/cli/zonas/${ed.id}` : "/v1/cli/zonas", { method: ed.id ? "PUT" : "POST", body });
      toast.ok(ed.id ? "Zona actualizada" : "Zona creada");
      setEd(null); setDibujando(false);
      setVersion((x) => x + 1);
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  const gratis = (z: Zona) => [z.free_from_units && `${z.free_from_units} u`, z.free_from_kg && `${numero(z.free_from_kg)} kg`, z.free_from_amount && soles(z.free_from_amount)].filter(Boolean).join(" o ") || "—";
  const columnas: Column<Zona>[] = [
    { key: "name", header: "Zona", cardTitle: true, render: (z) => <div><div className="font-medium">{z.name}</div><div className="font-mono text-[12px] text-muted">{z.code}</div></div> },
    { key: "cubre", header: "Cubre", render: (z) => z.polygon?.length ? <Badge tone="info">Polígono</Badge> : z.province ? <Badge>Provincia</Badge> : <span className="text-[12.5px]">{(z.districts ?? []).join(", ") || "—"}</span> },
    { key: "local", header: "Local", hideOnMobile: true, render: (z) => z.local ?? "—" },
    { key: "delivery_fee", header: "Tarifa", align: "right", render: (z) => soles(z.delivery_fee) },
    { key: "min", header: "Mínimo", align: "right", hideOnMobile: true, render: (z) => soles(z.min_order_amount) },
    { key: "gratis", header: "Gratis desde", hideOnMobile: true, render: gratis },
    { key: "priority", header: "Prioridad", align: "right", hideOnMobile: true, render: (z) => z.priority ?? 100 },
    { key: "pedidos_mes", header: "Pedidos del mes", align: "right", hideOnMobile: true, render: (z) => numero(z.pedidos_mes) },
    { key: "direcciones", header: "Direcciones", align: "right", hideOnMobile: true, render: (z) => numero(z.direcciones) },
    { key: "status", header: "Estado", render: (z) => <StatusBadge status={z.status} /> },
    ...(puede ? [{ key: "editar", header: "", align: "right" as const, render: (z: Zona) => <Button size="sm" variant="ghost" icon={Pencil} onClick={(x) => { x.stopPropagation(); editar(z); }}>Editar</Button> }] : []),
  ];

  const enMapa = zonas.map((z) => ({ id: z.id, label: z.name, polygon: z.polygon, centro: z.lat != null && z.lng != null ? { lat: z.lat, lng: z.lng } : null, activa: z.status === "ACTIVE" }));

  return (
    <div className="space-y-5">
      <PageHeader description="Dónde se reparte, desde qué local y cuánto cuesta. Un pin se busca primero en los polígonos (gana la menor prioridad) y después por distrito."
        actions={puede && <Button variant="primary" icon={Plus} onClick={() => editar()}>Nueva zona</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Cifra titulo="Zonas activas" icono={IconoMapa} destacada valor={datos ? numero(datos.resumen.activas) : undefined} detalle={datos ? `${zonas.length} en total` : ""} />
        <Cifra titulo="Tarifa promedio en Lima" icono={Truck} valor={datos ? soles(datos.resumen.tarifa_promedio_lima) : undefined} detalle="Zonas activas, sin provincia" />
        <div className="col-span-2 lg:col-span-1 [&>div]:h-full">
          <Cifra titulo="Direcciones fuera de cobertura" icono={MapPinOff} valor={datos ? numero(datos.resumen.fuera_de_cobertura) : undefined}
            tono={datos?.resumen.fuera_de_cobertura ? "warn" : "ok"} detalle="Sin zona: revisa si falta una" />
        </div>
      </div>

      <div className={`grid gap-4 ${ed ? "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" : ""}`}>
        <section className="space-y-2">
          <MapaZonas zonas={enMapa} seleccion={elegida} onSelect={(id) => { setElegida(id); if (ed && !dibujando) editar(zonas.find((z) => z.id === id)); }}
            dibujo={ed && dibujando ? (ed.polygon ?? []) : null} onPunto={(p) => setEd((e) => e && { ...e, polygon: [...(e.polygon ?? []), p] })} />
          {dibujando
            ? <p className="text-[12.5px] text-muted">Haz clic en el mapa para agregar cada esquina de la zona ({ed?.polygon?.length ?? 0} puntos; mínimo 3).</p>
            : <p className="text-[12.5px] text-muted">Las zonas por polígono se dibujan con su borde; las que van por distrito, con un círculo en su centro. Haz clic en una para verla.</p>}
        </section>

        {ed && (
          <form onSubmit={guardar} noValidate className="grid content-start gap-4 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-2">
            <div className="flex items-center justify-between sm:col-span-2">
              <h2 className="text-[14px] font-semibold">{ed.id ? `Editar ${ed.v.name}` : "Nueva zona"}</h2>
              <Button size="sm" variant="ghost" icon={X} onClick={() => { setEd(null); setDibujando(false); }}>Cerrar</Button>
            </div>
            {error && <div className="sm:col-span-2"><Alert tone="bad">{error}</Alert></div>}
            <Field label="Código" required error={errores.code}><Input value={String(ed.v.code)} onChange={(e) => set("code")(e.target.value.toUpperCase())} placeholder="SURCO-A" /></Field>
            <Field label="Nombre" required error={errores.name}><Input value={String(ed.v.name)} onChange={(e) => set("name")(e.target.value)} /></Field>
            <Field label="Local que la atiende" required error={errores.establishment_id} className="sm:col-span-2">
              <Select value={String(ed.v.establishment_id)} onChange={(e) => set("establishment_id")(e.target.value)} placeholder="Elige el local"
                options={(datos?.locales ?? []).map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))} />
            </Field>
            <Field label="Tarifa de delivery (S/)" required error={errores.delivery_fee}><Input inputMode="decimal" value={String(ed.v.delivery_fee)} onChange={(e) => set("delivery_fee")(e.target.value)} /></Field>
            <Field label="Pedido mínimo (S/)" error={errores.min_order_amount}><Input inputMode="decimal" value={String(ed.v.min_order_amount)} onChange={(e) => set("min_order_amount")(e.target.value)} /></Field>
            <Field label="Gratis desde (unidades)" error={errores.free_from_units}><Input inputMode="numeric" value={String(ed.v.free_from_units)} onChange={(e) => set("free_from_units")(e.target.value)} placeholder="3" /></Field>
            <Field label="Gratis desde (kg)" error={errores.free_from_kg}><Input inputMode="decimal" value={String(ed.v.free_from_kg)} onChange={(e) => set("free_from_kg")(e.target.value)} placeholder="3" /></Field>
            <Field label="Gratis desde (S/)" error={errores.free_from_amount}><Input inputMode="decimal" value={String(ed.v.free_from_amount)} onChange={(e) => set("free_from_amount")(e.target.value)} placeholder="Opcional" /></Field>
            <Field label="Prioridad" hint="Menor gana si dos zonas se cruzan" required error={errores.priority}><Input inputMode="numeric" value={String(ed.v.priority)} onChange={(e) => set("priority")(e.target.value)} /></Field>
            <Field label="Distritos" hint="Separados por coma. Se usan si el pin no cae en ningún polígono." error={errores.districts} className="sm:col-span-2">
              <Textarea rows={2} value={String(ed.v.districts)} onChange={(e) => set("districts")(e.target.value)} placeholder="Santiago de Surco, Barranco" />
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <p className="text-[12.5px] font-medium text-muted">Polígono {ed.polygon?.length ? `(${ed.polygon.length} puntos)` : "(sin polígono: va por distrito)"}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={dibujando ? "primary" : "secondary"} icon={Pencil} onClick={() => setDibujando((x) => !x)}>{dibujando ? "Terminar de dibujar" : "Dibujar en el mapa"}</Button>
                <Button size="sm" icon={Undo2} disabled={!ed.polygon?.length} onClick={() => setEd((e) => e && { ...e, polygon: (e.polygon ?? []).slice(0, -1) })}>Quitar el último punto</Button>
                <Button size="sm" variant="ghost" disabled={!ed.polygon?.length} onClick={() => setEd((e) => e && { ...e, polygon: null })}>Borrar polígono</Button>
              </div>
              {errores.polygon && <p className="text-[12.5px] text-bad">{errores.polygon}</p>}
            </div>
            <div className="sm:col-span-2"><Checkbox checked={Boolean(ed.v.province)} onChange={set("province")} label="Es de provincia" hint="Envío por agencia: no entra al promedio de Lima." /></div>
            <Field label="Estado" required error={errores.status}><Select value={String(ed.v.status)} onChange={(e) => set("status")(e.target.value)} options={[{ value: "ACTIVE", label: "Activa" }, { value: "INACTIVE", label: "Inactiva" }]} /></Field>
            <div className="flex items-end justify-end gap-2">
              <Button type="submit" variant="primary" icon={Save} loading={guardando}>Guardar zona</Button>
            </div>
          </form>
        )}
      </div>

      <DataTable rows={zonas} columns={columnas} loading={!datos} onRowClick={(z) => (puede ? editar(z) : setElegida(z.id))} empty="Todavía no hay zonas de reparto." />
    </div>
  );
}
