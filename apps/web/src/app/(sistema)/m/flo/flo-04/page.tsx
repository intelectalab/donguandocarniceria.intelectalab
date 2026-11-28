"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CalendarPlus, Gauge, Pencil } from "lucide-react";
import { Alert, Badge, Button, Cifra, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import { Bloqueos, ErrorCarga, Estado, Seccion, Vacio, useDatos, useOpciones } from "@/modulos/flo/comunes";
import { ALERTA, JORNADA, MULTA, PLAN, RENDIMIENTO, SEMAFORO, hoyLima, num, type Alerta } from "@/modulos/flo/tipos";

type Perfil = {
  internal_code: string | null; make: string | null; model: string | null; year: number | null; color: string | null; tank_capacity_gal: string | number;
  expected_km_per_gal: string | number; temp_mode: string | null; temp_min_c: string | number | null; temp_max_c: string | number | null; gps_source: string;
  gps_device_id: string | null; temp_sensor_id: string | null; purchase_date: string | null; purchase_cost: string | number | null; residual_value: string | number | null;
  useful_life_months: number | null; op_status: string; virtual?: boolean;
};
type Ficha = {
  vehiculo: { id: string; plate: string; etiqueta: string; tipo: string; modalidad: string; ownership: string; fuel_type: string | null; capacity_kg: string | null; local: string | null;
    proveedor: string | null; rental_daily_rate: string | null; refrigerated: boolean; status: string; establishment_id: string };
  perfil: Perfil; odometro: number; rango: { min: number | null; max: number } | null; bloqueos: string[];
  ultima_llena: { km_per_gal: number; loaded_at: string; efficiency_status: string } | null; minimo_kmpg: number;
  costo_mes: { total: number; por_km: number | null; por_entrega: number | null; km: number; combustible: number; mantenimiento: number; depreciacion: number; conductor: number } | null;
  documentos: { doc_type: string; tipo: string; id: string | null; number: string | null; expires_on: string | null; semaforo: string }[];
  planes: { id: string; code: string; task: string; estado: string; next_due_km: number | null; next_due_on: string | null; km_restante: number | null; dias_restantes: number | null }[];
  jornadas: { id: string; number: string; trip_date: string; status: string; km_odometer: string | null; km_gps: string | null; deliveries: number | null; conductor: string | null }[];
  cargas: { id: string; number: string; loaded_at: string; odometer_km: string; gallons: string; amount: string; full_tank: boolean; km_per_gal: string | null; efficiency_status: string }[];
  ordenes: { id: string; number: string; kind: string; description: string; opened_on: string; done_on: string | null; status: string; total_amount: string }[];
  multas: { id: string; ballot_number: string; fine_date: string; infraction: string; amount: string; status: string; charged_to_driver: boolean }[];
  alertas: Alerta[];
  lecturas: { id: string; read_at: string; km: number; origen: string; reason: string | null; previous_km: string | null }[];
  jornada_abierta: { id: string; number: string } | null;
};

const SEM = { ...SEMAFORO, MISSING: ["Falta registrar", "bad"] } as typeof SEMAFORO;

/** FLO-04 Ficha del vehículo: datos técnicos, tanque y rendimiento esperado, rango de frío, GPS, odómetro, documentos e historial. */
export default function FichaVehiculo() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const { datos: op, error: errOp } = useOpciones();
  if (errOp) return <ErrorCarga error={errOp} que="La ficha del vehículo es del coordinador de delivery." />;
  if (!id) {
    return (
      <div className="space-y-4">
        <PageHeader description="Elige un vehículo para ver su ficha: datos técnicos, odómetro, documentos, mantenimiento, cargas y costo del mes." />
        {!op ? <Vacio>Cargando…</Vacio> : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {op.vehiculos.map((v) => (
              <button key={v.id} type="button" onClick={() => router.push(`/m/flo/flo-04?id=${v.id}`)} className="cursor-pointer rounded-xl border border-line bg-surface p-4 text-left shadow-card hover:border-primary">
                <span className="flex items-start justify-between gap-2"><span className="text-[15px] font-semibold text-ink">{v.etiqueta}</span>
                  {v.bloqueos.length ? <Badge tone="bad">No sale</Badge> : <Badge tone="ok">Operativo</Badge>}</span>
                <span className="mt-1 block text-[12.5px] text-muted">{v.tipo} · {v.modalidad} · {v.local}</span>
                <span className="mt-2 block text-[13px]">{numero(v.odometro, 1)} km · tanque {numero(v.tank_capacity_gal, 1)} gal · {numero(v.expected_km_per_gal, 0)} km/gal</span>
                {v.bloqueos.length > 0 && <span className="mt-1 block text-[12px] text-bad">{v.bloqueos[0]}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return <Ficha id={id} />;
}

function Ficha({ id }: { id: string }) {
  const { datos: op } = useOpciones();
  const { datos: f, error, cargando, recargar } = useDatos<Ficha>(`/v1/flo/vehiculos/${id}`);
  const [tab, setTab] = useState<"documentos" | "mantenimiento" | "jornadas" | "cargas" | "multas" | "odometro">("documentos");
  const [modal, setModal] = useState<"perfil" | "programar" | "tablero" | null>(null);
  if (error) return <ErrorCarga error={error} que="La ficha del vehículo es del coordinador de delivery." />;
  if (cargando || !f) return <Vacio>Cargando…</Vacio>;
  const v = f.vehiculo;
  const p = f.perfil;
  const per = op?.permisos;
  return (
    <div className="space-y-4">
      <PageHeader description={`${v.tipo} · ${v.modalidad}${v.proveedor ? ` de ${v.proveedor}` : ""} · ${v.local ?? ""}`}
        actions={<>
          <Link href="/m/flo/flo-04" className="text-[13px] font-medium text-primary hover:underline">Todos los vehículos</Link>
          {per?.mantenimiento && <Button icon={Pencil} onClick={() => setModal("perfil")}>Editar ficha</Button>}
          {per?.vivo && <Button icon={CalendarPlus} variant="primary" onClick={() => setModal("programar")}>Asignar a ruta</Button>}
          {per?.tablero && <Button icon={Gauge} onClick={() => setModal("tablero")}>Cambio de tablero</Button>}
        </>} />
      <h2 className="text-xl font-bold text-ink">{v.etiqueta}</h2>
      <Bloqueos lista={f.bloqueos} />
      {p.virtual && <Alert tone="warn" title="Ficha sin completar">Se usan los valores por defecto de su tipo ({numero(num(p.tank_capacity_gal), 1)} gal, {numero(num(p.expected_km_per_gal), 0)} km/gal). Complétala para que el rendimiento y el tope del tanque sean los reales.</Alert>}
      {f.jornada_abierta && <Alert tone="info">Está en la jornada {f.jornada_abierta.number}. <Link className="font-medium text-primary hover:underline" href={`/m/flo/flo-02?vehiculo=${v.id}`}>Ver recorrido</Link></Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Odómetro" valor={`${numero(f.odometro, 1)} km`} detalle="última lectura" destacada />
        <Cifra titulo="Último rendimiento" valor={f.ultima_llena ? `${numero(f.ultima_llena.km_per_gal, 1)} km/gal` : "—"} detalle={`esperado ${numero(num(p.expected_km_per_gal), 0)} · mínimo ${numero(f.minimo_kmpg, 1)}`}
          tono={f.ultima_llena?.efficiency_status === "LOW" ? "bad" : undefined} />
        <Cifra titulo="Costo del mes" valor={f.costo_mes ? soles(f.costo_mes.total) : "—"} detalle={f.costo_mes?.por_km ? `${soles(f.costo_mes.por_km)} por km` : f.costo_mes ? "sin km aún" : "lo ve gerencia"} />
        <Cifra titulo="Alertas abiertas" valor={String(f.alertas.length)} detalle={f.alertas[0]?.title ?? "ninguna"} tono={f.alertas.some((a) => a.severity === "bad") ? "bad" : f.alertas.length ? "warn" : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Datos técnicos">
          <DetailList items={[
            { label: "Código interno", value: p.internal_code }, { label: "Placa", value: v.plate },
            { label: "Marca y modelo", value: [p.make, p.model].filter(Boolean).join(" ") || "—" }, { label: "Año y color", value: [p.year, p.color].filter(Boolean).join(" · ") || "—" },
            { label: "Combustible", value: v.fuel_type === "DIESEL" ? "Diésel" : v.fuel_type === "GASOLINE" ? "Gasolina" : v.fuel_type ?? "—" },
            { label: "Capacidad de carga", value: v.capacity_kg ? `${numero(v.capacity_kg, 0)} kg` : "—" },
            { label: "Tanque", value: `${numero(num(p.tank_capacity_gal), 2)} gal (tope ${numero(Number(p.tank_capacity_gal) * (op?.parametros.factor_tanque ?? 1.05), 2)})` },
            { label: "Rendimiento esperado", value: `${numero(num(p.expected_km_per_gal), 1)} km/gal` },
            { label: "Frío", value: f.rango ? `${p.temp_mode === "FROZEN" ? "Congelado" : "Refrigerado"} · ${f.rango.min ?? "—"} a ${f.rango.max} °C${p.temp_sensor_id ? ` · sensor ${p.temp_sensor_id}` : ""}` : "No refrigerado" },
            { label: "GPS", value: `${p.gps_source === "DEVICE" ? "Equipo GPS" : "App Android"}${p.gps_device_id ? ` · ${p.gps_device_id}` : ""}` },
            ...(v.ownership === "OWN" ? [
              { label: "Compra", value: p.purchase_cost ? `${soles(p.purchase_cost)} · ${fecha(p.purchase_date)}` : "—" },
              { label: "Depreciación", value: p.useful_life_months && p.purchase_cost ? `${soles((Number(p.purchase_cost) - Number(p.residual_value ?? 0)) / p.useful_life_months)} al mes (${p.useful_life_months} meses)` : "—" },
            ] : [{ label: "Alquiler", value: v.rental_daily_rate ? `${soles(v.rental_daily_rate)} por día` : "—" }]),
          ]} />
        </Seccion>
        <Seccion titulo="Alertas abiertas" acciones={<Link className="text-[13px] font-medium text-primary hover:underline" href={`/m/flo/flo-14?vehiculo=${v.id}`}>Bandeja</Link>}>
          {f.alertas.length === 0 ? <Vacio>Sin alertas abiertas.</Vacio> : (
            <ul className="space-y-2">{f.alertas.map((a) => <li key={a.id} className="flex items-start justify-between gap-2 text-[13px]"><span>{a.title}</span><StatusBadge status={a.status} labels={ALERTA} /></li>)}</ul>
          )}
        </Seccion>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "documentos", label: "Documentos", count: f.documentos.length }, { key: "mantenimiento", label: "Mantenimiento", count: f.planes.length },
        { key: "jornadas", label: "Jornadas", count: f.jornadas.length }, { key: "cargas", label: "Cargas", count: f.cargas.length },
        { key: "multas", label: "Multas", count: f.multas.length }, { key: "odometro", label: "Odómetro", count: f.lecturas.length },
      ]} />
      <Seccion>
        {tab === "documentos" && <Lista vacio="Sin documentos." filas={f.documentos.map((d) => [d.tipo, d.number ?? "—", d.expires_on ? `vence ${fecha(d.expires_on)}` : "", <Estado key="e" s={d.semaforo} labels={SEM} />])} pie={<Link className="text-primary hover:underline" href="/m/flo/flo-09">Ir a Documentos</Link>} />}
        {tab === "mantenimiento" && <Lista vacio="Sin planes de mantenimiento." filas={f.planes.map((x) => [x.task, x.code, [x.next_due_km !== null ? `${numero(x.next_due_km, 0)} km` : null, x.next_due_on ? fecha(x.next_due_on) : null].filter(Boolean).join(" o ") || "—", <Estado key="e" s={x.estado} labels={PLAN} />])}
          pie={<><Link className="text-primary hover:underline" href={`/m/flo/flo-07?vehiculo=${v.id}`}>Planes</Link> · <Link className="text-primary hover:underline" href={`/m/flo/flo-08?vehiculo=${v.id}`}>Órdenes ({f.ordenes.length})</Link></>} />}
        {tab === "jornadas" && <Lista vacio="Sin jornadas." filas={f.jornadas.map((j) => [`${fecha(j.trip_date)} · ${j.number}`, j.conductor ?? "—", j.km_odometer ? `${numero(j.km_odometer, 1)} km · ${j.deliveries ?? 0} entregas` : "—", <Estado key="e" s={j.status} labels={JORNADA} />])} pie={<Link className="text-primary hover:underline" href="/m/flo/flo-03">Jornadas</Link>} />}
        {tab === "cargas" && <Lista vacio="Sin cargas." filas={f.cargas.map((c) => [`${fechaHora(c.loaded_at)} · ${c.number}`, `${numero(c.gallons, 3)} gal · ${soles(c.amount)}`, c.km_per_gal ? `${numero(c.km_per_gal, 1)} km/gal` : c.full_tank ? "base" : "parcial", <Estado key="e" s={c.efficiency_status} labels={RENDIMIENTO} />])} pie={<Link className="text-primary hover:underline" href={`/m/flo/flo-05?vehiculo=${v.id}`}>Cargas de combustible</Link>} />}
        {tab === "multas" && <Lista vacio="Sin multas." filas={f.multas.map((m) => [`${fecha(m.fine_date)} · ${m.ballot_number}`, m.infraction, soles(m.amount), <Estado key="e" s={m.status} labels={MULTA} />])} pie={<Link className="text-primary hover:underline" href="/m/flo/flo-10">Multas</Link>} />}
        {tab === "odometro" && <Lista vacio="Sin lecturas." filas={f.lecturas.map((l) => [fechaHora(l.read_at), l.origen, `${numero(l.km, 1)} km`, l.reason ? <span key="r" className="text-[12px] text-muted">{l.reason}</span> : ""])} />}
      </Seccion>
      {modal === "perfil" && <EditarPerfil f={f} onClose={() => setModal(null)} onListo={() => { setModal(null); recargar(); }} />}
      {modal === "programar" && <Programar f={f} onClose={() => setModal(null)} onListo={() => { setModal(null); recargar(); }} />}
      {modal === "tablero" && <CambioTablero f={f} onClose={() => setModal(null)} onListo={() => { setModal(null); recargar(); }} />}
    </div>
  );
}

function Lista({ filas, vacio, pie }: { filas: React.ReactNode[][]; vacio: string; pie?: React.ReactNode }) {
  if (!filas.length) return <><Vacio>{vacio}</Vacio>{pie && <p className="mt-3 text-[13px]">{pie}</p>}</>;
  return (
    <>
      <ul className="divide-y divide-line">
        {filas.map((f, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2 text-[13px] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
            <span className="font-medium text-ink">{f[0]}</span><span className="justify-self-end sm:order-last">{f[3]}</span>
            <span className="text-muted sm:text-ink">{f[1]}</span><span className="text-muted sm:text-ink">{f[2]}</span>
          </li>
        ))}
      </ul>
      {pie && <p className="mt-3 text-[13px]">{pie}</p>}
    </>
  );
}

function useEnvio(onListo: () => void, ok: string) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  async function enviar(fn: () => Promise<unknown>) {
    setGuardando(true);
    setError("");
    try {
      await fn();
      toast.ok(ok);
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return { guardando, error, enviar };
}

function EditarPerfil({ f, onClose, onListo }: { f: Ficha; onClose: () => void; onListo: () => void }) {
  const p = f.perfil;
  const s = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  const [v, setV] = useState({
    internal_code: s(p.internal_code), make: s(p.make), model: s(p.model), year: s(p.year), color: s(p.color), tank_capacity_gal: s(num(p.tank_capacity_gal)),
    expected_km_per_gal: s(num(p.expected_km_per_gal)), temp_mode: s(p.temp_mode), temp_min_c: s(num(p.temp_min_c)), temp_max_c: s(num(p.temp_max_c)), gps_source: p.gps_source || "APP_ANDROID",
    purchase_date: s(p.purchase_date), purchase_cost: s(num(p.purchase_cost)), residual_value: s(num(p.residual_value)), useful_life_months: s(p.useful_life_months),
  });
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  const { guardando, error, enviar } = useEnvio(onListo, "Ficha guardada.");
  function guardar(e: FormEvent) {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === "" ? null : ["internal_code", "make", "model", "color", "temp_mode", "gps_source", "purchase_date"].includes(k) ? x : Number(x)]));
    enviar(() => api(`/v1/flo/vehiculos/${f.vehiculo.id}/perfil`, { method: "PUT", body }));
  }
  return (
    <Modal open onClose={onClose} title={`Ficha de ${f.vehiculo.plate}`} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-perfil" loading={guardando}>Guardar</Button></>}>
      <form id="f-perfil" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Código interno" required><Input value={v.internal_code} maxLength={20} onChange={(e) => pon("internal_code", e.target.value.toUpperCase())} /></Field>
          <Field label="Año"><Input type="number" value={v.year} onChange={(e) => pon("year", e.target.value)} /></Field>
          <Field label="Marca"><Input value={v.make} maxLength={60} onChange={(e) => pon("make", e.target.value)} /></Field>
          <Field label="Modelo"><Input value={v.model} maxLength={80} onChange={(e) => pon("model", e.target.value)} /></Field>
          <Field label="Color"><Input value={v.color} maxLength={30} onChange={(e) => pon("color", e.target.value)} /></Field>
          <Field label="GPS"><Select value={v.gps_source} onChange={(e) => pon("gps_source", e.target.value)} options={[{ value: "APP_ANDROID", label: "App Android" }, { value: "DEVICE", label: "Equipo GPS" }]} /></Field>
          <Field label="Tanque (gal)" required><Input type="number" step="0.001" value={v.tank_capacity_gal} onChange={(e) => pon("tank_capacity_gal", e.target.value)} /></Field>
          <Field label="Rendimiento esperado (km/gal)" required><Input type="number" step="0.1" value={v.expected_km_per_gal} onChange={(e) => pon("expected_km_per_gal", e.target.value)} /></Field>
        </div>
        {f.vehiculo.refrigerated && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Frío"><Select value={v.temp_mode} onChange={(e) => pon("temp_mode", e.target.value)} options={[{ value: "CHILLED", label: "Refrigerado" }, { value: "FROZEN", label: "Congelado" }]} /></Field>
            <Field label="Mínimo °C"><Input type="number" step="0.1" value={v.temp_min_c} onChange={(e) => pon("temp_min_c", e.target.value)} /></Field>
            <Field label="Máximo °C"><Input type="number" step="0.1" value={v.temp_max_c} onChange={(e) => pon("temp_max_c", e.target.value)} /></Field>
          </div>
        )}
        {f.vehiculo.ownership === "OWN" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha de compra"><Input type="date" value={v.purchase_date} onChange={(e) => pon("purchase_date", e.target.value)} /></Field>
            <Field label="Costo de compra (S/)"><Input type="number" step="0.01" value={v.purchase_cost} onChange={(e) => pon("purchase_cost", e.target.value)} /></Field>
            <Field label="Valor residual (S/)"><Input type="number" step="0.01" value={v.residual_value} onChange={(e) => pon("residual_value", e.target.value)} /></Field>
            <Field label="Vida útil (meses)"><Input type="number" value={v.useful_life_months} onChange={(e) => pon("useful_life_months", e.target.value)} /></Field>
          </div>
        )}
      </form>
    </Modal>
  );
}

function Programar({ f, onClose, onListo }: { f: Ficha; onClose: () => void; onListo: () => void }) {
  const { datos: op } = useOpciones();
  const [dia, setDia] = useState(hoyLima());
  const [chofer, setChofer] = useState("");
  const [ruta, setRuta] = useState("");
  const { datos: rutas } = useDatos<{ data: { id: string; code: string; vehicle_id: string | null }[] }>(op?.permisos.planificar ? `/v1/flo/vehiculos/${f.vehiculo.id}/rutas?fecha=${dia}` : null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const { guardando, error, enviar } = useEnvio(onListo, "Listo.");
  function guardar(e: FormEvent) {
    e.preventDefault();
    enviar(async () => {
      const r = await api<{ warnings: string[] }>(`/v1/flo/vehiculos/${f.vehiculo.id}/programar`, { method: "POST", body: { date: dia, driver_user_id: chofer || null, route_id: ruta || null } });
      setAvisos(r.warnings);
      if (r.warnings.length) toast.info(r.warnings.join(" "));
    });
  }
  return (
    <Modal open onClose={onClose} title={`Asignar ${f.vehiculo.plate}`} description="Revisa que pueda salir ese día (RN-FLO-11) y la licencia del conductor (RN-FLO-12)." dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-prog" loading={guardando}>{ruta ? "Asignar a la ruta" : "Programar jornada"}</Button></>}>
      <form id="f-prog" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        {avisos.map((a) => <Alert key={a} tone="warn">{a}</Alert>)}
        <Field label="Fecha" required><Input type="date" value={dia} min={hoyLima()} onChange={(e) => { setDia(e.target.value); setRuta(""); }} /></Field>
        <Field label="Conductor" required={Boolean(ruta)}><Select value={chofer} onChange={(e) => setChofer(e.target.value)} placeholder="Elige" options={(op?.conductores ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        {op?.permisos.planificar && (
          <Field label="Ruta de reparto (DEL)" hint="Opcional. Sin ruta, queda una jornada programada para ese día.">
            <Select value={ruta} onChange={(e) => setRuta(e.target.value)} placeholder="Sin ruta" options={(rutas?.data ?? []).map((r) => ({ value: r.id, label: `${r.code}${r.vehicle_id ? " (ya tiene vehículo)" : ""}` }))} />
          </Field>
        )}
      </form>
    </Modal>
  );
}

function CambioTablero({ f, onClose, onListo }: { f: Ficha; onClose: () => void; onListo: () => void }) {
  const [km, setKm] = useState("");
  const [motivo, setMotivo] = useState("");
  const { guardando, error, enviar } = useEnvio(onListo, "Cambio de tablero registrado.");
  return (
    <Modal open onClose={onClose} title="Cambio de tablero" description={`El odómetro de ${f.vehiculo.plate} empieza de nuevo desde la lectura que registres (RN-FLO-04).`} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-tab" loading={guardando}>Registrar</Button></>}>
      <form id="f-tab" className="space-y-3" onSubmit={(e) => { e.preventDefault(); enviar(() => api(`/v1/flo/vehiculos/${f.vehiculo.id}/cambio-tablero`, { method: "POST", body: { km: Number(km), reason: motivo } })); }}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Alert tone="warn">Úsalo solo si se cambió o reparó el tablero. La lectura anterior era {numero(f.odometro, 1)} km.</Alert>
        <Field label="Lectura del tablero nuevo (km)" required><Input type="number" step="0.1" value={km} onChange={(e) => setKm(e.target.value)} required /></Field>
        <Field label="Motivo" required hint="Al menos 10 caracteres: taller, fecha y qué se cambió."><Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} required /></Field>
      </form>
    </Modal>
  );
}
