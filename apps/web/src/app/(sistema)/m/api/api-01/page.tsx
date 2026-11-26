"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CalendarClock, Gauge, KeyRound, Plus, ShieldOff, TrendingDown } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, FiltroSelect, PageHeader, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, porcentaje } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { Alcances, Entorno, TONO_ESTADO, type Clave } from "@/modulos/api/comun";

type Lista = Pagina<Clave> & {
  cifras: { total: number; activas: number; produccion: number; pruebas: number; por_vencer: number; por_vencer_nombres: string[]; revocadas: number; vencidas: number };
  puede: boolean; opciones: { alcances: { value: string; label: string }[] };
  uso: { hoy: number; limite: number | null; rechazadas_30: number; llamadas_30: number; rechazadas_pct: number | null };
};

/** API-01 Claves de API: con alcances, marcas, IP y vencimiento. Solo se guarda el prefijo y una huella del secreto. */
export default function ClavesDeApi() {
  const router = useRouter();
  const [f, setF] = useState({ entorno: "", estado: "", escritura: "", alcance: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const pag = usePagina(JSON.stringify(f));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/api/claves?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs]);
  useEffect(() => cargar(), [cargar]);

  async function revocar(k: Clave) {
    const r = await confirmAction({ title: `Revocar ${k.prefix}…`, message: `«${k.name}» dejará de funcionar de inmediato: la siguiente llamada responderá 401. Una clave revocada no se reactiva.`,
      confirmLabel: "Revocar", danger: true, reason: { label: "Motivo de la revocación", min: 10 } });
    if (!r) return;
    try {
      await api(`/v1/api/claves/${k.id}/revocar`, { method: "POST", body: { motivo: r.reason } });
      toast.ok(`Clave ${k.prefix}… revocada`);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const c = lista?.cifras;
  const columnas: Column<Clave>[] = [
    { key: "nombre", sortable: true, header: "Nombre", cardTitle: true, render: (k) => <div><p className="font-semibold text-ink">{k.name}</p>{k.cliente && <p className="text-[11.5px] text-muted">Cliente: {k.cliente}</p>}</div> },
    { key: "entorno", sortable: true, header: "Entorno", render: (k) => <Entorno e={k.environment} /> },
    { key: "prefijo", header: "Prefijo", render: (k) => <span className="font-mono text-[12.5px]">{k.prefix}…</span> },
    { key: "alcances", header: "Alcances", hideOnMobile: true, render: (k) => <Alcances items={k.alcances} /> },
    { key: "marcas", header: "Marcas", hideOnMobile: true, render: (k) => <span className="text-[12.5px]">{k.marcas.length ? k.marcas.join(", ") : "Todas"}</span> },
    { key: "vence", sortable: true, header: "Vence", render: (k) => <div className="whitespace-nowrap"><span className={k.status === "ACTIVE" && k.dias <= 15 ? "font-semibold text-warn" : ""}>{fecha(k.expires_at)}</span>{k.status === "ACTIVE" && <p className="text-[11.5px] text-muted">en {numero(k.dias)} días</p>}</div> },
    { key: "uso", sortable: true, header: "Último uso", hideOnMobile: true, render: (k) => k.last_used_at ? <div className="text-[12.5px]">{fechaHora(k.last_used_at)}<p className="font-mono text-[11.5px] text-muted">{k.last_ip}</p></div> : <span className="text-muted">Nunca</span> },
    { key: "estado", header: "Estado", render: (k) => <Badge tone={TONO_ESTADO[k.status]}>{k.estado}</Badge> },
    ...(lista?.puede ? [{ key: "acciones", header: "", align: "right" as const, render: (k: Clave) => k.status === "ACTIVE" ? (
      <div onClick={(e) => e.stopPropagation()}><Button size="sm" variant="ghost" icon={Ban} onClick={() => revocar(k)}>Revocar</Button></div>) : null }] : []),
  ];
  return (
    <div className="grid gap-5">
      <PageHeader description="Claves para que otros sistemas (el ERP de un restaurante, una tienda online, el BI del contador) usen la API de tu empresa. Cada clave tiene alcances, marcas, IP permitidas y vencimiento. Solo se guarda el prefijo y una huella del secreto."
        actions={lista?.puede ? <Link href="/m/api/api-02"><Button variant="primary" icon={Plus}>Crear clave</Button></Link> : undefined} />
      {c && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Cifra titulo="Claves activas" valor={`${numero(c.activas)} de ${numero(c.total)}`} icono={KeyRound} destacada detalle={`${numero(c.produccion)} producción · ${numero(c.pruebas)} pruebas`} />
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "ACTIVE" })}><Cifra titulo="Vencen en 15 días" valor={numero(c.por_vencer)} icono={CalendarClock} tono={c.por_vencer ? "warn" : undefined} detalle={c.por_vencer_nombres.join(", ") || "Ninguna"} /></button>
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "REVOKED" })}><Cifra titulo="Revocadas" valor={numero(c.revocadas)} icono={Ban} detalle="Clic para verlas" /></button>
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "EXPIRED" })}><Cifra titulo="Vencidas" valor={numero(c.vencidas)} icono={ShieldOff} tono={c.vencidas ? "bad" : undefined} detalle="Responden 401" /></button>
          {lista && <Link href="/m/api/api-10" className="text-left"><Cifra titulo="Llamadas de hoy" valor={numero(lista.uso.hoy)} icono={Gauge} tono={lista.uso.limite && lista.uso.hoy / lista.uso.limite > 0.8 ? "warn" : undefined} detalle={lista.uso.limite ? `de ${numero(lista.uso.limite)} del día` : "sin límite diario"} /></Link>}
          {lista && <Link href="/m/api/api-10" className="text-left"><Cifra titulo="Rechazadas por límite (30 días)" valor={lista.uso.rechazadas_pct === null ? "—" : porcentaje(lista.uso.rechazadas_pct, 2)} icono={TrendingDown} tono={lista.uso.rechazadas_30 ? "warn" : undefined} detalle={`${numero(lista.uso.rechazadas_30)} de ${numero(lista.uso.llamadas_30)}`} /></Link>}
        </div>
      )}
      <Alert tone="info">Solo claves de API (sin inicio de sesión de terceros) y documentación con ejemplos, sin bibliotecas cliente. Los sistemas llaman a <span className="font-mono">/api/publica/v1</span> con <span className="font-mono">Authorization: Bearer</span> y la clave.</Alert>
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(k) => router.push(`/m/api/api-03?id=${k.id}`)} empty={lista?.puede ? "Todavía no hay claves. Crea la primera con «Crear clave»." : "Todavía no hay claves."}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar nombre, prefijo, cliente o descripción…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Entorno" ancho={170} value={f.entorno} onChange={(v) => setF({ ...f, entorno: v })} options={[{ value: "LIVE", label: "Producción" }, { value: "TEST", label: "Pruebas" }]} />
          <FiltroSelect etiqueta="Estado" ancho={160} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={[{ value: "ACTIVE", label: "Activas" }, { value: "REVOKED", label: "Revocadas" }, { value: "EXPIRED", label: "Vencidas" }]} />
          <FiltroSelect etiqueta="Escritura" todos="todas" ancho={190} value={f.escritura} onChange={(v) => setF({ ...f, escritura: v })} options={[{ value: "1", label: "Con alcances de escritura" }, { value: "0", label: "Solo lectura" }]} />
          <FiltroSelect etiqueta="Alcance" ancho={220} value={f.alcance} onChange={(v) => setF({ ...f, alcance: v })} options={lista?.opciones.alcances ?? []} />
        </>} />
    </div>
  );
}
