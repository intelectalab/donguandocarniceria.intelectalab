"use client";

import { useMemo, useState } from "react";
import { Alert, Badge, Button, DataTable, Field, Input, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/mae/Dialogo";
import { TIPO_UNIDAD, ordenarFilas, useDatos } from "@/modulos/mae/tipos";

type Unidad = { id: string; code: string; name: string; uom_type: string; decimals: number; is_system: boolean; status: string; sunat_vigente: boolean };
type Conversion = { id: string; from_uom: string; to_uom: string; factor: number; inversa: number; note: string | null };
type Datos = { unidades: Unidad[]; conversiones: Conversion[]; codigos_libres: { code: string; description: string }[] };

const num = (n: number, max = 6) => n.toLocaleString("es-PE", { maximumFractionDigits: max });

/**
 * MAE-06 Unidades y conversiones: unidades con su código SUNAT, tipo y decimales permitidos (RN-MAE-10); conversiones
 * exactas con su inversa calculada, que no se registra aparte (RN-MAE-09); calculadora.
 */
export default function Unidades() {
  const { puede, can } = useSesion();
  const { datos, error, recargar } = useDatos<Datos>("/v1/mae/unidades");
  const [nueva, setNueva] = useState<"" | "unidad" | "conversion">("");
  const [ordenU, setOrdenU] = useState("");
  const [ordenC, setOrdenC] = useState("");
  const gestiona = can("mae.unit.manage") && puede("MAE", "C");
  const unidades = useMemo(() => ordenarFilas(datos?.unidades ?? [], ordenU, (u, c) =>
    c === "uom_type" ? TIPO_UNIDAD[u.uom_type] ?? u.uom_type : c === "is_system" ? (u.is_system ? "Sistema" : "Propia")
      : c === "sunat_vigente" ? (u.sunat_vigente ? "Vigente" : "No está") : (u as unknown as Record<string, string | number>)[c]), [datos, ordenU]);
  const conversiones = useMemo(() => ordenarFilas(datos?.conversiones ?? [], ordenC, (x, c) =>
    c === "par" ? `${x.from_uom} ${x.to_uom}` : c === "inversa" ? `${x.to_uom} ${x.from_uom}` : x.note ?? ""), [datos, ordenC]);

  const colUnidades: Column<Unidad>[] = [
    { key: "code", header: "Código SUNAT", sortable: true, render: (u) => <span className="font-mono text-[12.5px]">{u.code}</span> },
    { key: "name", header: "Unidad", cardTitle: true, sortable: true, render: (u) => <span className="font-semibold">{u.name}</span> },
    { key: "uom_type", header: "Tipo", sortable: true, render: (u) => TIPO_UNIDAD[u.uom_type] ?? u.uom_type },
    { key: "decimals", header: "Decimales", align: "right", sortable: true },
    { key: "is_system", header: "Origen", hideOnMobile: true, sortable: true, render: (u) => (u.is_system ? <Badge tone="info">Sistema</Badge> : <Badge>Propia</Badge>) },
    { key: "sunat_vigente", header: "Catálogo 03", sortable: true, render: (u) => (u.sunat_vigente ? <Badge tone="ok">Vigente</Badge> : <Badge tone="bad">No está</Badge>) },
  ];
  const colConversiones: Column<Conversion>[] = [
    { key: "par", header: "Conversión", cardTitle: true, sortable: true, render: (c) => <span className="font-mono text-[12.5px]">1 {c.from_uom} = {num(c.factor, 4)} {c.to_uom}</span> },
    { key: "inversa", header: "Inversa (calculada)", sortable: true, render: (c) => <span className="font-mono text-[12.5px]">1 {c.to_uom} = {num(c.inversa)} {c.from_uom}</span> },
    { key: "note", header: "Nota", hideOnMobile: true, sortable: true, render: (c) => c.note ?? "—" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Unidades con su código SUNAT, tipo y decimales permitidos; conversiones exactas con su inversa calculada."
        actions={gestiona ? <>
          <Button onClick={() => setNueva("unidad")} disabled={!datos}>Nueva unidad</Button>
          <Button variant="primary" onClick={() => setNueva("conversion")} disabled={!datos}>Nueva conversión</Button>
        </> : undefined} />
      {error && <Alert tone="bad">{error}</Alert>}

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold">Unidades de medida</h2>
          <DataTable columns={colUnidades} rows={unidades} loading={!datos && !error} empty="No hay unidades." sort={ordenU} onSortChange={setOrdenU} />
          <p className="text-[12.5px] text-muted">Una cantidad no lleva más decimales de los que admite su unidad: por ejemplo, 1,5 unidades se rechaza.</p>
        </section>
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold">Conversiones</h2>
          <DataTable columns={colConversiones} rows={conversiones} loading={!datos && !error} empty="No hay conversiones." sort={ordenC} onSortChange={setOrdenC} />
          <p className="text-[12.5px] text-muted">La inversa no se registra aparte: se calcula como 1 ÷ factor. Sin conversión entre dos unidades, la operación se rechaza.</p>
        </section>
      </div>

      {datos && <Calculadora unidades={datos.unidades} />}

      {nueva === "conversion" && datos && <NuevaConversion unidades={datos.unidades} onClose={() => setNueva("")} onGuardado={() => { setNueva(""); recargar(); }} />}
      {nueva === "unidad" && datos && <NuevaUnidad libres={datos.codigos_libres} onClose={() => setNueva("")} onGuardado={() => { setNueva(""); recargar(); }} />}
    </div>
  );
}

/** Convierte una cantidad entre dos unidades con las reglas del sistema (decimales y conversión definida). */
function Calculadora({ unidades }: { unidades: Unidad[] }) {
  const [v, setV] = useState({ qty: "1.25", from: "KGM", to: "GRM" });
  const [r, setR] = useState<{ ok: boolean; texto: string } | null>(null);
  const opciones = unidades.map((u) => ({ value: u.code, label: `${u.code} · ${u.name}` }));
  async function convertir() {
    try {
      const x = await api<{ resultado: number }>(`/v1/mae/unidades/convertir?qty=${encodeURIComponent(v.qty)}&from=${v.from}&to=${v.to}`);
      setR({ ok: true, texto: `${num(Number(v.qty))} ${v.from} = ${num(x.resultado)} ${v.to}` });
    } catch (e) {
      setR({ ok: false, texto: mensajeDe(e) });
    }
  }
  const cambiar = (c: Partial<typeof v>) => { setV({ ...v, ...c }); setR(null); };
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-3 text-[15px] font-semibold">Calculadora de conversión</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end [&>*]:min-w-0">
        <Field label="Cantidad"><Input type="number" step="any" value={v.qty} onChange={(e) => cambiar({ qty: e.target.value })} /></Field>
        <Field label="De"><Select value={v.from} onChange={(e) => cambiar({ from: e.target.value })} options={opciones} /></Field>
        <Field label="A"><Select value={v.to} onChange={(e) => cambiar({ to: e.target.value })} options={opciones} /></Field>
        <Button variant="primary" onClick={convertir} disabled={v.qty === ""}>Convertir</Button>
      </div>
      {r && <div className="mt-3"><Alert tone={r.ok ? "ok" : "bad"}>{r.texto}</Alert></div>}
    </section>
  );
}

/** RN-MAE-09: factor mayor que cero; no se repite el par en ningún sentido. */
function NuevaConversion({ unidades, onClose, onGuardado }: { unidades: Unidad[]; onClose: () => void; onGuardado: () => void }) {
  const [v, setV] = useState({ from_uom: "BG", to_uom: "NIU", factor: "", note: "" });
  const opciones = unidades.map((u) => ({ value: u.code, label: `${u.code} · ${u.name}` }));
  return (
    <Dialogo titulo="Nueva conversión" boton="Registrar" onClose={onClose}
      aviso="Se registra en un solo sentido: la inversa se calcula sola. No se puede repetir un par que ya existe, en ningún sentido."
      enviar={async () => {
        await api("/v1/mae/conversiones", { method: "POST", body: { ...v, factor: Number(v.factor), note: v.note.trim() || null } });
        toast.ok("Conversión registrada");
        onGuardado();
      }}>
      {(e) => <>
        <Field label="De" required error={e.from_uom}><Select value={v.from_uom} onChange={(x) => setV({ ...v, from_uom: x.target.value })} options={opciones} /></Field>
        <Field label="A" required error={e.to_uom}><Select value={v.to_uom} onChange={(x) => setV({ ...v, to_uom: x.target.value })} options={opciones} /></Field>
        <Field label={`Factor (1 ${v.from_uom} = factor ${v.to_uom})`} required error={e.factor}>
          <Input type="number" min={0} step="any" value={v.factor} onChange={(x) => setV({ ...v, factor: x.target.value })} />
        </Field>
        <Field label="Nota" error={e.note}><Input value={v.note} maxLength={80} onChange={(x) => setV({ ...v, note: x.target.value })} /></Field>
      </>}
    </Dialogo>
  );
}

/** Unidad propia de la empresa: un código del catálogo 03 de SUNAT vigente que todavía no use, con su tipo y decimales. */
function NuevaUnidad({ libres, onClose, onGuardado }: { libres: Datos["codigos_libres"]; onClose: () => void; onGuardado: () => void }) {
  const [v, setV] = useState({ code: libres[0]?.code ?? "", name: libres[0]?.description ?? "", uom_type: "UNIT", decimals: "0" });
  const elegir = (code: string) => setV({ ...v, code, name: libres.find((x) => x.code === code)?.description ?? v.name });
  return (
    <Dialogo titulo="Nueva unidad" boton="Registrar" onClose={onClose} deshabilitado={!libres.length}
      aviso={libres.length
        ? "Solo códigos vigentes del catálogo 03 de SUNAT, para que los comprobantes salgan bien. Las unidades del sistema no se cambian."
        : "Ya usas todos los códigos del catálogo 03 cargado. Si necesitas otro, pídele a Intelectalab que actualice el catálogo de SUNAT."}
      enviar={async () => {
        const r = await api<{ code: string }>("/v1/mae/unidades", { method: "POST", body: { ...v, name: v.name.trim() || null, decimals: Number(v.decimals) } });
        toast.ok(`Unidad ${r.code} registrada`);
        onGuardado();
      }}>
      {(e) => <>
        <Field label="Código SUNAT (catálogo 03)" required error={e.code}>
          <Select value={v.code} onChange={(x) => elegir(x.target.value)} placeholder={libres.length ? undefined : "Sin códigos libres"}
            options={libres.map((x) => ({ value: x.code, label: `${x.code} · ${x.description}` }))} />
        </Field>
        <Field label="Nombre" error={e.name} hint="Por defecto, el de SUNAT"><Input value={v.name} maxLength={40} onChange={(x) => setV({ ...v, name: x.target.value })} /></Field>
        <Field label="Tipo" required error={e.uom_type}>
          <Select value={v.uom_type} onChange={(x) => setV({ ...v, uom_type: x.target.value })} options={Object.entries(TIPO_UNIDAD).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Decimales permitidos" required error={e.decimals} hint="0 = solo cantidades enteras; el kilo usa 3">
          <Input type="number" min={0} max={6} step={1} value={v.decimals} onChange={(x) => setV({ ...v, decimals: x.target.value })} />
        </Field>
      </>}
    </Dialogo>
  );
}
