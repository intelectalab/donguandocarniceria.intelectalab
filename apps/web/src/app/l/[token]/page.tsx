import type { Metadata } from "next";
import { CalendarClock, Factory, ShieldCheck, Snowflake, Sprout, TriangleAlert } from "lucide-react";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8010";

type Lote = {
  product: string; variant: string | null; brand: string | null; lot: string; production_date: string | null; expiry_date: string | null; storage: string | null;
  sanitary: { authority: string | null; number: string | null; expires: string | null } | null;
  farm: { species: string | null; slaughter_date: string | null; farm_name: string; tagline: string } | null;
  recalled: boolean; recall: { number: string; date: string; message: string } | null; company: string | null;
};

/** El estado de retiro tiene que verse al momento: sin caché. */
async function leer(token: string): Promise<Lote | null> {
  try {
    const r = await fetch(`${API_URL}/api/v1/publico/lotes/${encodeURIComponent(token)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
    return r.ok ? ((await r.json()) as Lote) : null;
  } catch {
    return null;
  }
}

const fecha = (v: string | null) => (v ? new Date(`${v.slice(0, 10)}T12:00:00`).toLocaleDateString("es-PE", { day: "2-digit", month: "long", year: "numeric" }) : "—");

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const l = await leer((await params).token);
  return { title: l ? `${l.product} · lote ${l.lot}` : "Lote no encontrado", robots: { index: false } };
}

/** ETQ-08 Página pública del QR: sin inicio de sesión, solo datos del producto y del lote; nunca precio, costo, cliente ni pedido (RN-ETQ-09). */
export default async function PaginaLote({ params }: { params: Promise<{ token: string }> }) {
  const l = await leer((await params).token);
  if (!l) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg px-4">
        <div className="max-w-sm text-center">
          <p className="font-display text-xl font-semibold text-ink">No encontramos este lote</p>
          <p className="mt-2 text-[14px] text-muted">El código puede estar incompleto o ya no estar activo. Si tienes dudas sobre tu producto, escríbenos.</p>
        </div>
      </main>
    );
  }
  const hoy = new Date().toISOString().slice(0, 10);
  const vencido = !!l.expiry_date && l.expiry_date.slice(0, 10) < hoy;
  const ESPECIE: Record<string, string> = { CERDO: "cerdo", RES: "res", POLLO: "pollo", CUY: "cuy", CONEJO: "conejo", CORDERO: "cordero", PATO: "pato" };
  return (
    <main className="min-h-dvh bg-bg px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-4">
        <header className="text-center">
          <p className="text-[12px] font-semibold tracking-[0.14em] text-muted uppercase">{l.brand ?? l.company}</p>
          <h1 className="mt-1 font-display text-[26px] leading-tight font-semibold text-ink">{l.product}</h1>
          {l.variant && l.variant !== l.product && <p className="text-[15px] text-muted">{l.variant}</p>}
        </header>

        {l.recalled && (
          <section role="alert" className="rounded-2xl border border-bad/40 bg-bad-soft p-4 text-bad">
            <p className="flex items-center gap-2 text-[16px] font-semibold"><TriangleAlert className="size-5 shrink-0" />No consumas este producto</p>
            <p className="mt-1 text-[14px] text-ink">Estamos retirando el lote {l.lot}{l.recall?.number ? ` (${l.recall.number})` : ""} por precaución. Guárdalo y escríbenos para cambiarlo o devolverte tu dinero sin costo.</p>
          </section>
        )}
        {!l.recalled && vencido && (
          <section role="alert" className="rounded-2xl border border-warn/40 bg-warn-soft p-4 text-[14px] text-ink">
            <p className="flex items-center gap-2 font-semibold text-warn"><CalendarClock className="size-5 shrink-0" />Este lote ya venció</p>
            <p className="mt-1">Venció el {fecha(l.expiry_date)}. No lo consumas.</p>
          </section>
        )}

        <section className="rounded-2xl border border-line bg-surface p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[14px]">
            <div className="col-span-2"><dt className="text-[12px] text-muted">Lote</dt><dd className="font-mono text-[17px] font-semibold text-ink">{l.lot}</dd></div>
            <div><dt className="text-[12px] text-muted">Producido</dt><dd className="text-ink">{fecha(l.production_date)}</dd></div>
            <div><dt className="text-[12px] text-muted">Vence</dt><dd className={vencido ? "font-semibold text-warn" : "text-ink"}>{fecha(l.expiry_date)}</dd></div>
          </dl>
        </section>

        {l.storage && <Fila icono={<Snowflake className="size-5" />} titulo="Conservación" texto={l.storage} />}
        {l.sanitary?.number && <Fila icono={<ShieldCheck className="size-5" />} titulo={`Registro sanitario ${l.sanitary.authority ?? ""}`.trim()}
          texto={`${l.sanitary.number}${l.sanitary.expires ? ` · vigente hasta el ${fecha(l.sanitary.expires)}` : ""}`} />}
        {l.farm
          ? <Fila icono={<Sprout className="size-5" />} titulo={l.farm.tagline} destacada
            texto={`${l.farm.species ? `Este ${ESPECIE[l.farm.species] ?? "animal"} se crio` : "Se crio"} en ${l.farm.farm_name}${l.farm.slaughter_date ? ` y se benefició el ${fecha(l.farm.slaughter_date)}` : ""}.`} />
          : <Fila icono={<Factory className="size-5" />} titulo="Elaborado por" texto={l.company ?? l.brand ?? ""} />}

        <p className="pt-2 text-center text-[12px] text-muted">Escaneaste el código de la etiqueta. Esta página solo muestra datos del producto y de su lote.</p>
      </div>
    </main>
  );
}

function Fila({ icono, titulo, texto, destacada }: { icono: React.ReactNode; titulo: string; texto: string; destacada?: boolean }) {
  return (
    <section className={`flex gap-3 rounded-2xl border p-4 ${destacada ? "border-ok/30 bg-ok-soft" : "border-line bg-surface"}`}>
      <span className={`mt-0.5 shrink-0 ${destacada ? "text-ok" : "text-muted"}`}>{icono}</span>
      <div><p className="text-[13px] font-semibold text-ink">{titulo}</p><p className="text-[14px] text-ink">{texto}</p></div>
    </section>
  );
}
