"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Circle, MapPin, Plus, Save, Search, Send, Trash2, UserPlus } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Field, IconButton, Input, MapPicker, Modal, Select, Textarea, toast, type LatLng } from "@/components/ui";
import { ApiError, api, mensajeDe } from "@/lib/api";
import { kg, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { SelectorProductos } from "@/modulos/ped/SelectorProductos";
import { useOpciones } from "@/modulos/ped/usePedido";
import { CANALES, COMPROBANTES, ENTREGAS, MODOS_VENTA, celular, hoyLima, nombreEstado, type Detalle, type Falta, type FranjaDisponible, type Producto } from "@/modulos/ped/tipos";

type ClienteBusqueda = { id: string; full_name: string; trade_name: string | null; phone: string | null; doc_type: string; doc_number: string | null; status: string };
type Direccion = { id: string; label: string | null; address_line: string; district: string; reference: string | null; lat: number | null; lng: number | null; zone_id: string | null;
  is_default: boolean; needs_pin: boolean; out_of_coverage: boolean; zona: string | null; establishment_id: string | null; province: boolean | null };
type FichaCliente = { cliente: ClienteBusqueda & { customer_type: string; blocked_reason: string | null }; bloqueo: [string, string] | null; saldo: number; direcciones: Direccion[] };
type LineaForm = { variant_id: string; name: string; sku: string; sale_mode: string; qty: string; est_weight_kg: string; cut_notes: string; precio: number | null; base: string | null; nominal: number | null };

/** PED-02 Nuevo pedido: una pantalla pensada para el celular, con los datos que faltan en vivo. ?id= edita un borrador. */
export default function NuevoPedido() {
  return <Suspense><Formulario /></Suspense>;
}

function Formulario() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const { me, marca: marcaSup, can } = useSesion();
  const op = useOpciones();

  const [cargado, setCargado] = useState(!id);
  const [numero, setNumero] = useState("");
  const [marca, setMarca] = useState(marcaSup !== "ALL" ? marcaSup : me.user.default_brand_id ?? "");
  const [canal, setCanal] = useState("WHATSAPP");
  const [ficha, setFicha] = useState<FichaCliente | null>(null);
  const [contacto, setContacto] = useState("");
  const [entrega, setEntrega] = useState("DELIVERY");
  const [direccion, setDireccion] = useState("");
  const [recojo, setRecojo] = useState("");
  const [local, setLocal] = useState("");
  const [dia, setDia] = useState(hoyLima());
  const [franja, setFranja] = useState("");
  const [franjas, setFranjas] = useState<FranjaDisponible[]>([]);
  const [comprobante, setComprobante] = useState("RECEIPT");
  const [pago, setPago] = useState("");
  const [pagado, setPagado] = useState("");
  const [notas, setNotas] = useState("");
  const [sinIndicaciones, setSinIndicaciones] = useState(false);
  const [lineas, setLineas] = useState<LineaForm[]>([]);
  const [descTipo, setDescTipo] = useState<"pct" | "amount">("pct");
  const [descValor, setDescValor] = useState("");
  const [descMotivo, setDescMotivo] = useState("");
  const [limite, setLimite] = useState<{ max_pct: number | null; max_amount: number | null } | null>(null);
  const [agencia, setAgencia] = useState("");
  const [destino, setDestino] = useState("");
  const [termico, setTermico] = useState(false);
  const [origenWa, setOrigenWa] = useState("");
  const [anuncio, setAnuncio] = useState("");
  const [referencia, setReferencia] = useState("");
  const [bloqueado, setBloqueado] = useState(false);
  const [selector, setSelector] = useState(false);
  const [nuevaDir, setNuevaDir] = useState(false);
  const [guardando, setGuardando] = useState<"" | "borrador" | "confirmar">("");
  const [error, setError] = useState("");
  const [faltanServidor, setFaltanServidor] = useState<Falta[] | null>(null);
  const [servidor, setServidor] = useState<Detalle | null>(null);

  // Editar un borrador: carga el pedido.
  useEffect(() => {
    if (!id) return;
    api<Detalle>(`/v1/ped/pedidos/${id}`).then(async (d) => {
      const o = d.pedido;
      if (o.status !== "DRAFT") { router.replace(`/m/ped/ped-03?id=${id}`); return; }
      setNumero(o.number); setMarca(o.brand_id); setCanal(o.channel); setContacto(o.contact_phone ?? ""); setEntrega(o.fulfillment);
      setDireccion(o.address_id ?? ""); setRecojo(o.pickup_establishment_id ?? ""); setLocal(o.establishment_id); setDia(o.delivery_date ?? hoyLima());
      setFranja(o.slot_id ?? ""); setComprobante(o.requested_doc_type); setPago(o.payment_method_id ?? ""); setPagado(Number(o.paid_amount) ? String(Number(o.paid_amount)) : "");
      setNotas(o.notes ?? ""); setSinIndicaciones(Boolean(o.prep_notes_ok)); setAgencia(o.province_agency ?? ""); setDestino(o.province_destination ?? "");
      setTermico(Boolean(o.thermal_packaging)); setOrigenWa(o.origin_wa_number ?? ""); setAnuncio(o.origin_ad_code ?? ""); setReferencia(o.external_ref ?? "");
      setBloqueado(Boolean(o.origin_locked));
      if (o.order_discount_pct && Number(o.order_discount_pct) > 0) { setDescTipo("pct"); setDescValor(String(Number(o.order_discount_pct))); }
      else if (o.order_discount && Number(o.order_discount) > 0) { setDescTipo("amount"); setDescValor(String(Number(o.order_discount))); }
      setDescMotivo(o.discount_reason ?? "");
      setLineas(d.lineas.map((l) => ({ variant_id: l.variant_id, name: l.name, sku: l.sku, sale_mode: l.sale_mode, qty: String(Number(l.qty)),
        est_weight_kg: l.est_weight_kg ? String(Number(l.est_weight_kg)) : "", cut_notes: l.cut_notes ?? "", precio: Number(l.unit_price), base: l.price_basis,
        nominal: l.nominal_weight_kg ? Number(l.nominal_weight_kg) : null })));
      setServidor(d); setFaltanServidor(d.faltan);
      await elegirCliente(o.customer_id);
      setCargado(true);
    }).catch((e) => { setError(mensajeDe(e)); setCargado(true); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function elegirCliente(cid: string) {
    try {
      const f = await api<FichaCliente>(`/v1/ped/clientes/${cid}`);
      setFicha(f);
      if (!id || f.cliente.id !== servidor?.pedido.customer_id) {
        const pred = f.direcciones.find((a) => a.is_default) ?? f.direcciones[0];
        setDireccion((actual) => (actual && f.direcciones.some((a) => a.id === actual) ? actual : pred?.id ?? ""));
      }
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  // Local que atiende: el de la zona del pin, el de recojo o el primero del usuario.
  const dirElegida = ficha?.direcciones.find((a) => a.id === direccion) ?? null;
  const localSugerido = entrega === "PICKUP" ? recojo : entrega === "DELIVERY" || entrega === "PROVINCE_SHIPPING" ? dirElegida?.establishment_id ?? "" : "";
  const localFinal = localSugerido || local || me.establishments[0]?.id || op?.locales[0]?.id || "";

  useEffect(() => {
    if (!localFinal || !dia || entrega === "COUNTER") return;
    let vigente = true;
    api<FranjaDisponible[]>(`/v1/ped/franjas/disponibles?establishment_id=${localFinal}&fecha=${dia}${dirElegida?.zone_id ? `&zone_id=${dirElegida.zone_id}` : ""}`)
      .then((f) => vigente && setFranjas(f)).catch(() => vigente && setFranjas([]));
    return () => { vigente = false; };
  }, [localFinal, dia, entrega, dirElegida?.zone_id]);

  useEffect(() => {
    if (!marca) return;
    api<{ max_pct: number | null; max_amount: number | null }>(`/v1/ped/descuentos/limite?brand_id=${marca}`).then(setLimite).catch(() => {});
  }, [marca]);

  const subtotal = useMemo(() => lineas.reduce((s, l) => {
    const q = Number(l.qty) || 0;
    const peso = l.sale_mode === "KG" ? q : Number(l.est_weight_kg) || (l.nominal ?? 0) * q;
    return s + (l.precio ?? 0) * (l.base === "KG" ? peso : q);
  }, 0), [lineas]);
  const descuento = descValor ? (descTipo === "pct" ? Math.min(subtotal, subtotal * Number(descValor) / 100) : Math.min(subtotal, Number(descValor))) : 0;
  const pctReal = subtotal > 0 ? descuento / subtotal * 100 : 0;
  const sobreLimite = limite && descuento > 0 && ((limite.max_pct !== null && pctReal > limite.max_pct + 0.001) || (limite.max_amount !== null && descuento > limite.max_amount + 0.005));
  const formaPago = op?.formas_pago.find((f) => f.id === pago);

  // RN-PED-01 en vivo (la API vuelve a revisarlo al confirmar).
  const mostrador = entrega === "COUNTER";
  const faltan: string[] = [];
  if (!ficha) faltan.push("Cliente");
  if (!mostrador && !contacto && !ficha?.cliente.phone) faltan.push("Celular del cliente o de contacto");
  if (comprobante === "INVOICE" && ficha && ficha.cliente.doc_type !== "RUC") faltan.push("Cliente con RUC para la factura");
  if ((entrega === "DELIVERY" || entrega === "PROVINCE_SHIPPING") && (!dirElegida || dirElegida.lat === null || dirElegida.needs_pin)) faltan.push("Dirección con pin");
  if (entrega === "PICKUP" && !recojo) faltan.push("Local de recojo");
  if (entrega === "PROVINCE_SHIPPING" && !agencia) faltan.push("Agencia de envío");
  if (!mostrador && !dia) faltan.push("Fecha de entrega");
  if (!mostrador && entrega !== "PROVINCE_SHIPPING" && !franja) faltan.push("Franja");
  if (!lineas.length) faltan.push("Al menos un producto");
  if (lineas.some((l) => l.base === "KG" && l.sale_mode === "UNIT_VARIABLE_WEIGHT" && !(Number(l.est_weight_kg) > 0) && !l.nominal)) faltan.push("Peso estimado");
  if (!pago) faltan.push("Forma de pago");
  if (entrega === "PROVINCE_SHIPPING" && formaPago && ["CASH", "CREDIT"].includes(formaPago.code)) faltan.push("Pago adelantado (provincia no acepta contra entrega)");
  if (!mostrador && !notas.trim() && !sinIndicaciones) faltan.push("Notas de preparación (o «Sin indicaciones»)");
  if (sobreLimite) faltan.push("Aprobación del descuento (supera tu límite)");

  function agregar(p: Producto) {
    setLineas((ls) => [...ls, { variant_id: p.id, name: p.name, sku: p.sku, sale_mode: p.sale_mode, qty: p.sale_mode === "KG" ? "1" : "1",
      est_weight_kg: p.sale_mode === "UNIT_VARIABLE_WEIGHT" && p.nominal_weight_kg ? String(Number(p.nominal_weight_kg)) : "",
      cut_notes: "", precio: p.precio, base: p.base, nominal: p.nominal_weight_kg ? Number(p.nominal_weight_kg) : null }]);
    toast.ok(`${p.name} agregado`);
  }
  function cambiarLinea(i: number, campo: keyof LineaForm, valor: string) {
    setLineas((ls) => ls.map((l, j) => {
      if (j !== i) return l;
      const n = { ...l, [campo]: valor };
      // El peso estimado acompaña a la cantidad mientras no se haya escrito a mano.
      if (campo === "qty" && l.sale_mode === "UNIT_VARIABLE_WEIGHT" && l.nominal) n.est_weight_kg = String(Math.round(Number(valor) * l.nominal * 1000) / 1000);
      return n;
    }));
  }

  async function guardar(confirmar: boolean) {
    if (!ficha) { setError("Elige el cliente del pedido."); return; }
    setGuardando(confirmar ? "confirmar" : "borrador");
    setError("");
    const body = {
      brand_id: marca, channel: canal, customer_id: ficha.cliente.id, contact_phone: contacto || null, fulfillment: entrega,
      address_id: entrega === "DELIVERY" || entrega === "PROVINCE_SHIPPING" ? direccion || null : null,
      pickup_establishment_id: entrega === "PICKUP" ? recojo || null : null, establishment_id: localFinal || null,
      delivery_date: mostrador ? null : dia || null, slot_id: mostrador || entrega === "PROVINCE_SHIPPING" ? (entrega === "PROVINCE_SHIPPING" ? franja || null : null) : franja || null,
      requested_doc_type: comprobante, payment_method_id: pago || null, paid_amount: pagado ? Number(pagado) : 0,
      notes: notas || null, prep_notes_ok: sinIndicaciones,
      province_agency: entrega === "PROVINCE_SHIPPING" ? agencia || null : null, province_destination: entrega === "PROVINCE_SHIPPING" ? destino || null : null,
      thermal_packaging: entrega === "PROVINCE_SHIPPING" ? termico : null,
      ...(bloqueado ? {} : { origin_wa_number: origenWa || null, origin_ad_code: anuncio || null, external_ref: referencia || null }),
      lines: lineas.map((l) => ({ variant_id: l.variant_id, qty: Number(l.qty), est_weight_kg: l.est_weight_kg ? Number(l.est_weight_kg) : null, cut_notes: l.cut_notes || null })),
      discount: descValor && Number(descValor) > 0 ? { [descTipo]: Number(descValor), reason: descMotivo } : null,
    };
    try {
      let d = await api<Detalle>(id ? `/v1/ped/pedidos/${id}` : "/v1/ped/pedidos", { method: id ? "PUT" : "POST", body });
      setServidor(d);
      setFaltanServidor(d.faltan);
      if (!id) router.replace(`/m/ped/ped-02?id=${d.pedido.id}`);
      if (confirmar) {
        try {
          d = await api<Detalle>(`/v1/ped/pedidos/${d.pedido.id}/confirmar`, { method: "POST" });
          toast.ok(`Pedido ${d.pedido.number} confirmado`);
          router.push(`/m/ped/ped-05?id=${d.pedido.id}`);
          return;
        } catch (e) {
          if (e instanceof ApiError && e.code === "RN-PED-01") {
            api<{ faltan: Falta[] }>(`/v1/ped/pedidos/${d.pedido.id}/faltantes`).then((r) => setFaltanServidor(r.faltan)).catch(() => {});
          }
          setError(mensajeDe(e));
          return;
        }
      }
      toast.ok(`Borrador ${d.pedido.number} guardado`);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando("");
    }
  }

  if (!cargado) return <p className="text-[13px] text-muted">Cargando el pedido…</p>;
  const opcionesMarcas = (op?.marcas ?? []).filter((m) => !me.brands.length || me.brands.some((b) => b.id === m.id)).map((m) => ({ value: m.id, label: m.name }));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        {numero && <p className="text-[13px] text-muted">Editando el borrador <b className="text-ink">{numero}</b></p>}
        {error && <Alert tone="bad">{error}</Alert>}

        <Seccion titulo="Cliente">
          <BuscadorCliente ficha={ficha} canal={canal} onElegir={elegirCliente} onQuitar={() => { setFicha(null); setDireccion(""); }} />
          {ficha?.bloqueo && <Alert tone="bad">{ficha.bloqueo[1]}</Alert>}
          {ficha && ficha.saldo > 0 && <Alert tone="info">Tiene {soles(ficha.saldo)} de saldo a favor.</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Marca" required hint="Un pedido es de una sola marca.">
              <Select value={marca} onChange={(e) => { setMarca(e.target.value); setLineas([]); }} placeholder="Elige la marca" options={opcionesMarcas} />
            </Field>
            <Field label="Canal" required hint={bloqueado ? "Llegó desde un chat o la web: no se cambia." : undefined}>
              <Select value={canal} disabled={bloqueado} onChange={(e) => { setCanal(e.target.value); if (e.target.value === "COUNTER") setEntrega("COUNTER"); }} options={CANALES} />
            </Field>
            <Field label="Celular de contacto" hint="Si recibe otra persona.">
              <Input inputMode="tel" value={contacto} onChange={(e) => setContacto(e.target.value)} placeholder={ficha?.cliente.phone ? celular(ficha.cliente.phone) : "987 654 321"} />
            </Field>
          </div>
        </Seccion>

        <Seccion titulo="Entrega">
          <div className="flex flex-wrap gap-2">
            {ENTREGAS.map((e) => (
              <button key={e.value} type="button" onClick={() => setEntrega(e.value)}
                className={`cursor-pointer rounded-full border px-3 py-1.5 text-[13px] ${entrega === e.value ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-ink hover:bg-surface-2"}`}>{e.label}</button>
            ))}
          </div>
          {(entrega === "DELIVERY" || entrega === "PROVINCE_SHIPPING") && (
            <div className="space-y-2">
              {!ficha ? <p className="text-[13px] text-muted">Elige el cliente para ver sus direcciones.</p> : (
                <>
                  {ficha.direcciones.length === 0 && <p className="text-[13px] text-muted">El cliente no tiene direcciones: agrega una con su pin.</p>}
                  {ficha.direcciones.map((a) => (
                    <label key={a.id} className={`flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5 ${direccion === a.id ? "border-primary bg-primary-soft" : "border-line bg-surface"}`}>
                      <input type="radio" name="direccion" checked={direccion === a.id} onChange={() => setDireccion(a.id)} className="mt-1" />
                      <span className="min-w-0 text-[13px]">
                        <span className="block font-medium text-ink">{a.label ?? "Dirección"} · {a.address_line}, {a.district}</span>
                        <span className="block text-muted">{a.reference}</span>
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {a.zona ? <Badge tone="info">{a.zona}</Badge> : <Badge tone="warn">Fuera de cobertura</Badge>}
                          {(a.lat === null || a.needs_pin) && <Badge tone="bad">Sin pin</Badge>}
                        </span>
                      </span>
                    </label>
                  ))}
                  {can("ped.order.create") && <Button size="sm" icon={MapPin} onClick={() => setNuevaDir(true)}>Nueva dirección con pin</Button>}
                </>
              )}
            </div>
          )}
          {entrega === "PICKUP" && (
            <Field label="Local de recojo" required>
              <Select value={recojo} onChange={(e) => setRecojo(e.target.value)} placeholder="Elige el local" options={(op?.locales ?? []).map((l) => ({ value: l.id, label: l.name }))} />
            </Field>
          )}
          {entrega === "PROVINCE_SHIPPING" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Agencia" required>
                <Select value={agencia} onChange={(e) => setAgencia(e.target.value)} placeholder="Elige la agencia" options={(op?.agencias ?? []).map((a) => ({ value: a.id, label: a.name }))} />
              </Field>
              <Field label="Destino (ciudad)"><Input value={destino} onChange={(e) => setDestino(e.target.value)} maxLength={20} placeholder="Arequipa" /></Field>
              <Checkbox checked={termico} onChange={setTermico} label="Embalaje térmico" />
            </div>
          )}
          {(entrega === "COUNTER" || (!localSugerido && entrega !== "PICKUP")) && (
            <Field label="Local que atiende">
              <Select value={localFinal} onChange={(e) => setLocal(e.target.value)} options={(op?.locales ?? []).map((l) => ({ value: l.id, label: l.name }))} />
            </Field>
          )}
          {entrega !== "COUNTER" && (
            <div className="space-y-2">
              <Field label="Fecha de entrega" required>
                <Input type="date" value={dia} min={hoyLima()} onChange={(e) => { setDia(e.target.value); setFranja(""); }} className="sm:max-w-[200px]" />
              </Field>
              {entrega !== "PROVINCE_SHIPPING" && (
                <div className="grid gap-2 sm:grid-cols-3">
                  {franjas.length === 0 && <p className="text-[13px] text-muted">No hay franjas para ese día en el local.</p>}
                  {franjas.map((f) => (
                    <button key={f.id} type="button" onClick={() => setFranja(f.id)}
                      className={`cursor-pointer rounded-[9px] border px-3 py-2 text-left text-[13px] ${franja === f.id ? "border-primary bg-primary-soft" : "border-line bg-surface hover:bg-surface-2"}`}>
                      <span className="block font-medium text-ink">{f.slot_from}–{f.slot_to}</span>
                      <span className={`block text-[12px] ${f.llena || f.paso_corte ? "text-bad" : "text-muted"}`}>
                        {f.ocupados}/{f.capacity}{f.llena ? " · llena" : ""}{f.paso_corte ? " · pasó el corte" : ` · corte ${f.cutoff}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Seccion>

        <Seccion titulo="Productos" accion={<Button size="sm" icon={Plus} disabled={!marca} onClick={() => setSelector(true)}>Agregar producto</Button>}>
          {lineas.length === 0 ? <p className="text-[13px] text-muted">Sin productos. Usa «Agregar producto»: solo se venden productos del catálogo de la marca.</p> : (
            <ul className="space-y-2">
              {lineas.map((l, i) => {
                const q = Number(l.qty) || 0;
                const peso = l.sale_mode === "KG" ? q : Number(l.est_weight_kg) || 0;
                const importe = (l.precio ?? 0) * (l.base === "KG" ? peso : q);
                return (
                  <li key={`${l.variant_id}-${i}`} className="rounded-[10px] border border-line bg-surface p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-medium text-ink">{l.name}</div>
                        <div className="text-[12px] text-muted">{l.sku} · {MODOS_VENTA[l.sale_mode]} · {soles(l.precio)}{l.base === "KG" ? " /kg" : " c/u"}</div>
                      </div>
                      <IconButton icon={Trash2} label="Quitar" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Field label={l.sale_mode === "KG" ? "Kg" : "Cantidad"}>
                        <Input type="number" inputMode="decimal" min="0" step={l.sale_mode === "KG" ? "0.001" : "1"} value={l.qty} onChange={(e) => cambiarLinea(i, "qty", e.target.value)} />
                      </Field>
                      {l.sale_mode === "UNIT_VARIABLE_WEIGHT" && (
                        <Field label="Peso estimado (kg)">
                          <Input type="number" inputMode="decimal" min="0" step="0.001" value={l.est_weight_kg} onChange={(e) => cambiarLinea(i, "est_weight_kg", e.target.value)} />
                        </Field>
                      )}
                      <Field label="Corte o indicación" className="col-span-2 sm:col-span-1">
                        <Input value={l.cut_notes} onChange={(e) => cambiarLinea(i, "cut_notes", e.target.value)} maxLength={255} placeholder="En 4 partes…" />
                      </Field>
                      <div className="self-end text-right text-[13.5px] font-medium text-ink">{soles(importe)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {lineas.some((l) => l.base === "KG") && <p className="text-[12.5px] text-muted">Los productos por kg se cobran con el peso real; hasta pesarse, el total es estimado.</p>}
        </Seccion>

        <Seccion titulo="Pago, comprobante y notas">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Forma de pago" required>
              <Select value={pago} onChange={(e) => setPago(e.target.value)} placeholder="Elige" options={(op?.formas_pago ?? []).map((f) => ({ value: f.id, label: f.name }))} />
            </Field>
            <Field label="Ya pagó (adelanto)" hint="Lo que el cliente ya pagó, si pagó antes.">
              <Input type="number" inputMode="decimal" min="0" step="0.01" prefix="S/" value={pagado} onChange={(e) => setPagado(e.target.value)} />
            </Field>
            <Field label="Comprobante" required hint={comprobante === "INVOICE" ? "La factura exige un cliente con RUC válido." : undefined}>
              <Select value={comprobante} onChange={(e) => setComprobante(e.target.value)} options={COMPROBANTES} />
            </Field>
          </div>
          {!mostrador && (
            <div className="space-y-2">
              <Field label="Notas de preparación">
                <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} maxLength={2000} placeholder="Cuy en 4 partes, sin cabeza…" />
              </Field>
              <Checkbox checked={sinIndicaciones} onChange={setSinIndicaciones} label="Sin indicaciones" hint="Elígelo si el cliente no pidió nada especial." />
            </div>
          )}
        </Seccion>

        <Seccion titulo="Descuento">
          <div className="grid gap-3 sm:grid-cols-[120px_160px_1fr]">
            <Field label="Tipo"><Select value={descTipo} onChange={(e) => setDescTipo(e.target.value as "pct" | "amount")} options={[{ value: "pct", label: "%" }, { value: "amount", label: "Soles" }]} /></Field>
            <Field label="Valor"><Input type="number" inputMode="decimal" min="0" step="0.01" value={descValor} onChange={(e) => setDescValor(e.target.value)} /></Field>
            <Field label="Motivo" required={Boolean(descValor)}><Input value={descMotivo} onChange={(e) => setDescMotivo(e.target.value)} maxLength={255} placeholder="Cliente frecuente…" /></Field>
          </div>
          {limite && (
            <p className={`text-[12.5px] ${sobreLimite ? "text-warn" : "text-muted"}`}>
              Tu límite: {limite.max_pct === null ? "sin límite" : `${limite.max_pct} % o ${soles(limite.max_amount)}`}.
              {sobreLimite ? " Este descuento queda pendiente de aprobación de la supervisora." : ""}
            </p>
          )}
        </Seccion>

        <Seccion titulo="Origen del pedido">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="WhatsApp de origen"><Input value={origenWa} disabled={bloqueado} onChange={(e) => setOrigenWa(e.target.value)} maxLength={40} /></Field>
            <Field label="Código de anuncio"><Input value={anuncio} disabled={bloqueado} onChange={(e) => setAnuncio(e.target.value)} maxLength={20} /></Field>
            <Field label="Referencia externa"><Input value={referencia} disabled={bloqueado} onChange={(e) => setReferencia(e.target.value)} maxLength={40} /></Field>
          </div>
        </Seccion>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-2 text-[14px] font-semibold text-ink">Resumen</h2>
          <dl className="space-y-1 text-[13px]">
            <Fila t="Productos" v={soles(subtotal)} />
            {descuento > 0 && <Fila t="Descuento" v={`− ${soles(descuento)}`} />}
            {entrega === "DELIVERY" && <Fila t="Delivery" v={servidor ? (Number(servidor.pedido.delivery_fee) ? soles(servidor.pedido.delivery_fee) : "Gratis") : "Al guardar"} />}
            <Fila t="Total estimado" v={servidor && !guardando ? soles(servidor.pedido.estimated_total) : soles(subtotal - descuento)} fuerte />
            {lineas.some((l) => l.sale_mode !== "UNIT") && <Fila t="Peso estimado" v={kg(lineas.reduce((s, l) => s + (l.sale_mode === "KG" ? Number(l.qty) || 0 : Number(l.est_weight_kg) || 0), 0))} />}
          </dl>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-2 text-[14px] font-semibold text-ink">{faltan.length ? `Falta para confirmar (${faltan.length})` : "Listo para confirmar"}</h2>
          {faltan.length === 0 ? <p className="flex items-center gap-2 text-[13px] text-ok"><CheckCircle2 size={16} /> Tiene todos los datos obligatorios.</p> : (
            <ul className="space-y-1">
              {faltan.map((f) => <li key={f} className="flex items-center gap-2 text-[13px] text-ink"><Circle size={12} className="text-warn" /> {f}</li>)}
            </ul>
          )}
          {faltanServidor && faltanServidor.length > 0 && servidor && (
            <p className="mt-2 text-[12px] text-muted">Según el borrador guardado falta: {faltanServidor.map((f) => f.texto).join(", ")}.</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {can("ped.order.confirm") && (
            <Button variant="primary" icon={Send} loading={guardando === "confirmar"} disabled={Boolean(guardando) || !ficha || !marca} onClick={() => guardar(true)}>Guardar y confirmar</Button>
          )}
          <Button icon={Save} loading={guardando === "borrador"} disabled={Boolean(guardando) || !ficha || !marca} onClick={() => guardar(false)}>Guardar borrador</Button>
          {id && servidor && <Button variant="ghost" onClick={() => router.push(`/m/ped/ped-03?id=${id}`)}>Ver detalle ({nombreEstado(servidor.pedido.status)})</Button>}
        </div>
      </aside>

      <Modal open={selector} onClose={() => setSelector(false)} title="Agregar producto" description="Productos activos de la marca, con el precio del canal y el stock del local." size="lg">
        <SelectorProductos marca={marca} canal={canal} cliente={ficha?.cliente.id} local={localFinal} onElegir={agregar} elegidos={lineas.map((l) => l.variant_id)} />
      </Modal>
      {ficha && (
        <NuevaDireccion abierto={nuevaDir} cliente={ficha.cliente.id} onCerrar={() => setNuevaDir(false)}
          onGuardada={async (dirId) => { setNuevaDir(false); await elegirCliente(ficha.cliente.id); setDireccion(dirId); }} />
      )}
    </div>
  );
}

function Seccion({ titulo, accion, children }: { titulo: string; accion?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2"><h2 className="text-[14px] font-semibold text-ink">{titulo}</h2>{accion}</div>
      {children}
    </section>
  );
}

function Fila({ t, v, fuerte }: { t: string; v: string; fuerte?: boolean }) {
  return <div className={`flex justify-between gap-2 ${fuerte ? "border-t border-line pt-1 font-semibold text-ink" : "text-muted"}`}><dt>{t}</dt><dd className="text-ink">{v}</dd></div>;
}

/** Busca el cliente por celular (como sea que se escriba) o nombre; si no existe, alta rápida. */
function BuscadorCliente({ ficha, canal, onElegir, onQuitar }: { ficha: FichaCliente | null; canal: string; onElegir: (id: string) => void; onQuitar: () => void }) {
  const [texto, setTexto] = useState("");
  const [res, setRes] = useState<{ q: string; filas: ClienteBusqueda[]; normalizado: string | null } | null>(null);
  const [alta, setAlta] = useState(false);
  const [nombre, setNombre] = useState("");
  const [enviando, setEnviando] = useState(false);
  const q = texto.trim();

  useEffect(() => {
    if (q.length < 3) return;
    let vigente = true;
    const t = setTimeout(() => {
      api<{ filas: ClienteBusqueda[]; normalizado: string | null }>(`/v1/ped/clientes/buscar?q=${encodeURIComponent(q)}`)
        .then((r) => vigente && setRes({ q, ...r })).catch(() => {});
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [q]);

  async function crear() {
    setEnviando(true);
    try {
      const canalCli = canal === "COUNTER" ? "POS" : ["WHATSAPP", "FACEBOOK", "INSTAGRAM", "TIKTOK", "WEB", "PHONE", "B2B"].includes(canal) ? canal : "OTHER";
      const r = await api<{ customer: { id: string }; existente: boolean }>("/v1/ped/clientes/rapida", { method: "POST", body: { phone: q, full_name: nombre, source_channel: canalCli } });
      toast.ok(r.existente ? "Ese celular ya era de un cliente: se eligió" : "Cliente creado");
      setAlta(false); setTexto(""); setNombre("");
      onElegir(r.customer.id);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  if (ficha) {
    const c = ficha.cliente;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink">{c.trade_name || c.full_name}</div>
          <div className="text-[12.5px] text-muted">{celular(c.phone)}{c.doc_type !== "NONE" && c.doc_number ? ` · ${c.doc_type} ${c.doc_number}` : ""}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={onQuitar}>Cambiar</Button>
      </div>
    );
  }
  const filas = q.length >= 3 && res?.q === q ? res.filas : [];
  const pareceCelular = /^[\d\s+().-]{9,}$/.test(q);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Celular (987 654 321) o nombre del cliente" aria-label="Buscar cliente" inputMode="search"
          className="h-11 w-full rounded-[9px] border border-line bg-surface pr-3 pl-9 text-[14px] text-ink outline-none focus:border-primary" />
      </div>
      {filas.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-[10px] border border-line">
          {filas.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { setTexto(""); onElegir(c.id); }} className="flex w-full cursor-pointer items-center justify-between gap-3 bg-surface px-3 py-2 text-left text-[13px] hover:bg-surface-2">
                <span>{c.trade_name || c.full_name}{c.status === "BLOCKED" && <Badge tone="bad">Bloqueado</Badge>}</span>
                <span className="font-mono text-[12px] text-muted">{celular(c.phone)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.length >= 3 && res?.q === q && filas.length === 0 && (
        <p className="text-[13px] text-muted">No hay un cliente con «{q}».</p>
      )}
      {pareceCelular && res?.q === q && !filas.some((c) => c.phone === res.normalizado) && (
        alta ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label={`Nombre del cliente con el celular ${q}`} className="flex-1"><Input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} /></Field>
            <Button variant="primary" loading={enviando} disabled={nombre.trim().length < 2} onClick={crear}>Crear y elegir</Button>
          </div>
        ) : <Button size="sm" icon={UserPlus} onClick={() => setAlta(true)}>Alta rápida con este celular</Button>
      )}
    </div>
  );
}

/** Dirección nueva con pin en el mapa (RN-CLI-02): la zona y la tarifa salen del pin. */
function NuevaDireccion({ abierto, cliente, onCerrar, onGuardada }: { abierto: boolean; cliente: string; onCerrar: () => void; onGuardada: (id: string) => void }) {
  const [linea, setLinea] = useState("");
  const [distrito, setDistrito] = useState("");
  const [ref, setRef] = useState("");
  const [pin, setPin] = useState<LatLng | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (!pin) return;
    setEnviando(true);
    setError("");
    try {
      const r = await api<{ direccion: { id: string }; zona: { name: string } | null }>(`/v1/ped/clientes/${cliente}/direcciones`, {
        method: "POST", body: { address_line: linea, district: distrito, reference: ref, lat: pin.lat, lng: pin.lng },
      });
      toast.ok(r.zona ? `Dirección guardada en ${r.zona.name}` : "Dirección guardada: fuera de cobertura");
      setLinea(""); setDistrito(""); setRef(""); setPin(null);
      onGuardada(r.direccion.id);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal open={abierto} onClose={onCerrar} title="Nueva dirección" description="Marca el pin en el mapa: sin pin la dirección no se guarda." size="lg"
      footer={<Button variant="primary" loading={enviando} disabled={!pin || !linea.trim() || !distrito.trim() || ref.trim().length < 10} onClick={guardar}>Guardar dirección</Button>}>
      <div className="space-y-3">
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Dirección" required><Input value={linea} onChange={(e) => setLinea(e.target.value)} placeholder="Av. Primavera 1234, dpto 301" /></Field>
        <Field label="Distrito" required><Input value={distrito} onChange={(e) => setDistrito(e.target.value)} placeholder="Santiago de Surco" /></Field>
        <Field label="Referencia" required hint="Al menos 10 caracteres."><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Frente al parque" /></Field>
        <MapPicker value={pin} onChange={setPin} height={280} />
      </div>
    </Modal>
  );
}
