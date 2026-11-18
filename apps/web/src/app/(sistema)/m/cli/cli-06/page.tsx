"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Crosshair, Link2, Save, Search } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Field, Input, MapPicker, PageHeader, Select, Textarea, toast, type LatLng } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { BuscarCliente } from "@/modulos/cli/BuscarCliente";
import { AvisoZona, useZonaDelPin } from "@/modulos/cli/ZonaDelPin";
import { ORIGEN_PIN, celular, type Direccion } from "@/modulos/cli/tipos";

type Cliente = { id: string; nombre: string; phone: string | null; merged_into_id?: string | null };
type Carga = { clave: string; cliente: Cliente; direccion: Direccion | null; otras: Direccion[]; distritos: string[] };

/** CLI-06 Mapa de la dirección: pin en el mapa (o búsqueda por texto, GPS, coordenadas), referencia obligatoria y quién recibe. ?cliente= y ?direccion= para editar. */
export default function MapaDeLaDireccion() {
  return <Suspense><Pantalla /></Suspense>;
}

// Lee ?id= y los demás datos de la dirección en el navegador: la página se compila sin ellos.
function Pantalla() {
  const params = Object.fromEntries(useSearchParams());
  const clienteId = typeof params.cliente === "string" ? params.cliente : "";
  const direccionId = typeof params.direccion === "string" ? params.direccion : "";
  const clave = `${clienteId}|${direccionId}`;
  const router = useRouter();
  const [carga, setCarga] = useState<Carga | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clienteId && !direccionId) return;
    let vigente = true;
    (async () => {
      const distritos = await api<string[]>("/v1/cli/distritos");
      let cid = clienteId;
      if (direccionId) {
        const r = await api<{ direccion: { customer_id: string } }>(`/v1/cli/direcciones/${direccionId}`);
        cid = r.direccion.customer_id;
      }
      const dc = await api<{ cliente: Cliente; direcciones: Direccion[] }>(`/v1/cli/clientes/${cid}/direcciones`);
      return { clave, cliente: dc.cliente, distritos, direccion: dc.direcciones.find((a) => a.id === direccionId) ?? null, otras: dc.direcciones.filter((a) => a.id !== direccionId) };
    })().then((c) => { if (vigente) { setCarga(c); setError(""); } }).catch((e) => vigente && setError(mensajeDe(e)));
    return () => { vigente = false; };
  }, [clave, clienteId, direccionId]);

  const c = carga?.clave === clave ? carga : null;

  if (!clienteId && !direccionId) {
    return (
      <div className="space-y-5">
        <PageHeader description="Elige el cliente al que le agregas la dirección." />
        <BuscarCliente onElegir={(x) => router.push(`/m/cli/cli-06?cliente=${x}`)} placeholder="Celular, nombre o documento del cliente…" />
      </div>
    );
  }
  if (error) return <Alert tone="bad" title="No se pudo abrir la dirección">{error}</Alert>;
  if (!c) return <p className="text-[13px] text-muted">Cargando…</p>;
  if (direccionId && !c.direccion) return <Alert tone="warn" title="Dirección desactivada">Esa dirección ya no está activa. <Link className="underline" href={`/m/cli/cli-05?cliente=${c.cliente.id}`}>Ver sus direcciones</Link>.</Alert>;
  return <Formulario key={clave} carga={c} />;
}

function Formulario({ carga }: { carga: Carga }) {
  const router = useRouter();
  const { can } = useSesion();
  const { cliente, direccion: a, otras, distritos } = carga;
  const [v, setV] = useState({
    label: a?.label ?? (otras.length ? "" : "Casa"), address_line: a?.address_line ?? "", district: a?.district ?? "", reference: a?.reference ?? "",
    contact_name: a?.contact_name ?? "", contact_phone: a?.contact_phone ?? "", is_default: a?.is_default ?? otras.length === 0,
  });
  const [pin, setPin] = useState<LatLng | null>(a?.lat != null && a?.lng != null ? { lat: a.lat, lng: a.lng } : null);
  const [origen, setOrigen] = useState<{ fuente: string; confianza: number | null; movido: boolean }>({ fuente: a?.pin_source ?? "MAP", confianza: a?.geocode_confidence ?? null, movido: false });
  const [buscar, setBuscar] = useState("");
  const [coords, setCoords] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const zona = useZonaDelPin(pin?.lat, pin?.lng, v.district);
  const set = (k: keyof typeof v) => (x: string | boolean) => setV((p) => ({ ...p, [k]: x }));
  const fusionado = Boolean(cliente.merged_into_id);
  const puede = can("cli.customer.manage") && !fusionado;

  function moverPin(p: LatLng) {
    setPin(p);
    setOrigen((o) => ({ ...o, fuente: o.fuente === "GEOCODE" ? "GEOCODE" : "MAP", movido: true }));
  }

  async function buscarTexto() {
    const q = [buscar.trim() || v.address_line, v.district].filter(Boolean).join(", ");
    if (!q) return;
    setBuscando(true);
    try {
      const g = await api<{ lat: number; lng: number; confidence: number; district: string }>(`/v1/cli/geocodificar?q=${encodeURIComponent(q)}`);
      setPin({ lat: g.lat, lng: g.lng });
      setOrigen({ fuente: "GEOCODE", confianza: g.confidence, movido: false });
      if (!v.district) set("district")(g.district);
      if (!v.address_line && buscar.trim()) set("address_line")(buscar.trim());
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setBuscando(false);
    }
  }

  function usarCoordenadas() {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(coords);
    if (!m) { toast.error("Pega las coordenadas como «-12.1325, -76.9921»."); return; }
    setPin({ lat: Number(m[1]), lng: Number(m[2]) });
    setOrigen({ fuente: "COORDINATES", confianza: null, movido: false });
  }

  function usarGps() {
    if (!navigator.geolocation) { toast.error("Este navegador no da la ubicación."); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setPin({ lat: p.coords.latitude, lng: p.coords.longitude }); setOrigen({ fuente: "GPS", confianza: null, movido: false }); },
      () => toast.error("No se pudo leer la ubicación: revisa el permiso del navegador."), { enableHighAccuracy: true, timeout: 10000 });
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true); setErrores({}); setError("");
    const body = {
      ...v, lat: pin?.lat ?? null, lng: pin?.lng ?? null, pin_source: origen.fuente,
      geocode_confidence: origen.fuente === "GEOCODE" ? origen.confianza : null, pin_confirmed: origen.fuente === "GEOCODE" && origen.movido,
    };
    try {
      await api(a ? `/v1/cli/direcciones/${a.id}` : `/v1/cli/clientes/${cliente.id}/direcciones`, { method: a ? "PUT" : "POST", body });
      toast.ok(a ? "Dirección actualizada" : "Dirección guardada");
      router.push(`/m/cli/cli-05?cliente=${cliente.id}`);
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  const geocodeBajo = origen.fuente === "GEOCODE" && !origen.movido && (origen.confianza ?? 0) < 0.8;
  const minRef = 10;

  return (
    <div className="space-y-5">
      <PageHeader description={<>
        {a ? "Editar dirección de " : "Nueva dirección para "}<Link href={`/m/cli/cli-02?id=${cliente.id}`} className="font-semibold text-ink hover:text-primary">{cliente.nombre}</Link> · {celular(cliente.phone)}
      </>}
        actions={puede && <Button icon={Link2} onClick={() => router.push(`/m/cli/cli-07?cliente=${cliente.id}`)}>Que la marque el cliente</Button>} />

      {fusionado && <Alert tone="info">Este cliente fue fusionado: agrega la dirección al sobreviviente (RN-CLI-08).</Alert>}

      <form onSubmit={guardar} noValidate className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <Input aria-label="Buscar la dirección" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar: Av. Primavera 1250, Surco"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscarTexto(); } }} />
            </div>
            <Button icon={Search} loading={buscando} onClick={buscarTexto}>Buscar</Button>
            <Button icon={Crosshair} onClick={usarGps}>Mi ubicación</Button>
          </div>
          <MapPicker value={pin} onChange={moverPin} height={380} disabled={!puede}
            references={otras.filter((o) => o.lat != null && o.lng != null).map((o) => ({ lat: o.lat!, lng: o.lng!, label: o.label }))} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
            <span>
              {pin ? <>Pin <span className="font-mono">{numero(pin.lat, 5)}, {numero(pin.lng, 5)}</span> · </> : "Haz clic en el mapa para poner el pin. "}
              {pin && <Badge tone={geocodeBajo ? "warn" : "ok"}>{ORIGEN_PIN[origen.movido && origen.fuente === "GEOCODE" ? "MAP" : origen.fuente] ?? origen.fuente}
                {origen.fuente === "GEOCODE" && !origen.movido && origen.confianza != null ? ` · confianza ${numero(origen.confianza, 2)}` : ""}</Badge>}
            </span>
            <span className="flex items-center gap-2">
              <Input aria-label="Coordenadas" value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="-12.1325, -76.9921" className="!min-h-8 h-8 w-[180px] text-[12.5px]" />
              <Button size="sm" onClick={usarCoordenadas}>Usar</Button>
            </span>
          </div>
          {geocodeBajo && <Alert tone="warn">El pin salió de la búsqueda por texto con poca confianza: muévelo al lugar exacto para confirmarlo (RN-CLI-05).</Alert>}
          <AvisoZona z={zona} />
        </section>

        <section className="grid content-start gap-4 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><Alert tone="bad">{error}</Alert></div>}
          <Field label="Nombre de la dirección" hint="Casa, Oficina, Restaurante…" error={errores.label}><Input value={v.label} onChange={(e) => set("label")(e.target.value)} placeholder="Casa" /></Field>
          <Field label="Distrito" required error={errores.district}>
            <Select value={v.district} onChange={(e) => set("district")(e.target.value)} placeholder="Elige el distrito"
              options={[...new Set([...distritos, ...(v.district ? [v.district] : [])])].map((d) => ({ value: d, label: d }))} />
          </Field>
          <Field label="Dirección" required hint="Calle y número, interior o piso" error={errores.address_line} className="sm:col-span-2">
            <Input value={v.address_line} onChange={(e) => set("address_line")(e.target.value)} />
          </Field>
          <Field label="Referencia" required hint={`Mínimo ${minRef} caracteres: lo que ve el motorizado al llegar (${v.reference.trim().length}/${minRef})`} error={errores.reference} className="sm:col-span-2">
            <Textarea value={v.reference} onChange={(e) => set("reference")(e.target.value)} placeholder="Frente al parque, portón negro" />
          </Field>
          <Field label="Quién recibe" hint="Si se deja vacío, el cliente" error={errores.contact_name}><Input value={v.contact_name} onChange={(e) => set("contact_name")(e.target.value)} /></Field>
          <Field label="Celular de quien recibe" error={errores.contact_phone}><Input inputMode="tel" value={v.contact_phone} onChange={(e) => set("contact_phone")(e.target.value)} placeholder={celular(cliente.phone)} /></Field>
          <div className="sm:col-span-2">
            <Checkbox checked={v.is_default} onChange={set("is_default")} label="Dirección predeterminada" hint="La que se propone primero en un pedido nuevo." disabled={!otras.length && !a} />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button onClick={() => router.back()}>Cancelar</Button>
            <Button type="submit" variant="primary" icon={Save} loading={guardando} disabled={!puede}>Guardar dirección</Button>
          </div>
        </section>
      </form>
    </div>
  );
}
