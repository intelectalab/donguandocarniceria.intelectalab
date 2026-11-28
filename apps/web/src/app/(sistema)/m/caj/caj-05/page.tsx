"use client";

import { useEffect, useState } from "react";
import { Copy, MessageCircle, Search } from "lucide-react";
import { Alert, Button, Field, buttonClass, Input, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { Qr, Seccion, Vacio, useDatos } from "@/modulos/caj/comunes";

type Pedido = { id: string; number: string; status: string; delivery_date: string | null; brand_id: string; cliente: string; pendiente: string };
type Medio = { code: string; name: string; cuentas: { id: string; name: string }[] };
type Mensaje = {
  texto: string; monto: number; pedido: string | null; cliente: string; telefono: string | null; whatsapp: string | null;
  cuenta: { id: string; name: string; account_type: string; holder_name: string | null; account_number: string | null; cci: string | null; bank_name: string | null; payment_link_base: string | null; qr_payload: string | null };
};

/**
 * CAJ-05 Mensaje de pago: arma el texto para el cliente con el monto del pedido y los datos de la cuenta de la empresa.
 * El número, el QR y el enlace salen de Cuentas (CAJ-01): la vendedora no los escribe.
 */
export default function MensajePago() {
  const [q, setQ] = useState("");
  const [buscar, setBuscar] = useState("");
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [medio, setMedio] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [msg, setMsg] = useState<Mensaje | null>(null);
  const [error, setError] = useState("");
  const [armando, setArmando] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBuscar(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { datos: pedidos, cargando } = useDatos<Pedido[]>(`/v1/caj/mensaje/pedidos?q=${encodeURIComponent(buscar)}`);
  const { datos: op } = useDatos<{ medios: Medio[] }>(pedido ? `/v1/caj/mensaje/opciones?order_id=${pedido.id}` : null);
  const medios = op?.medios ?? [];
  const elegido = medios.find((m) => m.code === medio);

  function elegirPedido(p: Pedido) {
    setPedido(p);
    setMedio("");
    setCuenta("");
    setMsg(null);
    setError("");
  }

  async function armar(codigo: string, cuentaId: string) {
    if (!pedido || !codigo) return;
    setArmando(true);
    setError("");
    try {
      setMsg(await api<Mensaje>("/v1/caj/mensaje", { method: "POST", body: { order_id: pedido.id, method: codigo, cash_account_id: cuentaId || null } }));
    } catch (e) {
      setMsg(null);
      setError(mensajeDe(e));
    } finally {
      setArmando(false);
    }
  }

  async function copiar() {
    if (!msg) return;
    try {
      await navigator.clipboard.writeText(msg.texto);
      toast.ok("Mensaje copiado.");
    } catch {
      toast.error("No se pudo copiar: selecciona el texto y cópialo.");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader description="Arma el mensaje de pago para el cliente con el monto pendiente del pedido y los datos oficiales de la empresa (número de Yape o Plin, QR, enlace o cuenta). Solo se copia: no se edita." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Seccion titulo="1. Pedido">
          {pedido ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium">{pedido.number} · {pedido.cliente}</div>
                <div className="text-[12px] text-muted">Falta pagar {soles(pedido.pendiente)}{pedido.delivery_date ? ` · entrega ${fecha(pedido.delivery_date)}` : ""}</div>
              </div>
              <Button variant="ghost" onClick={() => { setPedido(null); setMsg(null); }}>Cambiar</Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número de pedido, cliente o celular…" className="pl-9" aria-label="Buscar pedido" />
              </div>
              {cargando && !pedidos ? <Vacio>Buscando…</Vacio> : !pedidos?.length ? <Vacio>No hay pedidos con saldo por pagar.</Vacio> : (
                <ul className="max-h-[420px] divide-y divide-line overflow-auto rounded-lg border border-line">
                  {pedidos.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => elegirPedido(p)} className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-2">
                        <span className="min-w-0"><span className="block text-[13.5px] font-medium">{p.number}</span><span className="block truncate text-[12px] text-muted">{p.cliente}</span></span>
                        <span className="shrink-0 text-[13.5px] tabular-nums">{soles(p.pendiente)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {pedido && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="2. ¿Cómo pagará?">
                <Select value={medio} placeholder={op ? "Elige el medio" : "Cargando…"} options={medios.map((m) => ({ value: m.code, label: m.name }))}
                  onChange={(e) => { setMedio(e.target.value); setCuenta(""); void armar(e.target.value, ""); }} />
              </Field>
              {elegido && elegido.cuentas.length > 1 && (
                <Field label="Cuenta">
                  <Select value={cuenta || msg?.cuenta.id || ""} options={elegido.cuentas.map((c) => ({ value: c.id, label: c.name }))}
                    onChange={(e) => { setCuenta(e.target.value); void armar(medio, e.target.value); }} />
                </Field>
              )}
              {op && !medios.length && <div className="sm:col-span-2"><Alert tone="warn">La marca del pedido no tiene cuentas para cobrar a distancia. Pídele a gerencia que las configure en Cuentas.</Alert></div>}
            </div>
          )}
        </Seccion>
        <Seccion titulo="3. Mensaje para el cliente">
          {error && <Alert tone="bad">{error}</Alert>}
          {!msg ? <Vacio>{armando ? "Armando el mensaje…" : "Elige el pedido y el medio de pago."}</Vacio> : (
            <div className="space-y-3">
              <Textarea readOnly rows={10} value={msg.texto} aria-label="Mensaje de pago" className="font-[inherit] text-[13.5px]" />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={Copy} onClick={copiar}>Copiar mensaje</Button>
                {msg.whatsapp ? (
                  <a href={msg.whatsapp} target="_blank" rel="noopener noreferrer"
                    className={buttonClass("secondary")}>
                    <MessageCircle size={16} aria-hidden="true" /> Abrir WhatsApp
                  </a>
                ) : <span className="self-center text-[12.5px] text-muted">El cliente no tiene celular registrado.</span>}
              </div>
              {msg.cuenta.qr_payload && (
                <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line p-3">
                  <Qr texto={msg.cuenta.qr_payload} tamano={168} />
                  <p className="min-w-0 flex-1 basis-40 text-[12.5px] text-muted">QR oficial de {msg.cuenta.name}. Haz una captura y envíala junto con el mensaje.</p>
                </div>
              )}
            </div>
          )}
        </Seccion>
      </div>
    </div>
  );
}
