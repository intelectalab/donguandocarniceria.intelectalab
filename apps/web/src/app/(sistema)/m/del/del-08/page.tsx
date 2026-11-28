"use client";

import { useState } from "react";
import { Copy, ExternalLink, Link2 } from "lucide-react";
import { Alert, Button, FiltroFecha, PageHeader, StatusBadge, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio, hoyLima, useDatos, useOpciones } from "@/modulos/del/comunes";
import { PEDIDO } from "@/modulos/del/tipos";

type Pedido = { id: string; number: string; status: string; cliente: string | null; franja: string | null; ruta: { code: string; seq: number } | null };

/**
 * DEL-08 Enlace de seguimiento: la página que ve el cliente (estado, hora estimada y nombre de pila del repartidor,
 * sin datos de otros clientes). Aquí se copia el enlace de cada pedido para enviarlo o revisarlo.
 */
export default function Enlaces() {
  const { can } = useSesion();
  const [dia, setDia] = useState(hoyLima());
  const op = useOpciones(dia);
  const local = op.datos?.locales[0]?.id;
  const { datos, error, cargando } = useDatos<{ pedidos: Pedido[] }>(local ? `/v1/del/planificador?fecha=${dia}` : null);
  const [enlaces, setEnlaces] = useState<Record<string, { url: string; vence: string }>>({});

  async function obtener(p: Pedido) {
    try {
      const r = await api<{ token: string; expires_at: string }>(`/v1/del/pedidos/${p.id}/enlace`);
      const url = `${window.location.origin}/s/${r.token}`;
      setEnlaces((e) => ({ ...e, [p.id]: { url, vence: r.expires_at } }));
      return url;
    } catch (e) { toast.error(mensajeDe(e)); return null; }
  }

  return (
    <div className="space-y-5">
      <PageHeader description="Cada pedido tiene un enlace con un código al azar. El cliente ve el estado, la hora estimada y el nombre de pila del repartidor; vence 48 horas después de la entrega." />
      <FiltroFecha etiqueta="Fecha de entrega" value={dia} onChange={(v) => setDia(v || hoyLima())} />
      {(error || op.error) && <Alert tone="bad">{error || op.error}</Alert>}
      <Seccion titulo="Pedidos de delivery">
        {cargando || !op.datos ? <Vacio>Cargando…</Vacio> : !datos?.pedidos.length ? <Vacio>No hay pedidos de delivery para esta fecha.</Vacio> : (
          <ul className="divide-y divide-line">
            {datos.pedidos.map((p) => {
              const e = enlaces[p.id];
              return (
                <li key={p.id} className="py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">{p.number}<StatusBadge status={p.status} labels={PEDIDO} /></span>
                      <span className="block text-[12.5px] text-muted">{p.cliente} · {p.franja ?? "sin franja"}{p.ruta ? ` · ${p.ruta.code}` : ""}</span>
                    </span>
                    <span className="flex gap-2">
                      {!e ? <Button size="sm" icon={Link2} onClick={() => void obtener(p)}>Ver enlace</Button> : (
                        <>
                          <Button size="sm" icon={Copy} onClick={async () => { await navigator.clipboard?.writeText(e.url); toast.ok("Enlace copiado."); }}>Copiar</Button>
                          <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] text-ink" href={e.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Abrir</a>
                          {can("del.route.plan") && <Button size="sm" variant="ghost" onClick={async () => {
                            const c = await confirmAction({ title: "Anular el enlace", message: "El cliente ya no podrá abrirlo. Se genera uno nuevo al pedirlo.", danger: true, confirmLabel: "Anular" });
                            if (!c) return;
                            try { await api(`/v1/del/pedidos/${p.id}/enlace/anular`, { method: "POST", body: {} }); setEnlaces((x) => { const y = { ...x }; delete y[p.id]; return y; }); toast.ok("Enlace anulado."); }
                            catch (x) { toast.error(mensajeDe(x)); }
                          }}>Anular</Button>}
                        </>
                      )}
                    </span>
                  </div>
                  {e && <p className="mt-1 break-all font-mono text-[12px] text-muted">{e.url} · vence {fechaHora(e.vence)}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Seccion>
    </div>
  );
}
