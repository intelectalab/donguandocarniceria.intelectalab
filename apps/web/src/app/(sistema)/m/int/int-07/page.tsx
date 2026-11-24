"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, Hand, RotateCcw, Skull } from "lucide-react";
import { Alert, Button, Cifra, DataTable, PageHeader, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { EstadoSaliente, FichaSaliente, accionCola, type Saliente } from "@/modulos/int/salientes";

type Lista = Pagina<Saliente> & { cifras: { muertos: number; atendidos: number }; max_intentos: number };

/**
 * INT-07 Cola muerta: los mensajes que agotaron sus intentos. Solo se reintentan o cancelan a mano, con un motivo de
 * al menos 10 caracteres, y quedan aquí como atendidos.
 */
function ColaMuerta() {
  const router = useRouter();
  const abierto = useSearchParams().get("mensaje");
  const { can, puede } = useSesion();
  const gestiona = Boolean(can("int.outbox.retry")) && puede("INT", "E");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const pag = usePagina();

  const cargar = useCallback(() => {
    api<Lista>(`/v1/int/salientes?muertos=1&${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [pag.qs]);
  useEffect(() => cargar(), [cargar]);

  const ver = (id: string | null) => router.replace(id ? `/m/int/int-07?mensaje=${id}` : "/m/int/int-07", { scroll: false });
  async function accion(m: Saliente, a: "reintentar" | "cancelar") {
    if (await accionCola(m, a)) cargar();
  }

  const columnas: Column<Saliente>[] = [
    { key: "number", sortable: true, header: "N.º", cardTitle: true, render: (m) => <span className="font-mono font-semibold whitespace-nowrap text-ink">{m.number}</span> },
    { key: "dead_at", sortable: true, header: "Cayó", render: (m) => (m.dead_at ? <span className="whitespace-nowrap">{fechaHora(m.dead_at)}</span> : <span className="text-muted">—</span>) },
    { key: "connector", sortable: true, header: "Conector", render: (m) => m.connector_name },
    { key: "event", sortable: true, header: "Evento", render: (m) => (m.event ? <span className="font-mono text-[12.5px]">{m.event}</span> : <span className="text-muted">—</span>) },
    { key: "ref", sortable: true, header: "Referencia", hideOnMobile: true, render: (m) => (m.ref ? <span className="font-mono text-[12.5px]">{m.ref}</span> : <span className="text-muted">—</span>) },
    { key: "attempts", sortable: true, header: "Intentos", align: "right", render: (m) => m.attempts },
    { key: "last_error", sortable: true, header: "Último error", hideOnMobile: true, render: (m) => <span className="text-[12.5px]">{m.last_error ?? "—"}</span> },
    { key: "status", sortable: true, header: "Estado", render: (m) => <EstadoSaliente status={m.status} /> },
    ...(gestiona ? [{ key: "acciones", header: "", align: "right" as const, render: (m: Saliente) => (m.status === "DEAD" ? (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="primary" icon={RotateCcw} onClick={() => accion(m, "reintentar")}>Reintentar</Button>
        <Button size="sm" variant="ghost" icon={Ban} onClick={() => accion(m, "cancelar")}>Cancelar</Button>
      </div>
    ) : null) }] : []),
  ];

  const c = lista?.cifras;
  return (
    <div className="grid gap-5">
      <PageHeader description={`Los mensajes que fallaron ${lista?.max_intentos ?? 8} veces seguidas. Ya no se reintentan solos: revisa el error, corrige la causa (la plantilla, la credencial, el proveedor) y reinténtalo, o cancélalo si ya no hace falta. Las dos acciones piden un motivo de al menos 10 caracteres y quedan registradas.`} />
      {!gestiona && <Alert tone="info">Tu rol puede consultar la cola muerta, pero no reintentar ni cancelar mensajes.</Alert>}
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:max-w-xl">
          <Cifra titulo="En cola muerta" valor={numero(c.muertos)} icono={Skull} tono={c.muertos ? "bad" : "ok"} detalle="Meta: 0" />
          <Cifra titulo="Atendidos a mano" valor={numero(c.atendidos)} icono={Hand} detalle="Reintentados o cancelados" />
        </div>
      )}
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(m) => ver(m.id)} empty="La cola muerta está vacía." />
      {abierto && <FichaSaliente id={abierto} gestiona={gestiona} onClose={() => ver(null)} onCambio={cargar} />}
    </div>
  );
}

export default function Page() {
  return <Suspense><ColaMuerta /></Suspense>;
}
