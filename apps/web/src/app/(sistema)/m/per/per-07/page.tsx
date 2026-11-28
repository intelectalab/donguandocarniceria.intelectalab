"use client";

import { useEffect, useState } from "react";
import { Maximize } from "lucide-react";
import { Button, PageHeader } from "@/components/ui";
import { Qr } from "@/modulos/caj/comunes";
import { ErrorCarga, FiltroLocal, Seccion, Vacio, useDatos, useOpciones } from "@/modulos/per/comunes";
import { hora } from "@/modulos/per/tipos";

type Pantalla = { codigo: string; contenido: string; local: string; desde: string; hasta: string; segundos: number; ultimas: { id: string; hora: string; trabajador: string; tipo: string }[] };

/** PER-07 QR del local: pantalla (tablet) con un QR que cambia cada minuto; un QR fotografiado deja de servir (RN-PER-04). */
export default function QrDelLocal() {
  const { datos: op } = useOpciones();
  const [local, setLocal] = useState("");
  const loc = local || op?.locales[0]?.id || "";
  const { datos, error, recargar } = useDatos<Pantalla>(loc ? `/v1/per/qr/${loc}` : null);
  const [quedan, setQuedan] = useState(0);
  useEffect(() => {
    if (!datos) return;
    // Cuenta con los segundos que da la API (no con la hora de la tablet, que puede estar corrida).
    const fin = Date.now() + Math.max(2, datos.segundos) * 1000;
    const tic = () => {
      const s = Math.max(0, Math.round((fin - Date.now()) / 1000));
      setQuedan(s);
      if (s <= 0) recargar();
    };
    tic();
    const t = setInterval(tic, 1000);
    return () => clearInterval(t);
  }, [datos, recargar]);
  useEffect(() => {
    // Respaldo: si la tablet pierde la hora, igual pide un código nuevo cada 15 s.
    const t = setInterval(recargar, 15000);
    return () => clearInterval(t);
  }, [recargar]);
  if (error) return <ErrorCarga error={error} que="La pantalla del QR la abren RR. HH. y los supervisores en la tablet del local." />;
  const periodo = op?.parametros.qr_segundos ?? 60;
  return (
    <div className="space-y-4">
      <PageHeader description={`Deja esta pantalla abierta en la tablet de la entrada. El personal lee el QR con su celular desde App · Marcación. El código cambia cada ${periodo} segundos.`}
        actions={<Button icon={Maximize} onClick={() => document.documentElement.requestFullscreen?.()}>Pantalla completa</Button>} />
      <div className="flex flex-wrap gap-2"><FiltroLocal op={op} value={loc} onChange={setLocal} todos={false} /></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Seccion className="flex flex-col items-center gap-3 py-6 text-center">
          {datos ? (
            <>
              <p className="text-[18px] font-semibold text-ink">{datos.local}</p>
              <Qr texto={datos.contenido} tamano={300} />
              <p className="font-mono text-[22px] font-semibold tracking-wider">{datos.codigo}</p>
              <div className="h-1.5 w-full max-w-[300px] overflow-hidden rounded-full bg-surface-2">
                <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, (quedan / periodo) * 100)}%` }} />
              </div>
              <p className="text-[13px] text-muted">Cambia en {quedan} s · vale de {hora(datos.desde)} a {hora(datos.hasta)}</p>
            </>
          ) : <Vacio>Cargando el código…</Vacio>}
        </Seccion>
        <Seccion titulo="Últimas marcaciones">
          {datos?.ultimas.length ? (
            <ul className="space-y-1.5 text-[13px]">
              {datos.ultimas.map((u) => <li key={u.id} className="flex justify-between gap-2"><span className="truncate">{u.trabajador} <span className="text-muted">· {u.tipo}</span></span><span className="tabular-nums">{hora(u.hora)}</span></li>)}
            </ul>
          ) : <Vacio>Sin marcaciones hoy.</Vacio>}
        </Seccion>
      </div>
    </div>
  );
}
