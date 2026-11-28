"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, CheckCircle2 } from "lucide-react";
import { Alert, Button, Checkbox, Field, Input, PageHeader, Select, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import {
  BuscarCliente, Seccion, TablaAplicar, Vacio, aplicacionesDe, hoy, r2, useDatos,
  type Cliente, type DetalleCobro, type Pendientes,
} from "@/modulos/caj/comunes";

type Medio = { id: string; code: string; name: string; kind: string; requires_reference: boolean; cuentas: { id: string; code: string; name: string; account_type: string; establishment_id: string | null; brand_id: string | null }[] };
type Opciones = { medios: Medio[]; marcas_tarjeta: { value: string; label: string }[]; marcas: { id: string; name: string }[]; locales: { id: string; name: string }[] };

/** CAJ-02 Registrar cobro: medio, cuenta, monto, fecha y operación; foto del voucher; aplicación al pedido o comprobante. */
export default function RegistrarCobro() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const params = useSearchParams();
  const { marca: marcaSesion, local: localSesion, can } = useSesion();
  const { datos: op, error: errorOp } = useDatos<Opciones>("/v1/caj/cobros/opciones");
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const clienteParam = params.get("cliente");
  const { datos: pendientes } = useDatos<Pendientes>(cliente ? `/v1/caj/clientes/${cliente.id}/pendientes` : null);
  const [medio, setMedio] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [monto, setMonto] = useState("");
  const [ref, setRef] = useState("");
  const [tarjeta, setTarjeta] = useState({ marca: "VISA", digitos: "" });
  const [fechaCobro, setFechaCobro] = useState(hoy());
  const [marca, setMarca] = useState("");
  const [local, setLocal] = useState("");
  const [nota, setNota] = useState("");
  const [aFavor, setAFavor] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [foto, setFoto] = useState<File | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState<DetalleCobro | null>(null);
  const archivo = useRef<HTMLInputElement>(null);

  // Llega desde un pedido o un cliente (enlace «Registrar cobro»): se elige solo.
  const precargado = useRef(false);
  useEffect(() => {
    if (!clienteParam || precargado.current) return;
    precargado.current = true;
    api<Cliente[]>(`/v1/caj/clientes?id=${encodeURIComponent(clienteParam)}`).catch(() => [] as Cliente[]).then((l) => {
      if (l[0]) setCliente(l[0]);
    });
  }, [clienteParam]);

  const marcaElegida = marca || (marcaSesion !== "ALL" ? marcaSesion : op?.marcas.length === 1 ? op.marcas[0].id : "");
  const localElegido = local || (localSesion !== "ALL" ? localSesion : op?.locales.length === 1 ? op.locales[0].id : "");
  const m = op?.medios.find((x) => x.code === medio) ?? null;
  const cuentas = useMemo(() => (m?.cuentas ?? []).filter((c) => (!marcaElegida || !c.brand_id || c.brand_id === marcaElegida)
    && (!localElegido || !c.establishment_id || !["CASH_REGISTER", "PETTY_CASH"].includes(c.account_type) || c.establishment_id === localElegido)), [m, marcaElegida, localElegido]);
  // Sin elegir: la única cuenta del medio, o la que se llama como el medio (Yape → la cuenta YAPE).
  const cuentaElegida = cuentas.some((c) => c.id === cuenta) ? cuenta : cuentas.length === 1 ? cuentas[0].id : cuentas.find((c) => c.code === m?.code)?.id ?? "";
  const aplicaciones = aplicacionesDe(valores);
  const aplicado = r2(aplicaciones.reduce((s, a) => s + a.amount, 0));
  const total = r2(Number(monto) || 0);
  const sobra = r2(total - aplicado);
  const listo = cliente && m && cuentaElegida && total > 0 && (!m.requires_reference || ref.trim()) && aplicado <= total + 0.004
    && (m.kind !== "CARD" || /^\d{4}$/.test(tarjeta.digitos)) && (aplicaciones.length > 0 || (marcaElegida && localElegido));

  async function guardar() {
    if (!cliente || !m) return;
    setGuardando(true);
    setErrores({});
    const datos: Record<string, unknown> = {
      customer_id: cliente.id, method: m.code, cash_account_id: cuentaElegida, amount: total, reference: ref.trim() || null,
      paid_at: fechaCobro, brand_id: marcaElegida || null, establishment_id: localElegido || null, notes: nota.trim() || null, to_balance: aFavor && sobra > 0,
      applications: aplicaciones, ...(m.kind === "CARD" ? { card_brand: tarjeta.marca, card_last4: tarjeta.digitos } : {}),
    };
    try {
      let r: DetalleCobro;
      if (foto) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(datos)) {
          if (v === null || v === undefined) continue;
          fd.append(k, k === "applications" ? JSON.stringify(v) : typeof v === "boolean" ? (v ? "1" : "0") : String(v));
        }
        fd.append("voucher", foto);
        r = await api<DetalleCobro>("/v1/caj/cobros", { method: "POST", body: fd });
      } else {
        r = await api<DetalleCobro>("/v1/caj/cobros", { method: "POST", body: datos });
      }
      toast.ok(`Cobro ${r.number} registrado.`);
      setHecho(r);
    } catch (e) {
      setErrores(erroresDe(e));
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  function otro() {
    setHecho(null); setMonto(""); setRef(""); setValores({}); setFoto(null); setNota(""); setAFavor(false); setTarjeta({ marca: "VISA", digitos: "" });
  }

  if (!can("caj.payment.register")) return <Alert tone="info">Tu rol no registra cobros.</Alert>;
  if (hecho) {
    return (
      <div className="space-y-4">
        <PageHeader description="El cobro quedó registrado en la cuenta de la empresa." />
        <Seccion>
          <div className="flex items-start gap-3">
            <CheckCircle2 size={28} className="shrink-0 text-ok" aria-hidden="true" />
            <div className="min-w-0 space-y-1 text-[13.5px]">
              <p className="text-[15px] font-semibold">{hecho.number} · {soles(hecho.amount)} por {hecho.medio_nombre}</p>
              <p className="text-muted">{hecho.cliente} · {hecho.cuenta}{hecho.reference ? ` · op. ${hecho.reference}` : ""}</p>
              <p>Aplicado {soles(hecho.aplicado)}{hecho.to_balance ? ` · ${soles(hecho.to_balance)} a favor del cliente` : ""}{hecho.sin_aplicar > 0 ? ` · ${soles(hecho.sin_aplicar)} sin aplicar` : ""}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={otro}>Registrar otro cobro</Button>
            <Button onClick={() => router.push(`/m/caj/caj-03?id=${hecho.id}`)}>Ver el cobro</Button>
            {hecho.sin_aplicar > 0 && <Button onClick={() => router.push(`/m/caj/caj-04?id=${hecho.id}`)}>Aplicar lo que queda</Button>}
          </div>
        </Seccion>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader description="El cobro va siempre a una cuenta de la empresa. Con Yape, Plin, transferencia, tarjeta o pasarela el número de operación es obligatorio y no se puede repetir." />
      {errorOp && <Alert tone="bad">{errorOp}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Seccion titulo="1. Quién paga y cómo">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cliente" required className="sm:col-span-2" error={errores.customer_id}>
              <BuscarCliente valor={cliente} onElegir={(c) => { setCliente(c); setValores({}); }} autoFocus />
            </Field>
            <Field label="Medio" required error={errores.method}>
              <Select value={medio} placeholder="Elige el medio" onChange={(e) => { setMedio(e.target.value); setCuenta(""); }}
                options={(op?.medios ?? []).map((x) => ({ value: x.code, label: x.name }))} />
            </Field>
            <Field label="Cuenta de la empresa" required error={errores.cash_account_id} hint={m && !cuentas.length ? "No hay una cuenta activa para este medio." : undefined}>
              <Select value={cuentaElegida} placeholder={m ? "Elige la cuenta" : "Primero el medio"} disabled={!m} onChange={(e) => setCuenta(e.target.value)}
                options={cuentas.map((c) => ({ value: c.id, label: c.name }))} />
            </Field>
            <Field label="Monto (S/)" required error={errores.amount}>
              <Input type="number" inputMode="decimal" min={0} step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" className="tabular-nums" />
            </Field>
            <Field label="Fecha del cobro" error={errores.paid_at}>
              <Input type="date" value={fechaCobro} max={hoy()} onChange={(e) => setFechaCobro(e.target.value)} />
            </Field>
            {m && (m.requires_reference || m.kind === "CARD") && (
              <Field label="Número de operación" required={m.requires_reference} error={errores.reference} className="sm:col-span-2" hint="El de la captura, del voucher o del estado de cuenta.">
                <Input value={ref} maxLength={40} onChange={(e) => setRef(e.target.value)} placeholder="81234567" />
              </Field>
            )}
            {m?.kind === "CARD" && (<>
              <Field label="Marca de la tarjeta" required error={errores.card_brand}>
                <Select value={tarjeta.marca} onChange={(e) => setTarjeta({ ...tarjeta, marca: e.target.value })} options={op?.marcas_tarjeta ?? []} />
              </Field>
              <Field label="4 últimos dígitos" required error={errores.card_last4}>
                <Input inputMode="numeric" maxLength={4} value={tarjeta.digitos} onChange={(e) => setTarjeta({ ...tarjeta, digitos: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="4521" />
              </Field>
            </>)}
            {!aplicaciones.length && (<>
              <Field label="Marca" required error={errores.brand_id}>
                <Select value={marcaElegida} placeholder="Elige la marca" onChange={(e) => setMarca(e.target.value)} options={(op?.marcas ?? []).map((x) => ({ value: x.id, label: x.name }))} />
              </Field>
              <Field label="Local" required error={errores.establishment_id}>
                <Select value={localElegido} placeholder="Elige el local" onChange={(e) => setLocal(e.target.value)} options={(op?.locales ?? []).map((x) => ({ value: x.id, label: x.name }))} />
              </Field>
            </>)}
            <Field label="Foto del voucher o captura" className="sm:col-span-2" error={errores.voucher}>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={archivo} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="sr-only"
                  onChange={(e) => setFoto(e.target.files?.[0] ?? null)} aria-label="Foto del voucher" />
                <Button icon={Camera} onClick={() => archivo.current?.click()}>{foto ? "Cambiar foto" : "Tomar o subir foto"}</Button>
                {foto && <span className="truncate text-[12.5px] text-muted">{foto.name}</span>}
              </div>
            </Field>
            <Field label="Nota" className="sm:col-span-2"><Input value={nota} maxLength={255} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" /></Field>
          </div>
        </Seccion>
        <Seccion titulo="2. A qué pedido o comprobante se aplica">
          {!cliente ? <Vacio>Elige el cliente para ver lo que tiene por pagar.</Vacio> : !pendientes ? <Vacio>Cargando…</Vacio> : (
            <div className="space-y-3">
              <TablaAplicar pendientes={pendientes} disponible={total} valores={valores} onChange={setValores} />
              {pendientes.saldo_a_favor > 0 && <p className="text-[12.5px] text-muted">El cliente tiene {soles(pendientes.saldo_a_favor)} de saldo a favor (se usa en Saldos a favor).</p>}
              {total > 0 && sobra > 0.004 && (
                <Checkbox checked={aFavor} onChange={setAFavor} label={`Dejar ${soles(sobra)} como saldo a favor del cliente`}
                  hint="Si no, queda sin aplicar y se aplica después en «Aplicar cobro»." />
              )}
            </div>
          )}
        </Seccion>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {total > 0 && <span className="text-[13px] text-muted">Cobro {soles(total)} · aplicado {soles(aplicado)}</span>}
        <Button variant="primary" loading={guardando} disabled={!listo} onClick={guardar}>Registrar cobro</Button>
      </div>
    </div>
  );
}
