"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LockOpen } from "lucide-react";
import { Alert, Badge, Button, PageHeader, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, soles } from "@/lib/formato";
import { Conteo, limpiarConteo, sumaConteo } from "@/modulos/pos/Conteo";
import { Alertas, Seccion, Vacio } from "@/modulos/pos/Seccion";
import { MODOS_BALANZA, type Turno } from "@/modulos/pos/tipos";
import { useContexto } from "@/modulos/pos/useContexto";

const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
const diaLima = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date(iso));

/** POS-01 Abrir turno: elige la caja, cuenta el fondo por denominación y abre; una caja y una cajera, un turno abierto (RN-POS-01/02). */
export default function AbrirTurno() {
  const router = useRouter();
  const { ctx, error, cargando } = useContexto();
  const [caja, setCaja] = useState("");
  const [conteo, setConteo] = useState<Record<string, number>>({});
  const [abriendo, setAbriendo] = useState(false);

  if (cargando) return <Vacio>Cargando el mostrador…</Vacio>;
  if (error || !ctx) return <Alert tone="bad">{error || "No se pudo cargar el mostrador."}</Alert>;

  const libres = ctx.cajas.filter((c) => !c.turno_abierto);
  const elegida = ctx.cajas.find((c) => c.id === caja) ?? (libres.length === 1 ? libres[0] : undefined);

  async function abrir() {
    if (!elegida) return;
    setAbriendo(true);
    try {
      const t = await api<Turno>("/v1/pos/turnos", { method: "POST", body: { terminal_id: elegida.id, counts: limpiarConteo(conteo) } });
      toast.ok(`Turno ${t.number} abierto en ${elegida.name} con ${soles(t.opening_float)} de fondo.`);
      router.push("/m/pos/pos-02");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setAbriendo(false);
    }
  }

  const t = ctx.turno;
  return (
    <div className="space-y-5">
      <PageHeader code="POS-01" description="Elige la caja, cuenta el fondo inicial por denominación y abre tu turno. Una caja y una cajera tienen como máximo un turno abierto." />
      <Alertas alertas={ctx.alertas} />

      {t ? (
        <Seccion titulo="Ya tienes un turno abierto">
          <p className="text-[13.5px] text-ink">
            <b>{t.number}</b> en <b>{t.caja.name}</b> desde {fechaHora(t.opened_at)} con {soles(t.opening_float)} de fondo.
          </p>
          {diaLima(t.opened_at) < hoyLima() && (
            <div className="mt-3"><Alert tone="bad">Este turno quedó abierto desde el {fecha(t.opened_at)}: ciérralo con su arqueo antes de seguir.</Alert></div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => router.push("/m/pos/pos-02")}>Ir a Venta</Button>
            <Button onClick={() => router.push("/m/pos/pos-06")}>Ingresos y retiros</Button>
            <Button onClick={() => router.push("/m/pos/pos-07")}>Cerrar turno</Button>
          </div>
        </Seccion>
      ) : !ctx.puede.abrir ? (
        <Alert tone="warn">Tu rol no abre turnos de caja. Lo abre la cajera de turno.</Alert>
      ) : ctx.cajas.length === 0 ? (
        <Alert tone="warn">No hay cajas registradoras activas en tu local.{ctx.puede.cajas && <> Créalas en <Link className="underline" href="/m/pos/pos-11">Cajas registradoras</Link>.</>}</Alert>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <Seccion titulo="1. Caja">
            <div className="space-y-2">
              {ctx.cajas.map((c) => {
                const ocupada = Boolean(c.turno_abierto);
                const activa = elegida?.id === c.id;
                return (
                  <button key={c.id} type="button" disabled={ocupada} onClick={() => setCaja(c.id)}
                    className={`w-full cursor-pointer rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${activa ? "border-primary bg-primary-soft" : "border-line bg-surface hover:bg-surface-2"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-ink">{c.name}</span>
                      {ocupada ? <Badge tone="warn">Turno {c.turno_abierto} · {c.turno_cajera}</Badge> : <Badge tone="ok">Libre</Badge>}
                    </div>
                    <div className="mt-1 text-[12.5px] text-muted">{c.local} · {c.almacen} · Boleta {c.serie_boleta ?? "de la marca"} · {MODOS_BALANZA[c.scale_mode]}</div>
                  </button>
                );
              })}
            </div>
          </Seccion>
          <Seccion titulo="2. Fondo inicial">
            <Conteo denominaciones={ctx.denominaciones} valor={conteo} onChange={setConteo} disabled={!elegida} />
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              {sumaConteo(conteo) === 0 && <span className="text-[12.5px] text-muted">Sin fondo: el turno abre en S/ 0.00.</span>}
              <Button variant="primary" icon={LockOpen} loading={abriendo} disabled={!elegida} onClick={abrir}>
                Abrir turno{elegida ? ` en ${elegida.name}` : ""}
              </Button>
            </div>
          </Seccion>
        </div>
      )}

      {ctx.abiertos.length > 0 && (
        <Seccion titulo="Turnos abiertos en tu local">
          <ul className="divide-y divide-line">
            {ctx.abiertos.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13.5px]">
                <span><b>{a.number}</b> · {a.caja} · {a.cashier_name}</span>
                <span className="flex items-center gap-2 text-muted">
                  desde {fechaHora(a.opened_at)}
                  {diaLima(a.opened_at) < hoyLima() && <Badge tone="bad">De otro día</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </Seccion>
      )}
    </div>
  );
}
