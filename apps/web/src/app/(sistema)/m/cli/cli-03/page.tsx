"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, UserPlus } from "lucide-react";
import { Alert, Button, Checkbox, Field, Input, PageHeader, Select, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { CANALES, TIPOS_CLIENTE, celular } from "@/modulos/cli/tipos";

type Chequeo = { normalizado: string | null; valido: boolean; existente: { id: string; nombre: string; phone: string; status: string } | null };
type Reciente = { id: string; full_name: string; trade_name: string | null; phone: string | null; created_at: string };

/**
 * CLI-03 Alta rápida: lo mínimo para tomar un pedido (celular, nombre, tipo y canal). Mientras se
 * escribe el celular avisa si ya es de un cliente (CA-CLI-01) y lo abre en vez de crear otro.
 */
export default function AltaRapida() {
  const router = useRouter();
  const { can } = useSesion();
  const [v, setV] = useState({ phone: "", full_name: "", customer_type: "PERSON", source_channel: "WHATSAPP", origin_wa_number: "", marketing_opt_in: false });
  const [chequeo, setChequeo] = useState<{ q: string; r: Chequeo } | null>(null);
  const [recientes, setRecientes] = useState<Reciente[]>([]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const tel = v.phone.trim();

  useEffect(() => {
    let vigente = true;
    api<Reciente[]>("/v1/cli/clientes/recientes").then((r) => vigente && setRecientes(r)).catch(() => {});
    return () => { vigente = false; };
  }, []);

  useEffect(() => {
    if (tel.replace(/\D/g, "").length < 9) return;
    let vigente = true;
    const t = setTimeout(() => {
      api<Chequeo>(`/v1/cli/clientes/celular?phone=${encodeURIComponent(tel)}`).then((r) => vigente && setChequeo({ q: tel, r })).catch(() => {});
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [tel]);

  const ch = chequeo?.q === tel && tel.replace(/\D/g, "").length >= 9 ? chequeo.r : null;
  const set = (k: keyof typeof v) => (valor: string | boolean) => setV((x) => ({ ...x, [k]: valor }));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true); setErrores({}); setError("");
    try {
      const r = await api<{ customer: { id: string }; existente: boolean; duplicados: number }>("/v1/cli/clientes/rapida", {
        method: "POST", body: { ...v, origin_wa_number: v.origin_wa_number || null },
      });
      if (r.existente) toast.info("Ese celular ya era de un cliente: se abrió su ficha.");
      else toast.ok(r.duplicados ? "Cliente creado. Se marcó como posible duplicado para revisarlo." : "Cliente creado");
      router.push(`/m/cli/cli-02?id=${r.customer.id}`);
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader description="Lo mínimo para tomar el pedido: celular, nombre, tipo y canal. El documento y la dirección se completan después." />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <form onSubmit={guardar} noValidate className="grid gap-4 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><Alert tone="bad">{error}</Alert></div>}
          <Field label="Celular" required error={errores.phone} hint={ch?.valido ? `Se guarda como ${celular(ch.normalizado)}` : "Como lo escriba: 987654321, +51 987 654 321…"} className="sm:col-span-2">
            <Input inputMode="tel" autoFocus value={v.phone} onChange={(e) => set("phone")(e.target.value)} placeholder="987 654 321" />
          </Field>
          {ch && !ch.valido && <div className="sm:col-span-2"><Alert tone="warn">Ese número no es un celular peruano válido (RN-CLI-01): 9 dígitos que empiezan con 9.</Alert></div>}
          {ch?.existente && (
            <div className="sm:col-span-2">
              <Alert tone="info" title="Ese celular ya es de un cliente">
                <span className="font-medium">{ch.existente.nombre}</span> · {celular(ch.existente.phone)}{ch.existente.status === "BLOCKED" && " · bloqueado"}.{" "}
                <Link href={`/m/cli/cli-02?id=${ch.existente.id}`} className="font-medium text-primary underline">Abrir su ficha</Link>
              </Alert>
            </div>
          )}
          <Field label="Nombre o razón social" required error={errores.full_name} className="sm:col-span-2">
            <Input value={v.full_name} onChange={(e) => set("full_name")(e.target.value)} />
          </Field>
          <Field label="Tipo" required error={errores.customer_type}><Select value={v.customer_type} onChange={(e) => set("customer_type")(e.target.value)} options={TIPOS_CLIENTE} /></Field>
          <Field label="Canal por donde llegó" required error={errores.source_channel}>
            <Select value={v.source_channel} onChange={(e) => set("source_channel")(e.target.value)} options={CANALES.filter((c) => c.value !== "IMPORT")} />
          </Field>
          {v.source_channel === "WHATSAPP" && (
            <Field label="Número de WhatsApp de la empresa que lo atendió" error={errores.origin_wa_number} className="sm:col-span-2">
              <Input inputMode="tel" value={v.origin_wa_number} onChange={(e) => set("origin_wa_number")(e.target.value)} placeholder="Opcional" />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Checkbox checked={v.marketing_opt_in} onChange={set("marketing_opt_in")} label="Acepta recibir promociones"
              hint="Solo si el cliente lo dijo. Queda la constancia con fecha y usuario (Ley 29733)." />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button onClick={() => router.push("/m/cli/cli-01")}>Cancelar</Button>
            {ch?.existente
              ? <Button variant="primary" icon={CheckCircle2} onClick={() => router.push(`/m/cli/cli-02?id=${ch.existente!.id}`)}>Usar este cliente</Button>
              : <Button type="submit" variant="primary" icon={UserPlus} loading={guardando} disabled={!can("cli.customer.manage")}>Crear cliente</Button>}
          </div>
        </form>

        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-[14px] font-semibold">Altas de los últimos 7 días</h2>
          {recientes.length === 0 ? <p className="text-[13px] text-muted">Todavía no hay altas esta semana.</p> : (
            <ul className="divide-y divide-line">
              {recientes.map((c) => (
                <li key={c.id}>
                  <Link href={`/m/cli/cli-02?id=${c.id}`} className="flex items-center justify-between gap-3 py-2 hover:text-primary">
                    <span className="min-w-0 truncate text-[13.5px] font-medium">{c.trade_name || c.full_name}</span>
                    <span className="shrink-0 text-right text-[12px] text-muted"><span className="font-mono">{celular(c.phone)}</span><br />{fechaHora(c.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
