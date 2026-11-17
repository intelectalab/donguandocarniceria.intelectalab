"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FileCheck, Search } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DetailList, Field, Input, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { BuscarCliente } from "@/modulos/cli/BuscarCliente";
import { DOCUMENTOS, celular, type FichaCliente } from "@/modulos/cli/tipos";

type Respuesta = { ok: boolean; error?: string; source?: string; state?: string; condition?: string | null; name?: string; fiscal_address?: string | null; consultado?: string };
type Pendientes = {
  sin_validar: { id: string; full_name: string; trade_name: string | null; doc_type: string; doc_number: string }[]; total_sin_validar: number;
  bitacora: { id: string; at: string; customer_id: string | null; cliente: string | null; doc?: string; source?: string | null; state?: string | null; note?: string | null; user?: string }[];
};

/** CLI-04 Validar documento: consulta el DNI (RENIEC) o RUC (SUNAT), muestra la respuesta y la guarda con fuente y fecha (RN-CLI-12). ?id= el cliente. */
export default function ValidarDocumento() {
  return <Suspense><Pantalla /></Suspense>;
}

// Lee ?id= y los demás datos de la dirección en el navegador: la página se compila sin ellos.
function Pantalla() {
  const params = Object.fromEntries(useSearchParams());
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { can } = useSesion();
  const [cliente, setCliente] = useState<FichaCliente | null>(null);
  const [pend, setPend] = useState<Pendientes | null>(null);
  const [version, setVersion] = useState(0);
  const [doc, setDoc] = useState<{ para: string; tipo: string; numero: string }>({ para: "", tipo: "DNI", numero: "" });
  const [resp, setResp] = useState<Respuesta | null>(null);
  const [manual, setManual] = useState(false);
  const [nota, setNota] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<"" | "consultar" | "guardar">("");

  useEffect(() => {
    let vigente = true;
    api<Pendientes>("/v1/cli/documentos/pendientes").then((r) => vigente && setPend(r)).catch(() => {});
    if (id) api<FichaCliente>(`/v1/cli/clientes/${id}`).then((c) => vigente && setCliente(c)).catch((e) => toast.error(mensajeDe(e)));
    return () => { vigente = false; };
  }, [id, version]);

  const c = cliente?.id === id ? cliente : null;
  // El formulario arranca con el documento que ya tiene el cliente.
  const d = doc.para === id ? doc : { para: id, tipo: c && c.doc_type !== "NONE" ? c.doc_type : "DNI", numero: c?.doc_number ?? "" };
  const cambiar = (k: "tipo" | "numero", x: string) => { setDoc({ ...d, [k]: x }); setResp(null); };

  async function consultar() {
    setOcupado("consultar"); setErrores({});
    try {
      setResp(await api<Respuesta>("/v1/cli/documentos/consultar", { method: "POST", body: { doc_type: d.tipo, doc_number: d.numero } }));
    } catch (e) {
      setErrores(erroresDe(e));
      if (!Object.keys(erroresDe(e)).length) toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  async function guardar() {
    if (!c) return;
    setOcupado("guardar"); setErrores({});
    try {
      await api(`/v1/cli/clientes/${c.id}/documento`, { method: "POST", body: { doc_type: d.tipo, doc_number: d.numero, manual, nota: manual ? nota : null } });
      toast.ok(manual ? "Documento validado a mano" : "Documento validado y guardado");
      setResp(null); setManual(false); setNota("");
      setVersion((n) => n + 1);
    } catch (e) {
      const porCampo = erroresDe(e);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  const tipos = DOCUMENTOS.filter((o) => o.value !== "NONE");
  const puedeConsultar = d.tipo === "DNI" || d.tipo === "RUC";

  return (
    <div className="space-y-5">
      <PageHeader description="Consulta el DNI en RENIEC o el RUC en SUNAT y guarda la respuesta con su fuente y fecha. Los datos se usan solo para facturar (Ley 29733)."
        actions={<BuscarCliente onElegir={(x) => router.push(`/m/cli/cli-04?id=${x}`)} placeholder="Cliente: celular, nombre o documento…" />} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="space-y-4 self-start rounded-xl border border-line bg-surface p-4 shadow-card">
          {!id ? <p className="text-[13px] text-muted">Elige un cliente con el buscador, o uno de la lista de documentos sin validar.</p> : !c ? <p className="text-[13px] text-muted">Cargando…</p> : <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Link href={`/m/cli/cli-02?id=${c.id}`} className="text-[15px] font-semibold hover:text-primary">{c.nombre}</Link>
                <p className="text-[12.5px] text-muted">{celular(c.phone)}</p>
              </div>
              {c.doc_validated_at
                ? <Badge tone="ok">Validado en {c.doc_validation_source} · {fechaHora(c.doc_validated_at)}</Badge>
                : <Badge tone="warn">Documento sin validar</Badge>}
            </div>

            <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-end">
              <Field label="Documento" error={errores.doc_type}><Select value={d.tipo} onChange={(e) => cambiar("tipo", e.target.value)} options={tipos} /></Field>
              <Field label="Número" error={errores.doc_number}><Input inputMode="numeric" value={d.numero} onChange={(e) => cambiar("numero", e.target.value)} placeholder={d.tipo === "RUC" ? "11 dígitos" : d.tipo === "DNI" ? "8 dígitos" : ""} /></Field>
              <Button icon={Search} loading={ocupado === "consultar"} disabled={!puedeConsultar || !d.numero.trim()} onClick={consultar}>Consultar</Button>
            </div>
            {!puedeConsultar && <Alert tone="info">El proveedor solo consulta DNI y RUC. El carné de extranjería y el pasaporte se validan a mano viendo el documento.</Alert>}

            {resp && (resp.ok ? (
              <div className="rounded-[9px] border border-line bg-surface-2 p-3.5">
                <p className="mb-2 text-[12.5px] font-medium text-muted">Respuesta de {resp.source} · {fechaHora(resp.consultado)}</p>
                <DetailList items={[
                  { label: resp.source === "SUNAT" ? "Razón social" : "Nombre", value: resp.name },
                  { label: "Estado", value: resp.state },
                  ...(resp.condition ? [{ label: "Condición", value: resp.condition === "HABIDO" ? <Badge tone="ok">HABIDO</Badge> : <Badge tone="bad">{resp.condition}</Badge> }] : []),
                  ...(resp.fiscal_address ? [{ label: "Dirección fiscal", value: resp.fiscal_address }] : []),
                ]} />
                {resp.condition && resp.condition !== "HABIDO" && <div className="mt-3"><Alert tone="warn">Contribuyente {resp.condition}: SUNAT puede observar las facturas. Consúltalo con contabilidad.</Alert></div>}
                {resp.name && c.full_name.trim().toUpperCase() !== resp.name.trim().toUpperCase() && (
                  <p className="mt-2 text-[12.5px] text-muted">El nombre del cliente es «{c.full_name}». Al guardar se reemplaza por el de {resp.source}.</p>
                )}
              </div>
            ) : <Alert tone="bad" title="No se pudo validar">{resp.error}</Alert>)}

            {can("cli.customer.validate_manual") && (
              <div className="space-y-3">
                <Checkbox checked={manual} onChange={setManual} label="Validar a mano (sin proveedor)" hint="Viste el documento físico o el proveedor no responde. Queda tu nombre y la nota." />
                {manual && <Field label="Nota" required error={errores.nota}><Textarea value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Qué viste y por qué se valida a mano" /></Field>}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button onClick={() => router.push(`/m/cli/cli-02?id=${c.id}`)}>Volver a la ficha</Button>
              <Button variant="primary" icon={FileCheck} loading={ocupado === "guardar"}
                disabled={!can("cli.customer.manage") || Boolean(c.merged_into_id) || (manual ? nota.trim().length < 5 : !resp?.ok)} onClick={guardar}>
                Guardar validación
              </Button>
            </div>
          </>}
        </section>

        <div className="space-y-4">
          <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="mb-1 text-[14px] font-semibold">Documentos sin validar</h2>
            <p className="mb-3 text-[12.5px] text-muted">{pend ? `${numero(pend.total_sin_validar)} cliente(s) con documento escrito y sin validar.` : "…"}</p>
            <ul className="divide-y divide-line">
              {pend?.sin_validar.map((x) => (
                <li key={x.id}>
                  <Link href={`/m/cli/cli-04?id=${x.id}`} className="flex items-center justify-between gap-3 py-2 hover:text-primary">
                    <span className="min-w-0 truncate text-[13.5px]">{x.trade_name || x.full_name}</span>
                    <span className="shrink-0 font-mono text-[12px] text-muted">{x.doc_type} {x.doc_number}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="mb-3 text-[14px] font-semibold">Últimas consultas</h2>
            {pend && pend.bitacora.length === 0 && <p className="text-[13px] text-muted">Todavía no hay consultas guardadas.</p>}
            <ul className="divide-y divide-line">
              {pend?.bitacora.map((b) => (
                <li key={b.id} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{b.cliente ?? "—"}</span>
                    <span className="font-mono text-[12px] text-muted">{b.doc}{b.user ? ` · ${b.user}` : ""}</span>
                  </span>
                  <span className="shrink-0 text-right text-[12px] text-muted">
                    {b.note ? <Badge>Manual</Badge> : <Badge tone="ok">{b.source ?? "OK"}</Badge>}<br />{fechaHora(b.at)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
