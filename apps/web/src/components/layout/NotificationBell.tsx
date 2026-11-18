"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { api } from "@/lib/api";
import { moduloPorCodigo } from "@/lib/modulos";
import { haceCuanto, marcarLeida, marcarTodas, onNotificacionesCambio, type Notificacion, type ResumenNotificaciones } from "@/lib/notificaciones";

// Cada cuánto se mira si hay avisos nuevos (solo con la pestaña a la vista).
const POLL_MS = 60_000;

type Vista = "importantes" | "todas";

/**
 * Campana de la cabecera. Cuenta solo las **importantes** sin leer ("9+" desde diez): las rojas y las
 * ámbar de los módulos de tu día a día. El panel separa «Importantes» (lo rojo primero, por módulo) y
 * «Todas» (de la más nueva a la más antigua). Un clic marca la notificación como leída y abre lo que la originó.
 */
export default function NotificationBell({ className, modulosDelDia = [] }: { className: string; modulosDelDia?: string[] }) {
  const router = useRouter();
  const [resumen, setResumen] = useState<ResumenNotificaciones | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vista, setVista] = useState<Vista>("importantes");
  const ref = useRef<HTMLDivElement>(null);
  const dia = modulosDelDia.join(",");

  const load = useCallback(() => {
    api<ResumenNotificaciones>(`/v1/me/notifications/summary${dia ? `?dia=${encodeURIComponent(dia)}` : ""}`).then(setResumen).catch(() => undefined);
  }, [dia]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    const off = onNotificacionesCambio(load);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      off();
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    load();
    const onDown = (event: MouseEvent) => ref.current && !ref.current.contains(event.target as Node) && setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, load]);

  async function openItem(n: Notificacion) {
    setOpen(false);
    if (!n.read) await marcarLeida(n.id).catch(() => undefined);
    if (n.link) router.push(n.link);
  }

  async function readAll() {
    setBusy(true);
    await marcarTodas().catch(() => undefined);
    setBusy(false);
  }

  const unread = resumen?.unread ?? 0;
  const importantes = resumen?.importantes ?? 0;
  const latest = (vista === "importantes" ? resumen?.latest_importantes : resumen?.latest) ?? [];
  // En «Importantes», agrupadas por módulo (en el orden en que llegan: lo rojo primero).
  const grupos = vista === "importantes"
    ? latest.reduce<{ modulo: string; items: Notificacion[] }[]>((acc, n) => {
      const modulo = n.module ? moduloPorCodigo(n.module)?.name ?? n.module : "General";
      const g = acc.find((x) => x.modulo === modulo);
      if (g) g.items.push(n); else acc.push({ modulo, items: [n] });
      return acc;
    }, [])
    : [{ modulo: "", items: latest }];

  return (
    <div className="relative" ref={ref}>
      <button type="button" className={className} onClick={() => setOpen((v) => !v)} aria-haspopup="true" aria-expanded={open}
        aria-label={importantes ? `Notificaciones: ${importantes} importantes sin leer` : "Notificaciones"} title="Notificaciones">
        <Bell size={20} />
        {importantes > 0 && (
          <span className="absolute top-1 right-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-bad px-1 text-[10px] leading-none font-semibold text-white ring-2 ring-surface">
            {importantes > 9 ? "9+" : importantes}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notificaciones"
          className="fixed top-[60px] right-3 left-3 z-[110] overflow-hidden rounded-xl border border-line bg-surface shadow-[0_20px_50px_rgba(40,8,18,0.28)] sm:absolute sm:top-[calc(100%+8px)] sm:right-0 sm:left-auto sm:w-[400px]">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
            <strong className="text-[13.5px] font-semibold text-ink">Notificaciones</strong>
            {unread > 0 && <span className="rounded-full bg-primary-soft px-2 text-[11px] font-semibold whitespace-nowrap text-primary">{unread} sin leer</span>}
            <button type="button" onClick={readAll} disabled={busy || unread === 0}
              className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium whitespace-nowrap text-primary hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45">
              <CheckCheck size={14} />
              Marcar todas como leídas
            </button>
          </div>

          <div role="tablist" aria-label="Qué notificaciones ver" className="flex gap-1 border-b border-line px-3.5 py-2">
            {([["importantes", "Importantes", importantes], ["todas", "Todas", unread]] as const).map(([k, label, n]) => (
              <button key={k} type="button" role="tab" aria-selected={vista === k} onClick={() => setVista(k)}
                className={`cursor-pointer rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors ${vista === k ? "bg-primary text-primary-ink" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>
                {label}{n > 0 ? ` (${n})` : ""}
              </button>
            ))}
          </div>

          {latest.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted">
              {!resumen ? "Cargando…" : vista === "importantes" ? "Nada urgente para ti. Revisa «Todas» si quieres ver el resto." : "No tienes notificaciones."}
            </p>
          ) : (
            <ul className="max-h-[min(420px,60vh)] overflow-y-auto">
              {grupos.map((g) => g.items.map((n, i) => (
                <li key={n.id}>
                  {g.modulo && i === 0 && (
                    <div className="border-b border-line bg-surface-2 px-3.5 py-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">{g.modulo} ({g.items.length})</div>
                  )}
                  <button type="button" onClick={() => openItem(n)}
                    className={`flex w-full cursor-pointer gap-2.5 border-b border-line px-3.5 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-2 ${n.read ? "" : "bg-primary-soft/50"}`}>
                    <span aria-hidden="true" className={`mt-[6px] size-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : n.tone === "bad" ? "bg-bad" : n.tone === "warn" ? "bg-warn" : "bg-primary"}`} />
                    <span className="min-w-0 flex-1">
                      <strong className={`block text-[13px] leading-snug text-ink ${n.read ? "font-medium" : "font-semibold"}`}>{n.title}</strong>
                      <span className="block text-[12.5px] leading-snug text-muted [overflow-wrap:anywhere]">{n.body}</span>
                      <small className="mt-0.5 block text-[11px] text-muted">{haceCuanto(n.created_at)}{n.module ? ` · ${n.module}` : ""}</small>
                    </span>
                  </button>
                </li>
              )))}
            </ul>
          )}

          <Link href="/notificaciones" onClick={() => setOpen(false)}
            className="block border-t border-line px-3.5 py-2.5 text-center text-[12.5px] font-medium text-primary hover:bg-surface-2">
            Ver todas
          </Link>
        </div>
      )}
    </div>
  );
}
