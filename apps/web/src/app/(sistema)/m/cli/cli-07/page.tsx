"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, Link2, MessageCircle, XCircle } from "lucide-react";
import { Alert, Button, DataTable, PageHeader, Select, StatusBadge, Tabs, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { BuscarCliente } from "@/modulos/cli/BuscarCliente";
import { ESTADOS_ENLACE, celular, type Enlace } from "@/modulos/cli/tipos";

type Creado = { para: string; url: string; horas: number; expires_at: string; phone: string | null };
type Vista = "" | "PENDING" | "USED" | "EXPIRED" | "CANCELLED";

/**
 * CLI-07 Enlace de ubicación: un enlace de un solo uso que la vendedora manda por WhatsApp; el
 * cliente lo abre sin cuenta, marca su pin y la dirección queda guardada (RN-CLI-05). ?cliente=.
 */
export default function EnlaceDeUbicacion() {
  return <Suspense><Pantalla /></Suspense>;
}

// Lee ?id= y los demás datos de la dirección en el navegador: la página se compila sin ellos.
function Pantalla() {
  const params = Object.fromEntries(useSearchParams());
  const clienteId = typeof params.cliente === "string" ? params.cliente : "";
  const router = useRouter();
  const { can } = useSesion();
  const [cliente, setCliente] = useState<{ id: string; nombre: string; phone: string | null; merged_into_id: string | null } | null>(null);
  const [creado, setCreado] = useState<Creado | null>(null);
  const [creando, setCreando] = useState(false);
  const [vista, setVista] = useState<Vista>("");
  const [soloCliente, setSoloCliente] = useState("1");
  const lista = useListado<Enlace>("/v1/cli/enlaces", { filtros: { estado: vista, customer_id: clienteId && soloCliente ? clienteId : "" } });

  useEffect(() => {
    if (!clienteId) return;
    let vigente = true;
    api<{ cliente: { id: string; nombre: string; phone: string | null; merged_into_id: string | null } }>(`/v1/cli/clientes/${clienteId}/direcciones`)
      .then((r) => vigente && setCliente(r.cliente)).catch((e) => toast.error(mensajeDe(e)));
    return () => { vigente = false; };
  }, [clienteId]);

  const c = cliente?.id === clienteId ? cliente : null;
  const nuevo = creado?.para === clienteId ? creado : null;

  async function crear() {
    if (!c) return;
    setCreando(true);
    try {
      const r = await api<{ token: string; horas: number; expires_at: string; phone: string | null }>(`/v1/cli/clientes/${c.id}/enlace`, { method: "POST" });
      setCreado({ para: c.id, url: `${window.location.origin}/u/${r.token}`, horas: r.horas, expires_at: r.expires_at, phone: r.phone });
      lista.recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setCreando(false);
    }
  }

  const mensaje = nuevo && c ? `Hola ${c.nombre.split(" ")[0]}, para llevarte tu pedido marca tu ubicación aquí (vale ${nuevo.horas} horas): ${nuevo.url}` : "";

  async function copiar() {
    try {
      await navigator.clipboard.writeText(mensaje);
      toast.ok("Mensaje copiado: pégalo en el chat del cliente.");
    } catch {
      toast.error("No se pudo copiar: selecciona el enlace y cópialo a mano.");
    }
  }

  async function anular(e: Enlace) {
    if (!(await confirmAction({ title: "¿Anular el enlace?", message: `El cliente ${e.cliente} ya no podrá usarlo.`, confirmLabel: "Anular", danger: true }))) return;
    try {
      await api(`/v1/cli/enlaces/${e.id}/anular`, { method: "POST" });
      toast.ok("Enlace anulado");
      lista.recargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    }
  }

  const columnas: Column<Enlace>[] = [
    { key: "cliente", header: "Cliente", sortable: true, cardTitle: true, render: (e) => <Link href={`/m/cli/cli-02?id=${e.customer_id}`} onClick={(x) => x.stopPropagation()} className="font-medium hover:text-primary">{e.cliente}</Link> },
    { key: "phone", header: "Celular", render: (e) => <span className="font-mono whitespace-nowrap">{celular(e.phone)}</span> },
    { key: "created_at", header: "Creado", sortable: true, render: (e) => <div><div>{fechaHora(e.created_at)}</div><div className="text-[12px] text-muted">{e.created_by ?? ""}</div></div> },
    { key: "expires_at", header: "Vence", sortable: true, hideOnMobile: true, render: (e) => fechaHora(e.expires_at) },
    { key: "estado", header: "Estado", render: (e) => <StatusBadge status={e.estado} labels={ESTADOS_ENLACE} /> },
    { key: "resultado", header: "Dirección marcada", hideOnMobile: true, render: (e) => e.resultado ? <div><div>{e.resultado}</div><div className="text-[12px] text-muted">{fechaHora(e.used_at)}</div></div> : <span className="text-muted">—</span> },
    {
      key: "acciones", header: "", align: "right",
      render: (e) => e.estado === "PENDING" && can("cli.customer.manage") ? <Button size="sm" variant="ghost" icon={XCircle} onClick={(x) => { x.stopPropagation(); anular(e); }}>Anular</Button> : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Envía al cliente un enlace para que marque su ubicación desde el celular, sin crear cuenta. Sirve una sola vez y vence en 24 horas."
        actions={<BuscarCliente onElegir={(x) => router.push(`/m/cli/cli-07?cliente=${x}`)} placeholder="Cliente al que se lo envías…" />} />

      {clienteId && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          {!c ? <p className="text-[13px] text-muted">Cargando…</p> : <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Link href={`/m/cli/cli-02?id=${c.id}`} className="text-[15px] font-semibold hover:text-primary">{c.nombre}</Link>
                <span className="ml-2 font-mono text-[12.5px] text-muted">{celular(c.phone)}</span>
              </div>
              <Button variant="primary" icon={Link2} loading={creando} disabled={!can("cli.customer.manage") || Boolean(c.merged_into_id)} onClick={crear}>
                {nuevo ? "Generar otro" : "Generar enlace"}
              </Button>
            </div>
            {c.merged_into_id && <Alert tone="info">Este cliente fue fusionado: envía el enlace al sobreviviente.</Alert>}
            {nuevo && (
              <div className="space-y-3 rounded-[9px] border border-ok/30 bg-ok-soft p-3.5">
                <p className="text-[13px]">Enlace listo. Vence el <span className="font-medium">{fechaHora(nuevo.expires_at)}</span>. Si generas otro, este se anula.</p>
                <p className="rounded-[7px] border border-line bg-surface px-3 py-2 font-mono text-[12.5px] break-all select-all">{nuevo.url}</p>
                <div className="flex flex-wrap gap-2">
                  {nuevo.phone && (
                    <a href={`https://wa.me/${nuevo.phone.replace(/\D/g, "")}?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-primary px-3.5 text-[13.5px] font-semibold text-primary-ink hover:opacity-90">
                      <MessageCircle size={16} aria-hidden="true" /> Enviar por WhatsApp
                    </a>
                  )}
                  <Button icon={Copy} onClick={copiar}>Copiar mensaje</Button>
                </div>
                <p className="text-[12px] text-muted">El enlace se muestra solo ahora: no se puede volver a ver, solo generar otro.</p>
              </div>
            )}
          </>}
        </section>
      )}

      <Tabs value={vista} onChange={setVista} tabs={[
        { key: "", label: "Todos" }, { key: "PENDING", label: "Pendientes" }, { key: "USED", label: "Usados" }, { key: "EXPIRED", label: "Vencidos" }, { key: "CANCELLED", label: "Anulados" },
      ]} />
      <DataTable {...lista.tabla} columns={columnas} search={{ ...lista.tabla.search, placeholder: "Cliente o celular…" }}
        onRowClick={(e) => router.push(`/m/cli/cli-07?cliente=${e.customer_id}`)} empty="No hay enlaces con ese filtro."
        toolbar={clienteId ? (
          <div className="w-full sm:w-[200px]">
            <Select aria-label="De quién" value={soloCliente} onChange={(e) => setSoloCliente(e.target.value)} className="!min-h-9 h-9 py-1.5 text-[13px]"
              options={[{ value: "1", label: "Solo de este cliente" }, { value: "", label: "De todos los clientes" }]} />
          </div>
        ) : undefined} />
    </div>
  );
}
