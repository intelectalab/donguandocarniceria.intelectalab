"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, DataTable, DetailList, FiltroSelect, Modal, PageHeader, Tabs, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha } from "@/lib/formato";
import type { Alcance } from "@/modulos/api/comun";

type Opcion = { value: string; label: string };
type Evento = { code: string; module_code: string; modulo: string; scope_code: string; alcance: string; description: string; version: string; status: string; estado: string; retired_at: string | null; ejemplo: unknown };
type Catalogo = { eventos: Evento[]; alcances: Alcance[]; opciones: { modulos: Opcion[]; estados: Opcion[]; alcances: Opcion[] }; firma: { cabecera: string; formato: string; reintentos: number[] } };

/** API-11 Eventos y alcances: los eventos que pueden recibir los webhooks, con su alcance, versión y ejemplo; y los alcances con sus operaciones. */
export default function EventosYAlcances() {
  const [vista, setVista] = useState<"eventos" | "alcances">("eventos");
  const [f, setF] = useState({ modulo: "", estado: "", alcance: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [c, setC] = useState<Catalogo | null>(null);
  const [error, setError] = useState("");
  const [ver, setVer] = useState<Evento | null>(null);
  const [buscarAlc, setBuscarAlc] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 300);
    return () => clearTimeout(t);
  }, [buscar]);
  useEffect(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Catalogo>(`/v1/api/catalogo${q ? `?${q}` : ""}`).then((r) => { setC(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f]);
  const alcances = useMemo(() => {
    const t = buscarAlc.trim().toLowerCase();
    return (c?.alcances ?? []).filter((a) => t.length < 2 || [a.code, a.name, a.modulo, a.description].some((x) => x.toLowerCase().includes(t)));
  }, [c, buscarAlc]);

  const colEventos: Column<Evento>[] = [
    { key: "code", header: "Evento", cardTitle: true, render: (e) => <span className="font-mono font-semibold text-ink">{e.code}</span> },
    { key: "description", header: "Cuándo se envía", render: (e) => <span className="text-[12.5px]">{e.description}</span> },
    { key: "modulo", header: "Módulo", hideOnMobile: true, render: (e) => <span className="text-[12.5px]">{e.modulo}</span> },
    { key: "alcance", header: "Alcance que exige", render: (e) => <span className="font-mono text-[12px]">{e.scope_code}</span> },
    { key: "version", header: "Versión", hideOnMobile: true, render: (e) => <span className="font-mono text-[12.5px]">{e.version}</span> },
    { key: "estado", header: "Estado", render: (e) => <Badge tone={e.status === "ACTIVE" ? "ok" : "neutral"}>{e.status === "RETIRED" && e.retired_at ? `Retirado el ${fecha(e.retired_at)}` : e.estado}</Badge> },
  ];
  const colAlcances: Column<Alcance>[] = [
    { key: "code", header: "Alcance", cardTitle: true, render: (a) => <div><p className="font-mono font-semibold text-ink">{a.code}</p><p className="text-[12px] text-muted">{a.name}</p></div> },
    { key: "modulo", header: "Módulo", render: (a) => <span className="text-[12.5px]">{a.modulo}</span> },
    { key: "tipo", header: "Tipo", render: (a) => a.is_write ? <Badge tone="warn">Escritura</Badge> : <Badge tone="neutral">Lectura</Badge> },
    { key: "description", header: "Qué permite", hideOnMobile: true, render: (a) => <span className="text-[12.5px]">{a.description}</span> },
    { key: "rutas", header: "Operaciones", render: (a) => <div className="grid gap-0.5">{a.rutas.map((r) => <span key={r.metodo + r.ruta} className="font-mono text-[11.5px]"><b>{r.metodo}</b> {r.ruta}</span>)}</div> },
  ];
  return (
    <div className="grid gap-5">
      <PageHeader description="Los eventos que tu empresa puede recibir en sus webhooks, con el alcance que exige cada uno y un ejemplo de su contenido; y los alcances de las claves con sus operaciones. Todo evento lleva su identificador, tipo, fecha y versión." />
      {error && <Alert tone="bad">{error}</Alert>}
      {c && <Alert tone="info">Cada webhook va firmado en la cabecera <span className="font-mono">{c.firma.cabecera}</span> ({c.firma.formato}). Si el destino no responde, se reintenta a los {c.firma.reintentos.join(", ")} minutos.</Alert>}
      <Tabs value={vista} onChange={setVista} tabs={[{ key: "eventos", label: "Eventos", count: c?.eventos.length }, { key: "alcances", label: "Alcances", count: c?.alcances.length }]} />
      {vista === "eventos" ? (
        <DataTable rowKey={(e) => e.code} columns={colEventos} rows={c?.eventos ?? []} loading={!c && !error} onRowClick={setVer} empty="Ningún evento con estos filtros."
          search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar evento o descripción…" }}
          toolbar={<>
            <FiltroSelect etiqueta="Módulo" ancho={170} value={f.modulo} onChange={(v) => setF({ ...f, modulo: v })} options={c?.opciones.modulos ?? []} />
            <FiltroSelect etiqueta="Estado" ancho={160} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={c?.opciones.estados ?? []} />
            <FiltroSelect etiqueta="Alcance" ancho={220} value={f.alcance} onChange={(v) => setF({ ...f, alcance: v })} options={c?.opciones.alcances ?? []} />
          </>} />
      ) : (
        <DataTable rowKey={(a) => a.code} columns={colAlcances} rows={alcances} loading={!c && !error} empty="Ningún alcance coincide."
          search={{ value: buscarAlc, onChange: setBuscarAlc, placeholder: "Buscar alcance, módulo u operación…" }} />
      )}
      {ver && (
        <Modal open onClose={() => setVer(null)} size="lg" title={ver.code} description={ver.description}>
          <div className="grid gap-4">
            <DetailList items={[
              { label: "Módulo", value: ver.modulo }, { label: "Alcance que exige", value: <span className="font-mono">{ver.scope_code}</span> },
              { label: "Versión del contenido", value: ver.version }, { label: "Estado", value: ver.status === "RETIRED" && ver.retired_at ? `Retirado el ${fecha(ver.retired_at)}` : ver.estado },
              { label: "Destinos suscritos", value: "Se ven cuando haya destinos de webhooks" },
            ]} />
            {ver.code === "stock.low" && <Alert tone="info">El umbral es el mínimo de la presentación en Almacenes; si no tiene, el parámetro de stock bajo de la API.</Alert>}
            <div className="grid gap-1.5">
              <p className="text-[12.5px] font-semibold text-muted">Ejemplo de contenido</p>
              <pre className="max-h-[420px] overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[12px] text-ink">{JSON.stringify(ver.ejemplo, null, 2)}</pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
