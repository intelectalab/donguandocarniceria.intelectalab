"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Crosshair, MapPin } from "lucide-react";
import { Alert, Button, Field, Input, MapPicker, Select, Textarea, type LatLng } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";

type Datos = { empresa: string | null; nombre: string; vence: string; centro: LatLng | null; distrito: string | null; distritos: string[] };

/**
 * Enlace de ubicación (CLI-07) que abre el cliente desde WhatsApp, sin cuenta: marca su pin (o usa
 * el GPS), escribe la dirección y una referencia, y queda guardada para su pedido. Un solo uso.
 */
export default function MarcarUbicacion({ params }: PageProps<"/u/[token]">) {
  const { token } = use(params);
  const [datos, setDatos] = useState<{ token: string; d?: Datos; error?: string } | null>(null);
  const [listo, setListo] = useState<{ zona: { name: string; delivery_fee: number } | null } | null>(null);

  useEffect(() => {
    let vigente = true;
    api<Datos>(`/v1/publico/ubicacion/${encodeURIComponent(token)}`)
      .then((d) => vigente && setDatos({ token, d }))
      .catch((e) => vigente && setDatos({ token, error: mensajeDe(e, "No se pudo abrir el enlace.") }));
    return () => { vigente = false; };
  }, [token]);

  const r = datos?.token === token ? datos : null;

  return (
    <main className="min-h-dvh bg-bg px-4 py-6">
      <div className="mx-auto w-full max-w-[560px] space-y-4">
        <header className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-ink"><MapPin size={18} aria-hidden="true" /></span>
          <div>
            <h1 className="text-[17px] font-semibold">Marca tu ubicación</h1>
            {r?.d?.empresa && <p className="text-[12.5px] text-muted">{r.d.empresa}</p>}
          </div>
        </header>
        {!r ? <p className="text-[13px] text-muted">Abriendo…</p>
          : r.error ? <Alert tone="bad" title="No se puede usar este enlace">{r.error}</Alert>
          : listo ? (
            <section className="space-y-2 rounded-xl border border-line bg-surface p-5 text-center shadow-card">
              <CheckCircle2 size={36} className="mx-auto text-ok" aria-hidden="true" />
              <p className="text-[16px] font-semibold">¡Listo, gracias!</p>
              <p className="text-[13.5px] text-muted">
                Guardamos tu dirección.{listo.zona ? ` Está en la zona ${listo.zona.name}: el delivery cuesta ${soles(listo.zona.delivery_fee)}.` : " Te escribiremos para coordinar la entrega."} Ya puedes cerrar esta página.
              </p>
            </section>
          ) : r.d && <Formulario token={token} d={r.d} onListo={setListo} />}
      </div>
    </main>
  );
}

function Formulario({ token, d, onListo }: { token: string; d: Datos; onListo: (r: { zona: { name: string; delivery_fee: number } | null }) => void }) {
  const [pin, setPin] = useState<LatLng | null>(null);
  const [gps, setGps] = useState(false);
  const [v, setV] = useState({ address_line: "", district: d.distrito ?? "", reference: "", contact_name: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [buscandoGps, setBuscandoGps] = useState(false);
  const set = (k: keyof typeof v) => (x: string) => setV((p) => ({ ...p, [k]: x }));

  function usarGps() {
    if (!navigator.geolocation) { setError("Tu navegador no da la ubicación: marca el punto en el mapa."); return; }
    setBuscandoGps(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setPin({ lat: p.coords.latitude, lng: p.coords.longitude }); setGps(true); setBuscandoGps(false); },
      () => { setError("No pudimos leer tu ubicación. Permite el acceso o marca el punto en el mapa."); setBuscandoGps(false); },
      { enableHighAccuracy: true, timeout: 12000 });
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true); setErrores({}); setError("");
    try {
      onListo(await api(`/v1/publico/ubicacion/${encodeURIComponent(token)}`, { method: "POST", body: { ...v, lat: pin?.lat ?? null, lng: pin?.lng ?? null, gps } }));
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) setError(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-4 rounded-xl border border-line bg-surface p-4 shadow-card">
      <p className="text-[14px]">Hola {d.nombre}: toca el mapa donde quieres recibir tu pedido. Puedes mover el punto para ajustarlo.</p>
      <Button icon={Crosshair} loading={buscandoGps} onClick={usarGps} className="w-full">Usar mi ubicación actual</Button>
      <MapPicker value={pin ?? null} onChange={(p) => { setPin(p); setGps(false); }} height={300}
        references={d.centro && !pin ? [{ ...d.centro, label: "Tu dirección anterior" }] : []} />
      {pin && <p className="flex items-center gap-1.5 text-[13px] text-ok"><CheckCircle2 size={15} aria-hidden="true" /> {gps ? "Tomamos tu ubicación actual." : "Punto marcado en el mapa."}</p>}
      {error && <Alert tone="bad">{error}</Alert>}
      <Field label="Dirección" required hint="Calle y número, interior o piso" error={errores.address_line}>
        <Input value={v.address_line} onChange={(e) => set("address_line")(e.target.value)} autoComplete="street-address" />
      </Field>
      <Field label="Distrito" required error={errores.district}>
        <Select value={v.district} onChange={(e) => set("district")(e.target.value)} placeholder="Elige tu distrito"
          options={[...new Set([...d.distritos, ...(v.district ? [v.district] : [])])].map((x) => ({ value: x, label: x }))} />
      </Field>
      <Field label="Referencia" required hint="Algo que el motorizado vea al llegar (mínimo 10 letras)" error={errores.reference}>
        <Textarea value={v.reference} onChange={(e) => set("reference")(e.target.value)} placeholder="Frente al parque, portón negro" />
      </Field>
      <Field label="¿Quién recibe?" hint="Si eres tú, déjalo vacío" error={errores.contact_name}>
        <Input value={v.contact_name} onChange={(e) => set("contact_name")(e.target.value)} />
      </Field>
      <Button type="submit" variant="primary" loading={enviando} className="w-full">Guardar mi dirección</Button>
      <p className="text-center text-[12px] text-muted">Este enlace sirve una vez y vence el {fechaHora(d.vence)}. Usamos tu dirección solo para entregar tus pedidos.</p>
    </form>
  );
}
