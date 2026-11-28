"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Minus, Plus, ScanBarcode, Scale, Search, ShoppingCart, Trash2 } from "lucide-react";
import { Alert, Button, IconButton, Input, Modal, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { kg, numero, soles } from "@/lib/formato";
import { BuscarCliente } from "@/modulos/pos/BuscarCliente";
import { cambiarCarrito, claveLinea, useCarrito, vaciarCarrito } from "@/modulos/pos/carrito";
import { Alertas, Seccion, SinTurno, Vacio } from "@/modulos/pos/Seccion";
import { TecladoPeso, type PesoElegido } from "@/modulos/pos/TecladoPeso";
import { esPeso, type LineaCarrito, type Producto, type VentaHecha } from "@/modulos/pos/tipos";
import { useContexto } from "@/modulos/pos/useContexto";
import { CobrarVenta, ResultadoVenta, useCotizacion } from "@/modulos/pos/Venta";

type Respuesta = { caja: { id: string; name: string; scale_mode: "MANUAL" | "SCALE" | "LABEL"; almacen: string }; productos: Producto[] };
type Lectura = { tipo: "ETIQUETA"; etiqueta: { variant_id: string; weight_kg: string; barcode: string }; producto: Producto | null } | { tipo: "PRODUCTO"; producto: Producto };

/** POS-02 Venta: buscador, lector, accesos rápidos por línea, carrito con peso y precio por kg, cliente opcional y total. */
export default function Venta() {
  const { ctx, error, cargando } = useContexto();
  const carrito = useCarrito();
  const { cot, error: errorCot, cargando: cotizando } = useCotizacion(carrito.lineas);
  const [q, setQ] = useState("");
  const [linea, setLinea] = useState("");
  const [datos, setDatos] = useState<{ clave: string; r?: Respuesta; error?: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [pesando, setPesando] = useState<{ producto: Producto; key?: string; inicial?: { weight_kg?: string; qty?: number } } | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [hecha, setHecha] = useState<VentaHecha | null>(null);

  const clave = `${q.trim()}|${linea}`;
  useEffect(() => {
    let vigente = true;
    const [texto, ln] = clave.split("|");
    const t = setTimeout(() => {
      const p = new URLSearchParams(Object.entries({ q: texto, linea: ln }).filter(([, v]) => v));
      api<Respuesta>(`/v1/pos/productos?${p}`)
        .then((r) => vigente && setDatos({ clave, r }))
        .catch((e) => vigente && setDatos({ clave, error: mensajeDe(e) }));
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [clave]);

  if (cargando) return <Vacio>Cargando el mostrador…</Vacio>;
  if (error || !ctx) return <Alert tone="bad">{error || "No se pudo cargar el mostrador."}</Alert>;

  const modo = datos?.r?.caja.scale_mode ?? "MANUAL";
  // Con stock primero: la cajera ve antes lo que puede vender.
  const productos = [...(datos?.r?.productos ?? [])].sort((a, b) => Number(b.disponible > 0) - Number(a.disponible > 0));
  const puedeVender = Boolean(ctx.turno) && ctx.puede.vender;

  function agregar(p: Producto) {
    if (esPeso(p.sale_mode)) {
      setPesando({ producto: p });
      return;
    }
    cambiarCarrito((c) => {
      const existe = c.lineas.find((l) => l.variant_id === p.id && !esPeso(l.sale_mode));
      return existe
        ? { ...c, lineas: c.lineas.map((l) => (l === existe ? { ...l, qty: (l.qty ?? 1) + 1 } : l)) }
        : { ...c, lineas: [...c.lineas, { key: claveLinea(), variant_id: p.id, name: p.name, sale_mode: p.sale_mode, qty: 1 }] };
    });
  }

  function ponerPeso(p: Producto, peso: PesoElegido, key?: string) {
    const nueva: LineaCarrito = {
      key: key ?? claveLinea(), variant_id: p.id, name: p.name, sale_mode: p.sale_mode, weight_kg: peso.weight_kg,
      qty: p.sale_mode === "UNIT_VARIABLE_WEIGHT" ? peso.qty : undefined, weight_source: peso.weight_source, barcode: peso.barcode, override: peso.override || undefined,
    };
    cambiarCarrito((c) => ({ ...c, lineas: key ? c.lineas.map((l) => (l.key === key ? nueva : l)) : [...c.lineas, nueva] }));
    setPesando(null);
  }

  async function leer() {
    const c = codigo.trim();
    if (!c) return;
    try {
      const r = await api<Lectura>("/v1/pos/codigo", { method: "POST", body: { code: c } });
      setCodigo("");
      if (r.tipo === "ETIQUETA") {
        const p = r.producto;
        if (!p) {
          toast.error("El producto de la etiqueta no se vende en esta caja.");
          return;
        }
        cambiarCarrito((x) => ({ ...x, lineas: [...x.lineas, {
          key: claveLinea(), variant_id: p.id, name: p.name, sale_mode: p.sale_mode, weight_kg: r.etiqueta.weight_kg,
          qty: p.sale_mode === "UNIT_VARIABLE_WEIGHT" ? 1 : undefined, weight_source: "LABEL", barcode: r.etiqueta.barcode,
        }] }));
        toast.ok(`${p.name}: ${kg(r.etiqueta.weight_kg)} de la etiqueta.`);
      } else {
        agregar(r.producto);
      }
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      enfocarLector();
    }
  }

  const cotizada = (key: string) => {
    const i = carrito.lineas.findIndex((l) => l.key === key);
    return cot?.lineas.find((l) => l.i === i);
  };
  const productoDe = (variantId: string) => productos.find((p) => p.id === variantId);

  async function editarPeso(l: LineaCarrito) {
    let p = productoDe(l.variant_id);
    if (!p) {
      try {
        const r = await api<Respuesta>(`/v1/pos/productos?q=${encodeURIComponent(l.name)}`);
        p = r.productos.find((x) => x.id === l.variant_id);
      } catch {}
    }
    if (p) setPesando({ producto: p, key: l.key, inicial: { weight_kg: l.weight_kg, qty: l.qty } });
  }

  const total = cot?.total ?? 0;
  const facturaSinRuc = carrito.doc_type === "INVOICE" && carrito.cliente?.doc_type !== "RUC";

  return (
    <div className="space-y-4">
      {!ctx.turno && <SinTurno abrir={ctx.puede.abrir} />}
      {ctx.turno && !ctx.puede.vender && <Alert tone="warn">Tu rol no registra ventas en el mostrador.</Alert>}
      <Alertas alertas={ctx.alertas.filter((a) => a.pantalla !== "pos-08")} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(340px,1fr)]">
        {/* Productos */}
        <div className="min-w-0 space-y-3">
          <Seccion>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto, SKU o PLU" aria-label="Buscar producto" className="pl-9" />
              </div>
              <div className="flex gap-2">
                <Input id="pos-lector" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Lector: código de barras o etiqueta" aria-label="Código de barras"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void leer(); } }} />
                <IconButton icon={ScanBarcode} label="Leer código" onClick={leer} />
              </div>
            </div>
            <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
              <Chip activo={!linea} onClick={() => setLinea("")}>Todo</Chip>
              {Object.entries(ctx.lineas).map(([k, v]) => <Chip key={k} activo={linea === k} onClick={() => setLinea(linea === k ? "" : k)}>{v}</Chip>)}
            </div>
            {datos?.r && <p className="mt-2 text-[12px] text-muted">{datos.r.caja.name} · precios de la caja · stock de {datos.r.caja.almacen}</p>}
          </Seccion>

          {datos?.error && <Alert tone="bad">{datos.error}</Alert>}
          {!datos && <Vacio>Cargando productos…</Vacio>}
          {datos?.r && productos.length === 0 && <Vacio>No hay productos con esa búsqueda.</Vacio>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {productos.map((p) => {
              const sinPrecio = p.precio === null;
              const sinStock = p.disponible <= 0;
              return (
                <button key={p.id} type="button" disabled={sinPrecio} onClick={() => agregar(p)}
                  className="flex min-h-[108px] cursor-pointer flex-col justify-between rounded-xl border border-line bg-surface p-3 text-left shadow-card hover:border-primary disabled:cursor-not-allowed disabled:opacity-50">
                  <div>
                    <div className="line-clamp-2 text-[13.5px] leading-tight font-medium text-ink">{p.name}</div>
                    <div className="mt-0.5 truncate text-[11.5px] text-muted">{p.marca}</div>
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-1">
                    <span className="text-[14px] font-semibold text-ink tabular-nums">
                      {sinPrecio ? "Sin precio" : `${soles(p.precio)}${p.base === "KG" ? "/kg" : ""}`}
                    </span>
                    {esPeso(p.sale_mode) && <Scale size={15} className="shrink-0 text-muted" aria-label="Se pesa" />}
                  </div>
                  <div className={`text-[11.5px] ${sinStock ? "text-bad" : "text-muted"}`}>
                    {sinStock ? "Sin stock en la exhibidora" : `Disp. ${numero(p.disponible, 3)}${p.reservado > 0 ? ` · ${numero(p.reservado, 3)} reservado` : ""}`}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Carrito */}
        <div id="pos-carrito" className="min-w-0 scroll-mt-4 lg:sticky lg:top-4 lg:self-start">
          <Seccion titulo="Venta" acciones={carrito.lineas.length > 0 && <Button size="sm" variant="ghost" icon={Trash2} onClick={vaciarCarrito}>Vaciar</Button>}>
            <div className="space-y-3">
              <BuscarCliente cliente={carrito.cliente} onElegir={(c) => cambiarCarrito((x) => ({ ...x, cliente: c, doc_type: c?.doc_type === "RUC" ? x.doc_type : "RECEIPT" }))} />
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Comprobante">
                {(["RECEIPT", "INVOICE"] as const).map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={carrito.doc_type === t} onClick={() => cambiarCarrito((x) => ({ ...x, doc_type: t }))}
                    className={`h-9 cursor-pointer rounded-md text-[13px] font-medium ${carrito.doc_type === t ? "bg-surface text-primary shadow-card" : "text-muted"}`}>
                    {t === "RECEIPT" ? "Boleta" : "Factura"}
                  </button>
                ))}
              </div>
              {facturaSinRuc && <p className="text-[12px] text-warn">Para factura, identifica a un cliente con RUC.</p>}

              {carrito.lineas.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center text-[13px] text-muted">
                  <ShoppingCart size={26} />Toca un producto o pasa el lector.
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {carrito.lineas.map((l) => {
                    const c = cotizada(l.key);
                    const peso = esPeso(l.sale_mode);
                    return (
                      <li key={l.key} className="py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[13.5px] font-medium text-ink">{l.name}</div>
                            <div className="text-[12px] text-muted">
                              {peso
                                ? <>{l.qty && l.sale_mode === "UNIT_VARIABLE_WEIGHT" ? `${l.qty} u · ` : ""}{kg(l.weight_kg)}{c ? ` × ${soles(c.price)}/kg` : ""}{l.weight_source === "LABEL" ? " · etiqueta" : ""}{l.override ? " · fuera de rango aceptado" : ""}</>
                                : <>{l.qty} × {c ? soles(c.price) : "…"}</>}
                            </div>
                          </div>
                          <span className="shrink-0 text-[14px] font-semibold text-ink tabular-nums">{c ? soles(c.amount) : "…"}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          {peso ? (
                            l.weight_source !== "LABEL" && <Button size="sm" icon={Scale} onClick={() => editarPeso(l)}>Cambiar peso</Button>
                          ) : (
                            <>
                              <IconButton icon={Minus} label="Una menos" disabled={(l.qty ?? 1) <= 1}
                                onClick={() => cambiarCarrito((x) => ({ ...x, lineas: x.lineas.map((y) => (y.key === l.key ? { ...y, qty: Math.max(1, (y.qty ?? 1) - 1) } : y)) }))} />
                              <span className="w-8 text-center text-[14px] tabular-nums">{l.qty}</span>
                              <IconButton icon={Plus} label="Una más"
                                onClick={() => cambiarCarrito((x) => ({ ...x, lineas: x.lineas.map((y) => (y.key === l.key ? { ...y, qty: (y.qty ?? 1) + 1 } : y)) }))} />
                            </>
                          )}
                          <span className="flex-1" />
                          <IconButton icon={Trash2} label={`Quitar ${l.name}`} onClick={() => cambiarCarrito((x) => ({ ...x, lineas: x.lineas.filter((y) => y.key !== l.key) }))} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {errorCot && <Alert tone="bad">{errorCot}</Alert>}
              {cot && cot.marcas.length > 1 && (
                <div className="rounded-lg bg-surface-2/60 p-2 text-[12.5px]">
                  <div className="mb-1 text-muted">Un comprobante por marca:</div>
                  {cot.marcas.map((m) => <div key={m.brand_id} className="flex justify-between"><span>{m.marca}</span><span className="tabular-nums">{soles(m.total)}</span></div>)}
                </div>
              )}
              {cot && (
                <div className="space-y-0.5 border-t border-line pt-2 text-[13px]">
                  <div className="flex justify-between text-muted"><span>Op. gravada</span><span className="tabular-nums">{soles(cot.subtotal)}</span></div>
                  <div className="flex justify-between text-muted"><span>IGV</span><span className="tabular-nums">{soles(cot.igv)}</span></div>
                </div>
              )}
              <div className="flex items-baseline justify-between">
                <span className="text-[15px] font-semibold text-ink">Total</span>
                <span className="text-[26px] font-semibold text-ink tabular-nums">{soles(total)}</span>
              </div>
              <Button variant="primary" className="h-12 w-full text-[15px]" disabled={!puedeVender || !cot || cotizando || Boolean(errorCot) || facturaSinRuc}
                onClick={() => setCobrando(true)}>
                Cobrar {cot ? soles(total) : ""}
              </Button>
              {ctx.turno && <p className="text-center text-[11.5px] text-muted">Turno {ctx.turno.number} · {ctx.turno.caja.name}</p>}
            </div>
          </Seccion>
        </div>
      </div>

      {/* En el celular el carrito queda bajo los productos: una barra fija lleva al total. */}
      {carrito.lineas.length > 0 && (
        <div className="sticky bottom-3 z-10 lg:hidden">
          <button type="button" onClick={() => document.getElementById("pos-carrito")?.scrollIntoView({ behavior: "smooth" })}
            className="flex h-12 w-full cursor-pointer items-center justify-between rounded-xl bg-primary px-4 text-[14.5px] font-semibold text-primary-ink shadow-card">
            <span className="flex items-center gap-2"><ShoppingCart size={18} />{carrito.lineas.length} en la venta</span>
            <span className="tabular-nums">{cot ? soles(total) : "…"}</span>
          </button>
        </div>
      )}

      <Modal open={Boolean(pesando)} onClose={() => setPesando(null)} title="Ingreso de peso" placement="center" size="sm">
        {pesando && (
          <TecladoPeso key={pesando.key ?? pesando.producto.id} producto={pesando.producto} modo={modo} inicial={pesando.inicial} puedeForzar={ctx.puede.peso_fuera_de_rango}
            onCancelar={() => setPesando(null)} onAceptar={(p) => ponerPeso(pesando.producto, p, pesando.key)} />
        )}
      </Modal>

      <Modal open={cobrando && Boolean(cot)} onClose={() => setCobrando(false)} title="Cobro" size="md">
        {cot && <CobrarVenta ctx={ctx} carrito={carrito} total={cot.total} onHecha={(v) => { setCobrando(false); setHecha(v); }} />}
      </Modal>

      <Modal open={Boolean(hecha)} onClose={() => setHecha(null)} title="Comprobante" size="md">
        {hecha && <ResultadoVenta venta={hecha} onNueva={() => { setHecha(null); enfocarLector(); }} />}
      </Modal>
    </div>
  );
}

const enfocarLector = () => document.getElementById("pos-lector")?.focus();

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`h-9 shrink-0 cursor-pointer rounded-full border px-3.5 text-[13px] ${activo ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-ink hover:bg-surface-2"}`}>
      {children}
    </button>
  );
}
