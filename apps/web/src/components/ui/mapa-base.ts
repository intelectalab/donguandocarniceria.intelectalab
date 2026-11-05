import type * as Leaflet from "leaflet";

// Piezas comunes de MapPicker y MapView: las calles de OpenStreetMap y los íconos.

export type LatLng = { lat: number; lng: number };

/** Lima, para cuando todavía no hay ningún punto. */
export const LIMA: LatLng = { lat: -12.0464, lng: -77.0428 };

/** Calles de OpenStreetMap. Si no carga ninguna imagen, avisa con onFallo (sin internet, bloqueado…). */
export function capaOsm(L: typeof Leaflet, onFallo: () => void) {
  let cargadas = 0;
  let errores = 0;
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
  })
    .on("tileload", () => { cargadas += 1; })
    .on("tileerror", () => {
      errores += 1;
      if (!cargadas && errores === 3) onFallo();
    });
}

/** Color primario del tema actual (para dibujar dentro del mapa, que no ve las clases de Tailwind). */
export const colorPrimario = () => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#922242";

/** Pin en forma de gota; la punta queda sobre el punto. */
export function iconoPin(L: typeof Leaflet, color: string) {
  return L.divIcon({
    className: "", iconSize: [22, 22], iconAnchor: [11, 26],
    html: `<span style="display:block;width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`,
  });
}

/** Etiqueta corta en un punto (código del local, nombre de la zona…); con encimaDePin, sobre el pin. */
export function iconoEtiqueta(L: typeof Leaflet, texto: string, { encimaDePin = false } = {}) {
  const seguro = texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return L.divIcon({
    className: "", iconSize: [0, 0],
    html: `<span style="display:inline-block;transform:translate(-50%,${encimaDePin ? "-46px" : "-50%"});white-space:nowrap;padding:2px 7px;border-radius:6px;background:rgba(29,29,29,.78);color:#fff;font:600 11px/1.4 system-ui;box-shadow:0 1px 3px rgba(0,0,0,.3)">${seguro}</span>`,
  });
}

/**
 * Opciones comunes: la rueda del mouse hace zoom. El mapa se reajusta solo si cambia el tamaño de
 * su caja (la grilla de la pantalla termina de acomodarse después de crearlo, o se abre un panel).
 */
export function crearMapa(L: typeof Leaflet, caja: HTMLElement, alCambiarTamano?: () => void) {
  const m = L.map(caja, { scrollWheelZoom: true, wheelPxPerZoomLevel: 90 });
  const observador = new ResizeObserver(() => {
    m.invalidateSize();
    alCambiarTamano?.();
  });
  observador.observe(caja);
  m.on("unload", () => observador.disconnect());
  return m;
}

/** Encuadra todos los puntos (o centra en Lima si no hay ninguno). */
export function encuadrar(L: typeof Leaflet, m: Leaflet.Map, puntos: LatLng[], zoomUno = 15) {
  if (puntos.length > 1) m.fitBounds(L.latLngBounds(puntos.map((p) => [p.lat, p.lng])), { padding: [36, 36], maxZoom: 15 });
  else if (puntos.length === 1) m.setView([puntos[0].lat, puntos[0].lng], zoomUno);
  else m.setView([LIMA.lat, LIMA.lng], 11);
}
