"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Minus, Plus, RotateCcw } from "lucide-react";
import { Alert, Badge, Button, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";

type Plan = {
  id: string; plan_code: string; name: string; description: string | null; price_pen: number; users_max: number | null; brands_max: number | null; sites_max: number | null;
  highlights: string[]; is_featured: boolean; tipo: "ACTUAL" | "SUBE" | "BAJA"; modulos: string[];
  prorrateo: { monto: number; dias: number; dias_periodo: number } | null; excede: { nombre: string; usado: number; limite: number }[];
};
type Comparador = { actual: string | null; pendiente: string | null; pendiente_desde: string | null; en_prueba: boolean; planes: Plan[] };
type Complemento = {
  code: string; name: string; description: string | null; kind: "MODULE" | "LIMIT"; unit_qty: number; price_pen: number | null; publicado: boolean;
  contratado: { quantity: number; unit_price: number; desde: string } | null; incluido_en_plan: boolean; faltan: string[];
};

const cuenta = (n: number | null, uno: string, varios: string) => (n === null ? `${varios} sin límite` : `${n} ${n === 1 ? uno : varios}`);

/** SUS-02 Cambiar de plan: comparador con prorrateo al subir y lo que excedería al bajar (RN-SUS-18). */
export function CambiarPlan({ puede, onCambio }: { puede: boolean; onCambio: () => void }) {
  const [c, setC] = useState<Comparador | null>(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const cargar = useCallback(() => {
    api<Comparador>("/v1/suscripcion/planes").then((x) => { setC(x); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(() => cargar(), [cargar]);

  async function elegir(p: Plan) {
    const sube = p.tipo === "SUBE";
    const mensaje = c?.en_prueba ? "Estás en prueba: el cambio es inmediato y sin cobro." : sube
      ? `El cambio es inmediato. Se cobra la diferencia de los días que quedan del mes: ${soles(p.prorrateo?.monto ?? 0)} + IGV, en un comprobante aparte.`
      : "El cambio se aplica al empezar el próximo mes. Hasta entonces sigues con tu plan actual.";
    if (!(await confirmAction({ title: `¿Cambiar al plan ${p.name}?`, message: mensaje, confirmLabel: "Cambiar de plan" }))) return;
    setEnviando(true);
    try {
      setC(await api<Comparador>("/v1/suscripcion/plan", { method: "POST", body: { plan_version_id: p.id } }));
      toast.ok(sube || c?.en_prueba ? `Ya estás en el plan ${p.name}` : `Pasas al plan ${p.name} el próximo mes`);
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  async function deshacer() {
    try {
      setC(await api<Comparador>("/v1/suscripcion/plan/deshacer", { method: "POST" }));
      toast.ok("Te quedas en tu plan");
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!c) return <p className="text-muted">Cargando…</p>;
  const pendiente = c.planes.find((p) => p.id === c.pendiente);
  return (
    <div className="grid gap-4">
      {pendiente && (
        <Alert tone="info" title={`Pasas al plan ${pendiente.name} el ${fecha(c.pendiente_desde)}`}>
          {puede && <Button size="sm" icon={RotateCcw} className="mt-2" onClick={deshacer}>Quedarme en mi plan</Button>}
        </Alert>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {c.planes.map((p) => (
          <div key={p.id} className={`grid content-start gap-3 rounded-xl border bg-surface p-4 shadow-card ${p.tipo === "ACTUAL" ? "border-primary" : "border-line"}`}>
            <div className="flex items-start justify-between gap-2">
              <div><p className="text-[17px] font-semibold text-ink">{p.name}</p><p className="text-[13px] text-muted">{p.description}</p></div>
              {p.tipo === "ACTUAL" ? <Badge tone="primary">Tu plan</Badge> : p.is_featured ? <Badge tone="info">Recomendado</Badge> : null}
            </div>
            <p className="text-[22px] font-semibold text-ink">{soles(p.price_pen)}<span className="text-[13px] font-normal text-muted"> al mes + IGV</span></p>
            <ul className="grid gap-1 text-[13px] text-ink">
              <li>{cuenta(p.users_max, "usuario", "usuarios")} · {cuenta(p.brands_max, "marca", "marcas")} · {cuenta(p.sites_max, "local", "locales")}</li>
              {p.highlights.slice(0, 4).map((h) => <li key={h} className="flex gap-1.5"><Check size={14} className="mt-0.5 shrink-0 text-ok" aria-hidden="true" />{h}</li>)}
            </ul>
            <details className="text-[12.5px] text-muted"><summary className="cursor-pointer">{p.modulos.length} módulos</summary><p className="mt-1">{p.modulos.join(", ")}</p></details>
            {p.tipo === "SUBE" && p.prorrateo && <p className="text-[12.5px] text-muted">Hoy pagarías {soles(p.prorrateo.monto)} + IGV por {p.prorrateo.dias} de {p.prorrateo.dias_periodo} días.</p>}
            {p.excede.length > 0 && <p className="text-[12.5px] text-bad">No entras con tu uso actual: {p.excede.map((e) => `${e.nombre.toLowerCase()} ${e.usado} de ${e.limite}`).join("; ")}.</p>}
            {puede && p.tipo !== "ACTUAL" && p.id !== c.pendiente && (
              <Button variant={p.tipo === "SUBE" ? "primary" : "secondary"} icon={p.tipo === "SUBE" ? ArrowUp : ArrowDown} disabled={enviando || p.excede.length > 0}
                className="justify-self-start" onClick={() => elegir(p)}>{p.tipo === "SUBE" ? "Subir a este plan" : "Bajar a este plan"}</Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** SUS-03 Complementos: contratar o quitar módulos y unidades de límite. */
export function Complementos({ puede, onCambio }: { puede: boolean; onCambio: () => void }) {
  const [lista, setLista] = useState<Complemento[] | null>(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState<string | null>(null);
  const cargar = useCallback(() => {
    api<{ data: Complemento[] }>("/v1/suscripcion/complementos").then((x) => { setLista(x.data); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(() => cargar(), [cargar]);

  async function cambiar(c: Complemento, quitar: boolean) {
    if (quitar && !(await confirmAction({ title: `¿Quitar ${c.name}${c.kind === "LIMIT" && (c.contratado?.quantity ?? 0) > 1 ? " (uno)" : ""}?`, confirmLabel: "Quitar", danger: true }))) return;
    setEnviando(c.code);
    try {
      const r = await api<{ data: Complemento[] }>(`/v1/suscripcion/complementos/${c.code}`, { method: quitar ? "DELETE" : "POST", body: { quantity: 1 } });
      setLista(r.data);
      toast.ok(quitar ? "Complemento quitado" : "Complemento contratado: se cobra desde el próximo comprobante");
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(null);
    }
  }

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!lista) return <p className="text-muted">Cargando…</p>;
  if (lista.length === 0) return <Alert tone="info">Todavía no hay complementos disponibles.</Alert>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {lista.map((c) => (
        <div key={c.code} className="grid content-start gap-2 rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-ink">{c.name}</p>
            {c.contratado ? <Badge tone="ok" dot>Contratado{c.kind === "LIMIT" ? ` × ${c.contratado.quantity}` : ""}</Badge> : c.incluido_en_plan ? <Badge>Incluido en tu plan</Badge> : null}
          </div>
          {c.description && <p className="text-[13px] text-muted">{c.description}</p>}
          <p className="text-[13.5px] text-ink">{c.price_pen !== null ? `${soles(c.contratado?.unit_price ?? c.price_pen)} al mes + IGV` : "Precio por definir"}</p>
          {c.faltan.length > 0 && !c.contratado && <p className="text-[12.5px] text-warn">Necesita {c.faltan.join(", ")}: cámbiate a un plan que lo incluya.</p>}
          {puede && (
            <div className="flex gap-2">
              {c.publicado && !c.incluido_en_plan && (c.kind === "LIMIT" || !c.contratado) && c.faltan.length === 0 && (
                <Button size="sm" variant="primary" icon={Plus} loading={enviando === c.code} onClick={() => cambiar(c, false)}>{c.contratado ? "Uno más" : "Contratar"}</Button>
              )}
              {c.contratado && <Button size="sm" variant="ghost" icon={Minus} disabled={enviando === c.code} onClick={() => cambiar(c, true)}>Quitar{c.kind === "LIMIT" && c.contratado.quantity > 1 ? " uno" : ""}</Button>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
