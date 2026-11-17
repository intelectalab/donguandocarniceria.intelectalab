"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Alert, Badge, Button, DetailList, Field, Input, PageHeader, Select, Tabs, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { kg, numero, soles } from "@/lib/formato";
import { MapaZonas } from "@/modulos/cli/MapaZonas";
import type { Tarifa, Zona } from "@/modulos/cli/tipos";

type Variante = { id: string; sku: string; name: string; sale_mode: string; nominal_weight_kg: number | null; brand_name: string | null };
type Modo = "pin" | "distrito" | "zona";
const CANALES = [{ value: "WEB", label: "Web" }, { value: "WHATSAPP", label: "WhatsApp" }, { value: "POS", label: "Mostrador" }, { value: "B2B", label: "B2B" }];

/** CLI-09 Simulador de zona y tarifa: dónde cae un pin o distrito, qué local lo atiende, cuánto cuesta el delivery y si el carrito llega al gratis. */
export default function Simulador() {
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [distritos, setDistritos] = useState<string[]>([]);
  const [variantes, setVariantes] = useState<Variante[]>([]);
  const [modo, setModo] = useState<Modo>("pin");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>({ lat: -12.135, lng: -76.99 });
  const [distrito, setDistrito] = useState("");
  const [zonaId, setZonaId] = useState("");
  const [canal, setCanal] = useState("WEB");
  const [lineas, setLineas] = useState<{ variant_id: string; qty: string }[]>([]);
  const [agregar, setAgregar] = useState("");
  const [res, setRes] = useState<{ clave: string; t: Tarifa } | null>(null);

  useEffect(() => {
    let vigente = true;
    Promise.all([api<{ zonas: Zona[] }>("/v1/cli/zonas"), api<string[]>("/v1/cli/distritos"), api<Variante[]>("/v1/cli/simulador/variantes")])
      .then(([z, d, v]) => { if (vigente) { setZonas(z.zonas); setDistritos(d); setVariantes(v); } })
      .catch((e) => toast.error(mensajeDe(e)));
    return () => { vigente = false; };
  }, []);

  const body = {
    ...(modo === "pin" && pin ? pin : {}), ...(modo === "distrito" && distrito ? { distrito } : {}), ...(modo === "zona" && zonaId ? { zone_id: zonaId } : {}),
    canal, lineas: lineas.filter((l) => Number(l.qty) > 0).map((l) => ({ variant_id: l.variant_id, qty: Number(l.qty) })),
  };
  const clave = JSON.stringify(body);
  const hayDonde = (modo === "pin" && pin) || (modo === "distrito" && distrito) || (modo === "zona" && zonaId);

  useEffect(() => {
    if (!hayDonde) return;
    let vigente = true;
    const t = setTimeout(() => {
      api<Tarifa>("/v1/cli/simulador", { method: "POST", body: JSON.parse(clave) }).then((r) => vigente && setRes({ clave, t: r })).catch((e) => vigente && toast.error(mensajeDe(e)));
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [clave, hayDonde]);

  const t = hayDonde && res?.clave === clave ? res.t : null;
  const vNombre = (id: string) => variantes.find((v) => v.id === id);

  return (
    <div className="space-y-5">
      <PageHeader description="Prueba una dirección y un carrito: muestra la zona, el local que despacha, la tarifa y si llega al delivery gratis. No guarda nada." />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="space-y-3">
          <Tabs value={modo} onChange={setModo} tabs={[{ key: "pin", label: "Pin en el mapa" }, { key: "distrito", label: "Distrito" }, { key: "zona", label: "Zona" }]} />
          {modo === "pin" && <>
            <MapaZonas height={400} pin={pin} onPin={setPin} seleccion={t?.zona?.id ?? null}
              zonas={zonas.map((z) => ({ id: z.id, label: z.name, polygon: z.polygon, centro: z.lat != null && z.lng != null ? { lat: z.lat, lng: z.lng } : null, activa: z.status === "ACTIVE" }))} />
            <p className="text-[12.5px] text-muted">{pin ? <>Pin <span className="font-mono">{numero(pin.lat, 5)}, {numero(pin.lng, 5)}</span></> : "Haz clic en el mapa para poner un pin."}</p>
          </>}
          {modo === "distrito" && (
            <Field label="Distrito"><Select value={distrito} onChange={(e) => setDistrito(e.target.value)} placeholder="Elige un distrito" options={distritos.map((d) => ({ value: d, label: d }))} /></Field>
          )}
          {modo === "zona" && (
            <Field label="Zona"><Select value={zonaId} onChange={(e) => setZonaId(e.target.value)} placeholder="Elige una zona" options={zonas.map((z) => ({ value: z.id, label: `${z.name} · ${soles(z.delivery_fee)}` }))} /></Field>
          )}

          <div className="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <div className="flex flex-wrap items-end gap-2">
              <h2 className="mr-auto text-[14px] font-semibold">Carrito</h2>
              <div className="w-[150px]"><Select aria-label="Canal del precio" value={canal} onChange={(e) => setCanal(e.target.value)} options={CANALES} className="!min-h-9 h-9 py-1.5 text-[13px]" /></div>
            </div>
            <Select aria-label="Agregar producto" value={agregar} placeholder="Agregar producto…"
              onChange={(e) => { const id = e.target.value; if (id && !lineas.some((l) => l.variant_id === id)) setLineas((x) => [...x, { variant_id: id, qty: "1" }]); setAgregar(""); }}
              options={variantes.map((v) => ({ value: v.id, label: `${v.name}${v.brand_name ? ` · ${v.brand_name}` : ""} (${v.sku})` }))} />
            {lineas.length === 0 ? <p className="text-[13px] text-muted">Sin productos: se calcula solo la zona y la tarifa.</p> : (
              <ul className="divide-y divide-line">
                {lineas.map((l, i) => {
                  const v = vNombre(l.variant_id);
                  const calc = t?.lineas.find((x) => x.variant_id === l.variant_id);
                  return (
                    <li key={l.variant_id} className="flex items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px]">{v?.name ?? l.variant_id}</div>
                        <div className="text-[12px] text-muted">{calc ? `${calc.precio != null ? soles(calc.precio) : "Sin precio"}${calc.base ? ` por ${calc.base}` : ""} · ${kg(calc.kg)} · ${soles(calc.importe)}` : v?.sku}</div>
                      </div>
                      <div className="w-[88px]"><Input aria-label="Cantidad" inputMode="decimal" value={l.qty} onChange={(e) => setLineas((x) => x.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} /></div>
                      <Button size="sm" variant="ghost" icon={Trash2} aria-label="Quitar" onClick={() => setLineas((x) => x.filter((_, j) => j !== i))} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-card lg:self-start">
          <h2 className="text-[14px] font-semibold">Resultado</h2>
          {!hayDonde ? <p className="text-[13px] text-muted">Pon un pin, elige un distrito o una zona.</p> : !t ? <p className="text-[13px] text-muted">Calculando…</p> : <>
            {t.cubierto && t.zona ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[16px] font-semibold">{t.zona.name}</span>
                  <span className="text-[22px] font-semibold">{t.gratis ? <Badge tone="ok">Delivery gratis</Badge> : soles(t.tarifa)}</span>
                </div>
                <DetailList items={[
                  { label: "Cómo se encontró", value: t.por === "POLYGON" ? "El pin cae en el polígono" : t.por === "DISTRICT" ? "Por el distrito" : "Zona elegida" },
                  { label: "Despacha", value: t.zona.local ?? "—" },
                  { label: "Prioridad", value: t.zona.priority ?? 100 },
                  { label: "Pedido mínimo", value: soles(t.zona.min_order_amount) },
                  { label: "Carrito", value: `${numero(t.unidades)} unidades · ${numero(t.kg, 2)} kg · ${soles(t.monto)}` },
                ]} />
                <Alert tone={t.gratis ? "ok" : "info"}>{t.motivo}.</Alert>
                {t.bajo_minimo && <Alert tone="warn">El carrito ({soles(t.monto)}) no llega al pedido mínimo de la zona ({soles(t.zona.min_order_amount)}).</Alert>}
                {t.zona.province && <Alert tone="info">Zona de provincia: se envía por agencia.</Alert>}
              </>
            ) : <Alert tone="warn" title="Fuera de cobertura">{t.motivo}</Alert>}
          </>}
        </section>
      </div>
    </div>
  );
}
