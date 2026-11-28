"use client";

import { use, useEffect, useState } from "react";
import { CheckCircle2, Clock, PackageCheck, Truck, XCircle } from "lucide-react";
import { Alert } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";

type Seguimiento = {
  pedido: string; marca: string | null; estado: string; paso: number; franja: string | null; fecha: string | null; hora_estimada: string | null;
  entregado_a_las: string | null; no_entregado: boolean; repartidor: string | null; paradas_antes: number | null; vence: string;
};

const PASOS = [
  { n: 1, texto: "Pedido confirmado", Icono: CheckCircle2 },
  { n: 2, texto: "Preparando tu pedido", Icono: PackageCheck },
  { n: 3, texto: "En camino", Icono: Truck },
  { n: 4, texto: "Entregado", Icono: CheckCircle2 },
];

/** DEL-08 Enlace de seguimiento (público, sin cuenta): estado, hora estimada y nombre de pila del repartidor (RN-DEL-08). */
export default function SeguirPedido({ params }: PageProps<"/s/[token]">) {
  const { token } = use(params);
  const [r, setR] = useState<{ token: string; d?: Seguimiento; error?: string } | null>(null);

  useEffect(() => {
    let vigente = true;
    const cargar = () => api<Seguimiento>(`/v1/publico/seguimiento/${encodeURIComponent(token)}`)
      .then((d) => vigente && setR({ token, d }))
      .catch((e) => vigente && setR({ token, error: mensajeDe(e, "No se pudo abrir el enlace.") }));
    void cargar();
    const t = window.setInterval(cargar, 60000);
    return () => { vigente = false; window.clearInterval(t); };
  }, [token]);

  const x = r?.token === token ? r : null;
  const d = x?.d;
  return (
    <main className="min-h-dvh bg-bg px-4 py-6">
      <div className="mx-auto w-full max-w-[480px] space-y-4">
        <header className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-ink"><Truck size={18} aria-hidden="true" /></span>
          <div>
            <h1 className="text-[17px] font-semibold">Sigue tu pedido</h1>
            {d?.marca && <p className="text-[12.5px] text-muted">{d.marca}</p>}
          </div>
        </header>
        {!x ? <p className="text-[13px] text-muted">Abriendo…</p> : x.error ? <Alert tone="bad" title="No se puede abrir este enlace">{x.error}</Alert> : d && (
          <section className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
            <div>
              <p className="text-[12.5px] text-muted">Pedido</p>
              <p className="text-[18px] font-bold text-ink">{d.pedido}</p>
              {d.franja && <p className="text-[13px] text-muted">Entrega entre las {d.franja}</p>}
            </div>
            {d.no_entregado ? (
              <div className="flex items-start gap-3 rounded-lg bg-bad-soft p-3 text-[14px] text-ink"><XCircle className="shrink-0 text-bad" size={22} />No pudimos entregar tu pedido. Te escribiremos para coordinar una nueva entrega.</div>
            ) : d.paso === 4 ? (
              <div className="flex items-start gap-3 rounded-lg bg-ok-soft p-3 text-[14px] text-ink"><CheckCircle2 className="shrink-0 text-ok" size={22} />Entregado{d.entregado_a_las ? ` el ${d.entregado_a_las}` : ""}. ¡Gracias por tu compra!</div>
            ) : d.paso === 3 ? (
              <div className="flex items-start gap-3 rounded-lg bg-primary-soft p-3 text-[14px] text-ink">
                <Clock className="shrink-0 text-primary" size={22} />
                <span>{d.repartidor ? `${d.repartidor} va en camino` : "Tu pedido va en camino"}{d.hora_estimada ? `. Llega cerca de las ${d.hora_estimada}` : ""}{d.paradas_antes ? ` (${d.paradas_antes} entrega(s) antes)` : ""}.</span>
              </div>
            ) : null}
            <ol className="space-y-2">
              {PASOS.map(({ n, texto, Icono }) => (
                <li key={n} className={`flex items-center gap-3 text-[14px] ${d.paso >= n ? "text-ink" : "text-muted"}`}>
                  <span className={`grid size-8 place-items-center rounded-full ${d.paso >= n ? "bg-primary text-primary-ink" : "bg-surface-2"}`}><Icono size={16} aria-hidden="true" /></span>
                  {texto}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </main>
  );
}
