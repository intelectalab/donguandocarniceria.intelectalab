"use client";

import { useEffect, useState } from "react";
import { Moon, RotateCcw, Save, Sun } from "lucide-react";
import { Alert, Badge, Button, DataTable, PageHeader, StatusBadge, Tabs, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";

type Colores = Record<string, string>;
type Tema = { id: string; brand_id: string | null; name: string; light: Colores; dark: Colores; status: string; changed_by: string; created_at: string };
type Marca = { id: string; code: string; name: string; primary_color: string; status: string; legal_footer: string | null; propio: boolean };
type Version = { id: string; name: string; primary: string | null; status: string; changed_by: string; created_at: string };
type Respuesta = {
  tema: Tema | null; propio: boolean; marcas: Marca[]; versiones: Version[];
  colores: Record<string, string>; pares: { texto: string; fondo: string; nombre: string }[]; minimo: number;
};

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activo", "ok"], INACTIVE: ["Anterior", "neutral"] };
const esHex = (c: string | undefined) => /^#[0-9A-Fa-f]{6}$/.test(c ?? "");

/** Contraste WCAG 2.x entre dos colores #RRGGBB (mismo cálculo que la API). */
function contraste(a: string, b: string): number {
  if (!esHex(a) || !esHex(b)) return 0;
  const lum = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const [l1, l2] = [lum(a), lum(b)];
  return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
}

/** PLT-06 Colores por marca: modo claro y oscuro, vista previa y contraste de cada par de texto. */
export default function ColoresPorMarca() {
  const { can, recargar: recargarSesion } = useSesion();
  const [marca, setMarca] = useState("");
  const [datos, setDatos] = useState<{ clave: string } & Respuesta | null>(null);
  const [version, setVersion] = useState(0);
  const [edicion, setEdicion] = useState<{ clave: string; light: Colores; dark: Colores } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const puede = can("plt.theme.manage");
  const clave = `${marca}#${version}`;

  useEffect(() => {
    let vigente = true;
    api<Respuesta>(`/v1/plt/temas${marca ? `?brand_id=${marca}` : ""}`).then((r) => vigente && setDatos({ clave, ...r })).catch((err) => toast.error(mensajeDe(err)));
    return () => { vigente = false; };
  }, [marca, clave]);

  // Lo que se edita parte del tema que rige; una marca sin tema propio parte del de la empresa con su color principal.
  const actual = datos?.clave === clave ? datos : null;
  const base = (() => {
    if (!actual?.tema) return null;
    const light = { ...actual.tema.light };
    const m = actual.marcas.find((x) => x.id === marca);
    if (m && !actual.propio && esHex(m.primary_color)) light.primary = m.primary_color.toUpperCase();
    return { light, dark: { ...actual.tema.dark } };
  })();
  const colores = edicion?.clave === clave ? edicion : base ? { clave, ...base } : null;
  const cambiado = Boolean(edicion?.clave === clave);
  const marcaElegida = actual?.marcas.find((m) => m.id === marca);
  const min = actual?.minimo ?? 4.5;

  function cambiar(modo: "light" | "dark", k: string, v: string) {
    if (!colores) return;
    setEdicion({ ...colores, clave, [modo]: { ...colores[modo], [k]: v.toUpperCase() } });
  }

  const revision = colores && actual ? (["light", "dark"] as const).flatMap((modo) => actual.pares.map((p) => {
    const ratio = contraste(colores[modo][p.texto], colores[modo][p.fondo]);
    return { id: `${modo}-${p.texto}-${p.fondo}`, modo, nombre: p.nombre, ratio, ok: ratio >= min };
  })) : [];
  const fallan = revision.filter((r) => !r.ok).length;

  async function guardar() {
    if (!colores) return;
    setGuardando(true);
    try {
      await api("/v1/plt/temas", { method: "POST", body: { brand_id: marca || null, light: colores.light, dark: colores.dark } });
      toast.ok(`Colores guardados: son los que rigen para ${marcaElegida?.name ?? "la empresa"}`);
      setEdicion(null);
      setVersion((v) => v + 1);
      void recargarSesion(); // el sistema toma los colores nuevos
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  async function quitar() {
    const ok = await confirmAction({
      title: `Quitar los colores propios de ${marcaElegida?.name}`,
      message: "La marca vuelve a usar los colores de la empresa. Las versiones anteriores se conservan.", confirmLabel: "Quitar",
    });
    if (!ok) return;
    try {
      await api("/v1/plt/temas/quitar", { method: "POST", body: { brand_id: marca } });
      toast.ok("La marca usa los colores de la empresa");
      setEdicion(null);
      setVersion((v) => v + 1);
      void recargarSesion();
    } catch (err) {
      toast.error(mensajeDe(err));
    }
  }

  const columnasRevision: Column<(typeof revision)[number]>[] = [
    { key: "modo", header: "Modo", render: (r) => (r.modo === "light" ? "Claro" : "Oscuro") },
    { key: "nombre", header: "Par", cardTitle: true },
    { key: "ratio", header: "Contraste", align: "right", render: (r) => `${numero(r.ratio, 2)}:1` },
    { key: "status", header: "Se lee bien", render: (r) => r.ok ? <Badge tone="ok" dot>Cumple</Badge> : <Badge tone="bad" dot>No cumple</Badge> },
  ];
  const columnasVersiones: Column<Version>[] = [
    { key: "name", header: "Versión", cardTitle: true },
    { key: "primary", header: "Primario", render: (v) => v.primary ? (
      <span className="inline-flex items-center gap-2 font-mono text-[12.5px]"><span className="size-4 rounded-[4px] border border-line" style={{ background: v.primary }} />{v.primary}</span>
    ) : "—" },
    { key: "changed_by", header: "Por" },
    { key: "created_at", header: "Fecha", render: (v) => fechaHora(v.created_at) },
    { key: "status", header: "Estado", render: (v) => <StatusBadge status={v.status} labels={ESTADOS} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`Los colores de la empresa y de cada marca, en modo claro y oscuro, con vista previa. Para que el texto se lea bien, cada par de texto y fondo necesita un contraste de al menos ${numero(min, 1)}:1. Una marca sin colores propios usa los de la empresa.`}
        actions={puede && colores && <>
          {marca && actual?.propio && <Button icon={RotateCcw} onClick={quitar} disabled={guardando}>Usar los de la empresa</Button>}
          <Button variant="primary" icon={Save} loading={guardando} disabled={fallan > 0 || (!cambiado && Boolean(actual?.propio || !marca))}
            title={fallan ? "Hay pares que no se leen bien" : undefined} onClick={guardar}>Guardar colores</Button>
        </>} />

      <Tabs value={marca || "EMPRESA"} onChange={(k) => { setMarca(k === "EMPRESA" ? "" : k); setEdicion(null); }}
        tabs={[{ key: "EMPRESA", label: "Empresa" }, ...(actual?.marcas ?? datos?.marcas ?? []).map((m) => ({ key: m.id, label: m.name.split(" · ")[0] }))]} />

      {marca && actual && !actual.propio && (
        <Alert tone="info">{marcaElegida?.name} no tiene colores propios: hoy usa los de la empresa. Cambia los colores y guarda para darle los suyos.</Alert>
      )}

      {!colores || !actual ? (
        <div className="grid gap-4 lg:grid-cols-2">{[1, 2].map((n) => <div key={n} className="h-[480px] animate-pulse rounded-xl bg-surface-2" />)}</div>
      ) : (<>
        <div className="grid gap-4 lg:grid-cols-2">
          {(["light", "dark"] as const).map((modo) => (
            <section key={modo} className="min-w-0 rounded-xl border border-line bg-surface shadow-card">
              <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-[14px] font-semibold">
                {modo === "light" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
                Modo {modo === "light" ? "claro" : "oscuro"}
              </h2>
              <div className="grid gap-4 p-4">
                <div className="grid gap-2">
                  {Object.entries(actual.colores).map(([k, nombre]) => (
                    <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto_96px] items-center gap-2">
                      <span className="text-[13px]">{nombre}</span>
                      <input type="color" aria-label={`${nombre}, modo ${modo === "light" ? "claro" : "oscuro"}`} disabled={!puede}
                        value={esHex(colores[modo][k]) ? colores[modo][k] : "#000000"} onChange={(e) => cambiar(modo, k, e.target.value)}
                        className="h-8 w-10 cursor-pointer rounded-md border border-line bg-surface p-0.5 disabled:cursor-not-allowed" />
                      <input value={colores[modo][k] ?? ""} maxLength={7} disabled={!puede} aria-label={`${nombre} en #RRGGBB`}
                        onChange={(e) => cambiar(modo, k, e.target.value.trim())}
                        className={`h-8 rounded-md border bg-surface px-2 font-mono text-[12.5px] uppercase text-ink outline-none focus:border-primary disabled:bg-surface-2 ${esHex(colores[modo][k]) ? "border-line" : "border-bad"}`} />
                    </div>
                  ))}
                </div>
                <VistaPrevia t={colores[modo]} marca={marcaElegida} />
              </div>
            </section>
          ))}
        </div>

        <section className="space-y-2">
          <h2 className="text-[14px] font-semibold">
            Contraste calculado {fallan ? <Badge tone="bad">{fallan === 1 ? "1 par no se lee bien" : `${fallan} pares no se leen bien`}</Badge> : <Badge tone="ok">Todo se lee bien</Badge>}
          </h2>
          <DataTable columns={columnasRevision} rows={revision} rowKey={(r) => r.id} />
        </section>

        <section className="space-y-2">
          <h2 className="text-[14px] font-semibold">Versiones de {marcaElegida ? `${marcaElegida.name}` : "la empresa"}</h2>
          <DataTable columns={columnasVersiones} rows={actual.versiones} rowKey={(v) => v.id}
            empty={marca ? "Esta marca nunca tuvo colores propios." : "Sin versiones."} />
        </section>
      </>)}
    </div>
  );
}

/** Cómo se verían la barra, los botones, una tabla y un comprobante con estos colores. */
function VistaPrevia({ t, marca }: { t: Colores; marca?: Marca }) {
  return (
    <div className="grid min-w-0 gap-2.5 rounded-[10px] border p-3" style={{ background: t.background, color: t.text, borderColor: `${t.primary_dark}55` }}>
      <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: t.primary, color: t.on_primary }}>
        <b className="truncate text-[13.5px]">{marca?.name ?? "Empresa"}</b>
        <span className="ml-auto text-[12px] opacity-90">Barra superior</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="rounded-md px-3 py-1.5 font-semibold" style={{ background: t.primary, color: t.on_primary }}>Confirmar pedido</span>
        <span className="rounded-md border px-3 py-1.5" style={{ borderColor: t.primary, color: t.text }}>Cancelar</span>
        <span className="rounded-full px-2 py-0.5 text-[12px] font-bold" style={{ background: t.accent, color: t.primary_dark }}>Acento</span>
      </div>
      <table className="w-full border-collapse text-[12.5px]" style={{ background: t.surface }}>
        <thead>
          <tr>{["Pedido", "Cliente", "Total"].map((x) => <th key={x} className="px-1.5 py-1 text-left" style={{ color: t.text, borderBottom: `2px solid ${t.primary}` }}>{x}</th>)}</tr>
        </thead>
        <tbody>
          {[["P-001301", "Rosa Q.", "S/ 82.32"], ["P-001302", "El Cuy Dorado", "S/ 540.00"]].map((f) => (
            <tr key={f[0]}>{f.map((c) => <td key={c} className="px-1.5 py-1" style={{ color: t.text, borderBottom: `1px solid ${t.text}22` }}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-0.5 rounded-md border border-dashed p-2 text-[12px]" style={{ background: t.surface, borderColor: `${t.text}44` }}>
        <b style={{ color: t.primary }}>BOLETA ELECTRÓNICA B001-00000123</b>
        <span>Cuy entero beneficiado · 1.960 kg × S/ 42.00 = S/ 82.32</span>
        <span className="opacity-75">{marca?.legal_footer ?? "Representación impresa del comprobante electrónico"}</span>
      </div>
    </div>
  );
}
