"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Bell, Blocks, Building2, CheckCheck, PowerOff } from "lucide-react";
import { Badge, Button, Cifra, DataTable, PageHeader, Select, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { GRUPOS, menuDe, moduloPorCodigo } from "@/lib/modulos";
import { useSesion } from "@/lib/sesion";
import type { Colores, TemaMarca } from "@/lib/temaMarca";
import { sinCodigos } from "@/modulos/plt/tipos";

type Notificacion = { id: string; title: string; body: string; module: string | null; tone: string | null; read: boolean; created_at: string; link: string | null };
type ModuloEstado = { code: string; enabled: boolean };
type FilaMenu = { code: string; nombre: string; grupo: string; encendido: boolean | null; acciones: string; enMenu: boolean };

const ACCIONES: Record<string, string> = { C: "Crear", L: "Ver", E: "Editar", A: "Aprobar" };
const MODOS = [{ value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" }, { value: "system", label: "El del sistema" }];

// Modo de color: el mismo guardado que usa el botón de la barra (aycha-tema).
const oyentesModo = new Set<() => void>();
const leerModo = () => { try { return localStorage.getItem("aycha-tema") ?? "system"; } catch { return "system"; } };
function guardarModo(modo: string) {
  try {
    if (modo === "system") { localStorage.removeItem("aycha-tema"); delete document.documentElement.dataset.theme; }
    else { localStorage.setItem("aycha-tema", modo); document.documentElement.dataset.theme = modo; }
  } catch {}
  oyentesModo.forEach((f) => f());
}

/** PLT-01 Armazón: lo que rodea cada pantalla, con tus preferencias, notificaciones y el menú de tu rol. */
export default function Armazon() {
  const { me, marca, local, setMarca, setLocal } = useSesion();
  const modo = useSyncExternalStore((f) => { oyentesModo.add(f); return () => oyentesModo.delete(f); }, leerModo, () => "system");
  const [notas, setNotas] = useState<{ unread: number; latest: Notificacion[] } | null>(null);
  const [estados, setEstados] = useState<ModuloEstado[] | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vigente = true;
    api<{ unread: number; latest: Notificacion[] }>("/v1/me/notifications/summary").then((r) => vigente && setNotas(r)).catch(() => {});
    return () => { vigente = false; };
  }, [version]);
  useEffect(() => {
    let vigente = true;
    api<{ modulos: ModuloEstado[] }>("/v1/plt/modulos").then((r) => vigente && setEstados(r.modulos)).catch(() => vigente && setEstados([]));
    return () => { vigente = false; };
  }, []);

  const enMenu = new Set(menuDe(me.modules, me.roles, me.permissions).flatMap((g) => g.modulos.filter((m) => m.enabled).map((m) => m.code)));
  const acceso = new Map(me.modules.map((m) => [m.code, m]));
  const encendido = new Map((estados ?? []).map((m) => [m.code, m.enabled]));
  const apagados = (estados ?? []).filter((m) => !m.enabled).map((m) => m.code);
  const filas: FilaMenu[] = GRUPOS.flatMap((g) => g.mods.flatMap((code) => {
    const m = moduloPorCodigo(code);
    if (!m) return [];
    const a = acceso.get(code);
    return [{ code, nombre: m.name, grupo: g.name, encendido: encendido.get(code) ?? a?.enabled ?? null, acciones: a?.actions ?? "", enMenu: enMenu.has(code) }];
  }));

  // Vista previa: la marca elegida (o la del usuario, o la primera) con sus colores, o los generales.
  const marcaVista = me.brands.find((b) => b.id === marca) ?? me.brands.find((b) => b.id === me.user.default_brand_id) ?? me.brands[0];
  const propias = me.themes && !Array.isArray(me.themes.brands) ? me.themes.brands : {};
  const tema: TemaMarca | null = (marcaVista && propias[marcaVista.id]) || me.themes?.empresa || null;
  const localNombre = local === "ALL" ? "Todos los locales" : me.establishments.find((e) => e.id === local)?.short ?? "";

  async function leer(n: Notificacion) {
    await api(`/v1/me/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
    setVersion((v) => v + 1);
  }
  async function leerTodas() {
    await api("/v1/me/notifications/read-all", { method: "POST" }).catch(() => {});
    setVersion((v) => v + 1);
  }

  const columnas: Column<FilaMenu>[] = [
    { key: "code", header: "Módulo", cardTitle: true, render: (f) => <span><span className="font-mono font-semibold">{f.code}</span> {f.nombre}</span> },
    { key: "grupo", header: "Grupo" },
    { key: "status", header: "Encendido", render: (f) => f.encendido === null ? <span className="text-muted">—</span>
      : f.encendido ? <Badge tone="ok" dot>Encendido</Badge> : <Badge tone="warn" dot>Apagado</Badge> },
    { key: "acciones", header: "Tu acceso", render: (f) => f.acciones
      ? f.acciones.split("").map((l) => ACCIONES[l]).filter(Boolean).join(", ") : <span className="text-muted">Sin acceso</span> },
    { key: "enMenu", header: "En tu menú", render: (f) => f.enMenu ? "Sí" : <span className="text-muted">No</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Lo que ves alrededor de cada pantalla: la barra con los colores de la marca elegida, los selectores de marca y local según tu alcance, la campana, el menú con los módulos encendidos y permitidos para tu rol, y el modo claro u oscuro." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Módulos en tu menú" valor={numero(enMenu.size)} detalle={`Encendidos y permitidos para ${me.user.role}`} icono={Blocks} destacada />
        <Cifra titulo="Módulos apagados" valor={estados ? numero(apagados.length) : undefined} detalle={apagados.join(", ") || "Ninguno"} icono={PowerOff}
          tono={apagados.length ? "warn" : undefined} />
        <Cifra titulo="Marcas y locales" valor={`${me.brands.length} · ${me.establishments.length}`} detalle="En tu alcance" icono={Building2} />
        <Cifra titulo="Notificaciones sin leer" valor={notas ? numero(notas.unread) : undefined} detalle={notas ? `${notas.latest.length} recientes` : ""} icono={Bell}
          tono={notas?.unread ? "warn" : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-xl border border-line bg-surface shadow-card">
          <h2 className="border-b border-line px-4 py-3 text-[14px] font-semibold">Vista previa con la marca elegida</h2>
          <div className="p-4">
            {tema ? <VistaArmazon t={tema.light} marca={marcaVista?.name ?? me.tenant.name} codigo={marcaVista?.code ?? ""} local={localNombre}
              usuario={`${me.user.name} · ${me.user.role}`} modulos={filas.filter((f) => f.enMenu).map((f) => `${f.code} ${f.nombre}`)} />
              : <p className="text-[13px] text-muted">Sin colores guardados: rige la paleta del sistema.</p>}
            <p className="mt-3 text-[12.5px] text-muted">
              Los colores salen de <Link href="/m/plt/plt-06" className="text-primary hover:underline">Colores por marca</Link>. Una marca sin colores propios usa los generales.
            </p>
          </div>
        </section>

        <section className="min-w-0 rounded-xl border border-line bg-surface shadow-card">
          <h2 className="border-b border-line px-4 py-3 text-[14px] font-semibold">Tus preferencias</h2>
          <div className="grid gap-4 p-4">
            <label className="grid gap-1.5">
              <span className="text-[12.5px] font-medium text-muted">Marca</span>
              <Select value={marca} onChange={(e) => setMarca(e.target.value)}
                options={[...(me.brands.length > 1 ? [{ value: "ALL", label: "Todas las marcas" }] : []), ...me.brands.map((b) => ({ value: b.id, label: b.name }))]} />
              <small className="text-[12px] text-muted">Solo las de tu alcance; las inactivas o separadas no aparecen.</small>
            </label>
            <label className="grid gap-1.5">
              <span className="text-[12.5px] font-medium text-muted">Local</span>
              <Select value={local} onChange={(e) => setLocal(e.target.value)}
                options={[...(me.establishments.length > 1 ? [{ value: "ALL", label: "Todos los locales" }] : []), ...me.establishments.map((e) => ({ value: e.id, label: e.short }))]} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[12.5px] font-medium text-muted">Modo de color</span>
              <Select value={modo} onChange={(e) => guardarModo(e.target.value)} options={MODOS} />
              <small className="text-[12px] text-muted">Se guarda en este navegador. «El del sistema» sigue la configuración de tu equipo.</small>
            </label>
            <p className="text-[12.5px] text-muted">
              Atajo: <kbd className="rounded border border-line bg-surface-2 px-1.5 font-mono text-[11.5px]">Ctrl K</kbd> abre la búsqueda.
            </p>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold">Tus notificaciones</h2>
          <div className="flex items-center gap-2">
            {notas && notas.unread > 0 && <Button size="sm" icon={CheckCheck} onClick={leerTodas}>Marcar todas como leídas</Button>}
            <Link href="/notificaciones" className="text-[13px] font-medium text-primary hover:underline">Ver todas</Link>
          </div>
        </div>
        {!notas ? <p className="px-4 py-6 text-[13px] text-muted">Cargando…</p> : notas.latest.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-muted">No tienes notificaciones.</p>
        ) : (
          <ul className="divide-y divide-line">
            {notas.latest.slice(0, 8).map((n) => (
              <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.read ? "" : "bg-primary-soft/40"}`}>
                <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-line" : "bg-primary"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold">{sinCodigos(n.title)}</p>
                  <p className="text-[13px]">{sinCodigos(n.body)}</p>
                  <p className="text-[12px] text-muted">{n.module ? `${n.module} · ` : ""}{fechaHora(n.created_at)}{n.read ? " · leída" : ""}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {n.link && <Link href={n.link} onClick={() => !n.read && leer(n)} className="text-[12.5px] font-medium text-primary hover:underline">Abrir</Link>}
                  {!n.read && <button type="button" onClick={() => leer(n)} className="cursor-pointer text-[12.5px] text-muted hover:text-ink hover:underline">Marcar leída</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-[14px] font-semibold">Módulos y tu acceso</h2>
        <DataTable columns={columnas} rows={filas} rowKey={(f) => f.code} loading={!estados} />
      </section>
    </div>
  );
}

/** Mini armazón con los colores de la marca: barra, menú y contenido. */
function VistaArmazon({ t, marca, codigo, local, usuario, modulos }:
  { t: Colores; marca: string; codigo: string; local: string; usuario: string; modulos: string[] }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-line" style={{ background: t.background, color: t.text }}>
      <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-2.5" style={{ background: t.primary, color: t.on_primary }}>
        <span className="grid size-7 place-items-center rounded-full text-[11px] font-extrabold" style={{ background: t.accent, color: t.primary_dark }}>{codigo || "·"}</span>
        <b className="text-[13.5px]">{marca}</b>
        <span className="text-[12.5px] opacity-85">· {local}</span>
        <span className="ml-auto truncate text-[12px] opacity-90">{usuario}</span>
      </div>
      <div className="grid min-h-[170px] grid-cols-[minmax(0,140px)_minmax(0,1fr)]">
        <div className="grid content-start gap-1 p-2.5 text-[12px]" style={{ background: t.primary_dark, color: t.on_primary }}>
          {modulos.slice(0, 7).map((m) => <span key={m} className="truncate">{m}</span>)}
          {modulos.length > 7 && <span className="opacity-70">+{modulos.length - 7} módulos</span>}
        </div>
        <div className="grid content-start gap-2 p-3" style={{ background: t.surface }}>
          <b className="text-[13px]">Contenido de la pantalla</b>
          <span className="text-[12.5px] opacity-80">Tablas, formularios y cifras con estos colores.</span>
          <span className="justify-self-start rounded-md px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: t.primary, color: t.on_primary }}>Botón principal</span>
        </div>
      </div>
    </div>
  );
}
