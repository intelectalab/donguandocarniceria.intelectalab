"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Link2, MapPin, MapPinOff, Navigation, Plus } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, PageHeader, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { BuscarCliente } from "@/modulos/cli/BuscarCliente";
import { TablaDirecciones } from "@/modulos/cli/TablaDirecciones";
import { ORIGEN_PIN, celular, type Direccion } from "@/modulos/cli/tipos";

type PorRevisar = { id: string; customer_id: string; cliente: string; address_line: string; district: string | null; pin_source: string | null; geocode_confidence: number | null; zone_name: string | null; confirmado: boolean };
type Revision = {
  mes: string; pins_confirmados: { valor: number; numerador: number; denominador: number }; por_confirmar: number; fuera_de_cobertura: number;
  confianza_minima: number; lista: PorRevisar[];
};
type DeCliente = { cliente: { id: string; nombre: string; phone: string | null; merged_into_id: string | null; status: string }; direcciones: Direccion[] };

/** CLI-05 Direcciones: las del cliente (?cliente=) con zona, predeterminada y último uso, y las de toda la base que falta confirmar. */
export default function Direcciones() {
  return <Suspense><Pantalla /></Suspense>;
}

// Lee ?id= y los demás datos de la dirección en el navegador: la página se compila sin ellos.
function Pantalla() {
  const params = Object.fromEntries(useSearchParams());
  const clienteId = typeof params.cliente === "string" ? params.cliente : "";
  const router = useRouter();
  const { can } = useSesion();
  const [rev, setRev] = useState<Revision | null>(null);
  const [mes, setMes] = useState("");
  const [dc, setDc] = useState<{ id: string; d: DeCliente } | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vigente = true;
    api<Revision>(`/v1/cli/direcciones/revisar${mes ? `?mes=${mes}` : ""}`).then((r) => vigente && setRev(r)).catch(() => {});
    return () => { vigente = false; };
  }, [mes, version]);

  useEffect(() => {
    if (!clienteId) return;
    let vigente = true;
    api<DeCliente>(`/v1/cli/clientes/${clienteId}/direcciones`)
      .then((d) => { if (vigente) { setDc({ id: clienteId, d }); setError(""); } })
      .catch((e) => vigente && setError(mensajeDe(e)));
    return () => { vigente = false; };
  }, [clienteId, version]);

  const d = dc?.id === clienteId ? dc.d : null;
  const puedeEditar = can("cli.customer.manage") && !d?.cliente.merged_into_id;

  const columnas: Column<PorRevisar>[] = [
    { key: "cliente", header: "Cliente", cardTitle: true, render: (a) => <Link href={`/m/cli/cli-05?cliente=${a.customer_id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-primary">{a.cliente}</Link> },
    { key: "address_line", header: "Dirección", render: (a) => <div><div>{a.address_line}</div><div className="text-[12px] text-muted">{a.district}</div></div> },
    {
      key: "pin", header: "Pin",
      render: (a) => a.confirmado ? <Badge tone="ok">{ORIGEN_PIN[a.pin_source ?? ""] ?? a.pin_source}</Badge>
        : <Badge tone="warn">{ORIGEN_PIN[a.pin_source ?? ""] ?? "Sin pin"}{a.geocode_confidence != null && a.pin_source === "GEOCODE" ? ` · ${numero(a.geocode_confidence, 2)}` : ""}</Badge>,
    },
    { key: "zona", header: "Zona", render: (a) => a.zone_name ?? <Badge tone="bad">Fuera de cobertura</Badge> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Cada dirección con su pin, zona de reparto, quién recibe y la última vez que se usó. El primer delivery exige pin y referencia (RN-CLI-02)."
        actions={<BuscarCliente onElegir={(x) => router.push(`/m/cli/cli-05?cliente=${x}`)} placeholder="Ver las direcciones de un cliente…" />} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Cifra titulo="Pedidos con pin confirmado" icono={Navigation} destacada valor={rev ? porcentaje(rev.pins_confirmados.valor, 1) : undefined}
          detalle={rev ? `${rev.pins_confirmados.numerador} de ${rev.pins_confirmados.denominador} direcciones usadas en ${rev.mes}` : ""} />
        <Cifra titulo="Pins por confirmar" icono={MapPin} valor={rev ? numero(rev.por_confirmar) : undefined} tono={rev?.por_confirmar ? "warn" : "ok"}
          detalle={rev ? `Búsqueda por texto o importados (mínimo ${numero(rev.confianza_minima, 2)})` : ""} />
        <div className="col-span-2 lg:col-span-1 [&>div]:h-full">
          <Cifra titulo="Fuera de cobertura" icono={MapPinOff} valor={rev ? numero(rev.fuera_de_cobertura) : undefined} tono={rev?.fuera_de_cobertura ? "bad" : "ok"} detalle="Ninguna zona las cubre" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <span>Mes de la cifra</span>
        <input type="month" aria-label="Mes de la cifra" value={mes || rev?.mes || ""} onChange={(e) => setMes(e.target.value)}
          className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink" />
      </div>

      {clienteId && (error ? <Alert tone="bad" title="No se pudo abrir el cliente">{error}</Alert> : !d ? <p className="text-[13px] text-muted">Cargando…</p> : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Link href={`/m/cli/cli-02?id=${d.cliente.id}`} className="text-[15px] font-semibold hover:text-primary">{d.cliente.nombre}</Link>
              <span className="ml-2 font-mono text-[12.5px] text-muted">{celular(d.cliente.phone)}</span>
            </div>
            {puedeEditar && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={Link2} onClick={() => router.push(`/m/cli/cli-07?cliente=${d.cliente.id}`)}>Enviar enlace</Button>
                <Button size="sm" variant="primary" icon={Plus} onClick={() => router.push(`/m/cli/cli-06?cliente=${d.cliente.id}`)}>Nueva dirección</Button>
              </div>
            )}
          </div>
          {d.cliente.merged_into_id && <Alert tone="info">Este cliente fue fusionado: sus direcciones pasaron al sobreviviente.</Alert>}
          <TablaDirecciones direcciones={d.direcciones} puedeEditar={puedeEditar} onCambio={() => setVersion((n) => n + 1)} />
        </section>
      ))}

      <section className="space-y-3">
        <h2 className="text-[14px] font-semibold">Por revisar en toda la base</h2>
        <DataTable rows={rev?.lista ?? []} columns={columnas} loading={!rev} rowKey={(a) => a.id}
          onRowClick={(a) => router.push(`/m/cli/cli-06?cliente=${a.customer_id}&direccion=${a.id}`)}
          empty="Todas las direcciones tienen pin confirmado y zona." />
      </section>
    </div>
  );
}
