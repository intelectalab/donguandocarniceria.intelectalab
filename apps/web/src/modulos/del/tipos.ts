import type { Tone } from "@/components/ui";

/** Direcciones de las pantallas de DEL. */
export const R = {
  planificador: "/m/del/del-01", asignacion: "/m/del/del-02", hoja: "/m/del/del-03", app: "/m/del/del-04", parada: "/m/del/del-05",
  liquidacion: "/m/del/del-06", mapa: "/m/del/del-07", enlace: "/m/del/del-08", empresas: "/m/del/del-09", conciliacion: "/m/del/del-10",
  provincia: "/m/del/del-11", vehiculos: "/m/del/del-12", costos: "/m/del/del-13", costoEntrega: "/m/del/del-14", comparativo: "/m/del/del-15",
  noEntregados: "/m/del/del-16", gastos: "/m/del/del-17", ticket: "/m/del/del-18", direcciones: "/m/del/del-19", apoyo: "/m/del/del-20",
  mensajesApp: "/m/del/del-21", mensajes: "/m/del/del-22",
} as const;

export const RUTA: Record<string, [string, Tone]> = {
  PLANNED: ["Planificada", "neutral"], LOADING: ["Cargando", "info"], IN_ROUTE: ["En ruta", "primary"], RETURNED: ["De vuelta", "warn"],
  SETTLED: ["Liquidada", "ok"], CANCELLED: ["Cancelada", "bad"],
};
export const PARADA: Record<string, [string, Tone]> = {
  PENDING: ["Pendiente", "neutral"], ARRIVED: ["En el lugar", "info"], DELIVERED: ["Entregada", "ok"], FAILED: ["No entregada", "bad"],
  RESCHEDULED: ["Reprogramada", "warn"], CANCELLED: ["Quitada", "neutral"], HANDED_OFF: ["Con motorizado externo", "warn"],
};
export const PEDIDO: Record<string, [string, Tone]> = {
  CONFIRMED: ["Confirmado", "neutral"], IN_PREPARATION: ["En preparación", "info"], WEIGHED: ["Pesado", "info"], READY: ["Listo", "ok"],
  IN_ROUTE: ["En ruta", "primary"], DELIVERED: ["Entregado", "ok"], NOT_DELIVERED: ["No entregado", "bad"], CLOSED: ["Cerrado", "neutral"],
};
export const LIQUIDACION: Record<string, [string, Tone]> = {
  OPEN: ["Abierta", "neutral"], SETTLED: ["Liquidada", "ok"], WITH_DIFFERENCE: ["Con diferencia", "warn"], APPROVED: ["Aprobada", "ok"],
};
export const PROVINCIA: Record<string, [string, Tone]> = {
  PREPARED: ["Preparado", "neutral"], HANDED_TO_AGENCY: ["En la agencia", "info"], IN_TRANSIT: ["En tránsito", "primary"],
  DELIVERED: ["Entregado", "ok"], RETURNED: ["Devuelto", "warn"], LOST: ["Perdido", "bad"],
};
export const FACTURA: Record<string, [string, Tone]> = { RECONCILED: ["Conciliada", "ok"], OBSERVED: ["Observada", "warn"], PENDING: ["Pendiente", "neutral"] };
export const LINEA: Record<string, [string, Tone]> = {
  MATCHED: ["Coincide", "ok"], AMOUNT_DIFF: ["Monto distinto", "warn"], NOT_REGISTERED: ["No registrado", "bad"], NOT_BILLED: ["No facturado", "info"],
};
export const MENSAJE: Record<string, [string, Tone]> = { SENT: ["Por atender", "warn"], READ: ["Leído", "neutral"], CONFIRMED: ["Confirmado", "ok"], REJECTED: ["Rechazado", "bad"] };
export const APOYO: Record<string, [string, Tone]> = {
  REQUESTED: ["Pedido", "warn"], ASSIGNED: ["Asignado", "ok"], EXTERNAL: ["Externo autorizado", "info"], REJECTED: ["Rechazado", "bad"],
};
export const DERIVACION: Record<string, [string, Tone]> = { HANDED: ["Con el motorizado", "warn"], DELIVERED: ["Entregado", "ok"], FAILED: ["No entregado", "bad"] };
export const GASTO: Record<string, [string, Tone]> = { ACTIVE: ["Vigente", "ok"], VOIDED: ["Anulado", "bad"] };
export const NIVEL: Record<string, [string, Tone]> = { OK: ["Buena", "ok"], REVIEW: ["Revisar", "warn"], BAD: ["Mala", "bad"] };
export const DOC_TONO = (l: string): Tone => (l === "bad" ? "bad" : "warn");

export type Aviso = { level: string; msg: string };
export type Bolsa = { label: string; no: number; count: number; status: string; real: boolean; tipo?: string; kg?: number | null };

export type RutaResumen = {
  id: string; code: string; route_date: string; status: string; estado: string; mode: string; establishment_id: string; local: string | null; franja: string | null;
  vehicle_id: string | null; plate: string | null; driver_user_id: string | null; repartidor: string | null; carrier_supplier_id: string | null; empresa: string | null;
  driver_pay_mode: string | null; driver_pay_rate: number | null; paradas: number; hechas: number; entregadas: number; kg: number; cobrar: number; cobrado: number;
  planned_km: number; bolsas: number; cargadas: number; departed_at: string | null; returned_at: string | null; avisos: Aviso[];
  siguiente?: { id: string; seq: number; eta: string | null; pedido: string; cliente: string | null; direccion: string | null; distrito: string | null } | null;
};

export type Parada = {
  id: string; seq: number; status: string; estado: string; order_id: string; pedido: string; order_status: string; cliente: string | null; direccion: string | null;
  referencia: string | null; distrito: string | null; zona: string | null; lat: number; lng: number; con_pin: boolean; franja: string | null; eta: string | null; kg: number;
  bolsas: Bolsa[]; cobrar: number; cobrado: number; pendiente: number; medio: string | null; telefono: string; senal: string | null; notas: string | null;
  arrived_at: string | null; closed_at: string | null; fail_reason: string | null; motivo: string | null; pod_distance_m: number | null; distance_km: number | null;
  support_from: string | null; handoff_id: string | null; codigo: string | null; token: string | null;
};

export type Evento = { id: string; stop_id: string | null; event_type: string; occurred_at: string; notes: string | null; amount: number | null; usuario: string | null };

export type Esperado = {
  cobrado_efectivo: number; gastos_ruta: number; efectivo: number; digital: number; por_reembolsar: number;
  cobros: { id: string; number: string; amount: number; reference: string | null; medio: string; medio_nombre: string; seq: number | null }[];
  gastos: { id: string; number: string; category: string; amount: number; paid_with: string; note: string | null }[];
};

export type Liquidacion = {
  id: string; number: string; status: string; expected_cash: number; expected_digital: number; delivered_cash: number; difference: number;
  difference_reason: string | null; settled_at: string | null; settled_by: string | null; approved_by: string | null; approved_at: string | null;
};

export type Hoja = {
  ruta: RutaResumen & { local_nombre: string | null; capacity_kg: number | null; odometer_start: number | null; odometer_end: number | null; sequence_method: string;
    cancel_reason: string | null; odometro_vehiculo: number | null };
  paradas: Parada[]; eventos: Evento[]; local: [number, number]; posicion: { lat: number; lng: number; at: string; fuente: string } | null;
  riesgo: { abiertas: number; atraso_min: number; nivel: string; eta_ultima?: string }; liquidacion: Liquidacion | null;
  puede_salir: { ok: boolean; faltas: string[] }; liquidacion_esperada?: Esperado | null; warnings?: string[];
};

export type Opciones = {
  fecha: string; hoy: string;
  locales: { id: string; code: string; name: string; lat: number | null; lng: number | null }[];
  franjas: { id: string; establishment_id: string; zone_id: string | null; name: string; slot_from: string; slot_to: string }[];
  zonas: { id: string; establishment_id: string; code: string; name: string; province: boolean; delivery_fee: number }[];
  vehiculos: { id: string; plate: string; vehicle_type: string; ownership: string; status: string; capacity_kg: number | null; refrigerated: boolean;
    establishment_id: string; odometer_km: number; docs: { level: string; doc: string; msg: string }[] }[];
  repartidores: { id: string; name: string; employee_id: string | null; pago: { mode: string; rate: number } }[];
  empresas: { id: string; name: string; status: string }[];
  agencias: { id: string; trade_name: string | null; legal_name: string; supplier_type: string }[];
  modos: Record<string, string>; motivos: Record<string, string>; incidencias: Record<string, string>; medios: Record<string, string>; costos: Record<string, string>;
  tipos_vehiculo: Record<string, string>; combustibles: Record<string, string>; gastos: Record<string, string>; pagado_con: Record<string, string>;
  destinos: Record<string, string>; embalajes: Record<string, string>; bases_tarifa: Record<string, string>;
  parametros: { radio_m: number; intervalo_s: number; dias_aviso: number; tolerancia: number };
  puede: { planificar: boolean; manejar: boolean; seguir: boolean; empresas: boolean; conciliar: boolean; provincia: boolean; vehiculos: boolean; costos: boolean;
    ver_costos: boolean; liquidar: boolean; solo_sus_rutas: boolean };
};

/** Lista de opciones para un Select desde un diccionario código → nombre. */
export const lista = (d: Record<string, string> | undefined) => Object.entries(d ?? {}).map(([value, label]) => ({ value, label }));

export const hora = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "—";

export const mesLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

/** Enlace de navegación a la parada (Google Maps abre la app en el celular). */
export const navegar = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
