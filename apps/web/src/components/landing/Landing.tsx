"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight, BarChart3, Bike, CalendarDays, CheckCircle2, Clock, Inbox, MessageCircleWarning, Package, Receipt, Scale,
  Snowflake, Store, Timer, Truck, type LucideIcon,
} from "lucide-react";
import { FUNCIONES } from "./Cabecera";
import { FormDemo } from "./FormDemo";
import { MarcoPublico, useMarco } from "./MarcoPublico";
import { BotonWhatsApp } from "./WhatsApp";
import { Planes } from "./Planes";
import { VistaBandeja, VistaBoleta, VistaCamara, VistaConsignacion, VistaMostrador, VistaRentabilidad, VistaRepartidor, VistaTablero } from "./Vistas";

// Textos de la página pública del prototipo nuevo, con el nombre de Aycha.

const PROBLEMAS: { icono: LucideIcon; titulo: string; texto: string; costo: string }[] = [
  { icono: MessageCircleWarning, titulo: "Pedidos perdidos en el chat", texto: "Audios de WhatsApp sin anotar, pedidos duplicados y clientes molestos esperando respuesta mientras atiendes el mostrador a toda prisa.", costo: "Ventas que se pierden" },
  { icono: Scale, titulo: "Diferencias de peso que nadie cobra", texto: "Cortes que pesan 1.250 kg pero se cobran como 1 kg al ojo, o mermas de hueso y grasa que se van a la basura sin registrar en tu caja.", costo: "Margen que se escapa" },
  { icono: Snowflake, titulo: "Carne que se vence en la cámara", texto: "Lotes antiguos olvidados al fondo de la conservadora. Nadie sabe qué ingresó primero, y lo que vence se termina botando.", costo: "Producto que se bota" },
  { icono: Bike, titulo: "Repartidores que no rinden cuentas", texto: "Cobros en efectivo no liquidados, reclamos por entregas tardías y rutas improvisadas que consumen combustible y gastan el tiempo de tu equipo.", costo: "Plata sin rendir" },
];

const MODULOS: { icono: LucideIcon; antetitulo: string; titulo: string; texto: string; puntos: string[]; vista: ReactNode }[] = [
  {
    icono: Inbox, antetitulo: "Pedidos y canales digitales", titulo: "Del chat de WhatsApp al pedido listo para preparar",
    texto: "La vendedora arma el pedido desde la conversación con el catálogo por categorías y el precio por kilo o por pieza. El pedido pasa a preparación y reparto sin volver a escribirlo.",
    puntos: ["Catálogo por categorías: res, cerdo, pollo, cuy, embutidos.", "Lista de preparación y etiqueta para cada bolsa.", "Pago por Yape o Plin validado contra la cuenta de la empresa.", "Enlace para que el cliente siga su pedido."],
    vista: <VistaBandeja />,
  },
  {
    icono: Scale, antetitulo: "Punto de venta en local", titulo: "Cobra por el peso real: cada gramo cuenta",
    texto: "Ingresas el peso y el sistema calcula el importe con la lista de precios del local y emite la boleta. Sin cálculos a mano ni cobros al ojo cuando hay cola.",
    puntos: ["Precio por kilo o por pieza según la lista de cada local.", "Pantalla táctil pensada para tablet en el mostrador.", "Cobro con Yape, Plin, tarjeta o efectivo, con vuelto calculado.", "Turno con apertura, retiros y cierre aprobado."],
    vista: <VistaMostrador />,
  },
  {
    icono: Truck, antetitulo: "Logística y despacho", titulo: "Rutas claras y repartidores que rinden cada sol al volver",
    texto: "Arma las rutas por zona y franja. El repartidor ve sus entregas en el celular o la tablet, va con Google Maps o Waze, registra cómo le pagaron y tú ves el avance en el mapa.",
    puntos: ["Liquidación del repartidor: efectivo, Yape y gastos de la ruta.", "Botones para ir con Google Maps o Waze, parada por parada.", "Rechazo parcial y devoluciones registradas en la entrega.", "Pagos a la cuenta de la empresa validados antes de salir."],
    vista: <VistaRepartidor />,
  },
  {
    icono: Snowflake, antetitulo: "Cámara de frío y rendimiento", titulo: "Control de despiece por canal y alertas automáticas de vencimiento",
    texto: "Registras el despiece de una canal de res o cerdo y ves cuántos kilos de cada corte obtuviste y cuánto te costó cada uno. Te avisa antes de que un lote venza.",
    puntos: ["Semáforo de vencimiento por lote y salida primero de lo que vence antes.", "Control de merma por oreo y desposte de res, cerdo y pollo.", "Lote en cada venta: si hay un retiro, sabes dónde está.", "Rendimiento por proveedor para saber qué ganado rinde más."],
    vista: <VistaCamara />,
  },
  {
    icono: Receipt, antetitulo: "Facturación electrónica", titulo: "Boletas y facturas electrónicas, y una caja que cuadra",
    texto: "Emite boletas, facturas, notas de crédito y guías de remisión desde el pedido o el mostrador. Cada turno cierra su caja y las diferencias pasan a aprobación.",
    puntos: ["Envío a SUNAT mediante un operador OSE autorizado.", "Boletas, facturas, notas de crédito y guías de remisión.", "Cierre de caja por turno con aprobación de diferencias.", "Control de cuentas por cobrar y fiados de clientes habituales."],
    vista: <VistaBoleta />,
  },
  {
    icono: BarChart3, antetitulo: "Reportes gerenciales", titulo: "Conoce qué corte te deja más ganancia y qué vendedora rinde más",
    texto: "Ventas sin IGV con su margen, comparadas con el mes anterior o el año pasado, por categoría, producto, local, canal y vendedora.",
    puntos: ["Margen por categoría, producto y local.", "Ventas por vendedora, día de la semana y hora.", "Productos ABC: los que hacen el 80 % de la venta.", "Exporta a Excel para tu contadora."],
    vista: <VistaRentabilidad />,
  },
  {
    icono: Store, antetitulo: "Ventas B2B y multicanal", titulo: "Tu tienda online y tu consignación, con el mismo stock",
    texto: "Si dejas embutidos o piezas en minimarkets, bodegas o restaurantes asociados, liquida cada semana los kilos vendidos sin perder la pista de lo que aún está en su vitrina.",
    puntos: ["Stock, precios y pedidos sincronizados con tus tiendas WooCommerce.", "Módulo de consignación para bodegas y minimarkets aliados.", "Lista de precios diferenciada: mayorista, restaurante y público.", "Guías de remisión para cada entrega en consignación."],
    vista: <VistaConsignacion />,
  },
];

const CAMBIOS: { icono: LucideIcon; antetitulo: string; titulo: string; texto: string }[] = [
  { icono: Scale, antetitulo: "Al gramo", titulo: "Cada venta con su peso real", texto: "El precio se calcula con lo que marca la balanza, sin redondeos a mano." },
  { icono: Truck, antetitulo: "En ruta", titulo: "Repartos con hora y firma", texto: "Ves qué pedido salió, quién lo lleva y cuándo se entregó." },
  { icono: Package, antetitulo: "Por lote", titulo: "Vencimientos a la vista", texto: "Primero sale lo que vence primero y las mermas quedan registradas." },
  { icono: Receipt, antetitulo: "Al día", titulo: "Caja y comprobantes cuadrados", texto: "Boletas, facturas y cierre de caja en el mismo sistema." },
];

const PASOS: { titulo: string; texto: string; icono: LucideIcon; nota: string }[] = [
  { titulo: "Crea tu cuenta con tu RUC", texto: "Te registras en 2 minutos, sin tarjeta. Eliges si empiezas con datos de ejemplo para explorar o con tu empresa vacía.", icono: Timer, nota: "Sin tarjeta" },
  { titulo: "Carga tu catálogo", texto: "Creas tus categorías (res, cerdo, pollo, cuy, embutidos) y cargas tus productos; las listas de precios se importan desde un archivo CSV.", icono: Package, nota: "Precios desde CSV" },
  { titulo: "Empieza a vender y repartir", texto: "Abre la caja en el mostrador y la app en los celulares de tus repartidores. Todo queda registrado al momento en tu panel.", icono: CheckCircle2, nota: "Te acompañamos por WhatsApp" },
];

const PREGUNTAS = [
  { p: "¿Aycha emite boletas y facturas electrónicas?", r: "Sí. Emites boletas, facturas y notas de crédito desde el mostrador o desde el pedido, con el peso real. Los comprobantes se envían a SUNAT a través de un operador de servicios electrónicos (OSE) autorizado." },
  { p: "¿Funciona con mi balanza?", r: "Puedes digitar el peso, conectar una balanza compatible a la computadora o leer la etiqueta con código de barras que imprimen las balanzas etiquetadoras. Antes de contratar te ayudamos a probar tu modelo." },
  { p: "¿Tengo que instalar algo?", r: "No. Funciona en el navegador de tu computadora, tablet o celular. Solo necesitas internet." },
  { p: "¿Qué pasa si se cae el internet?", r: "La app del repartidor sigue funcionando sin conexión y sube lo registrado cuando vuelve la señal. En el resto del sistema, lo que no se pudo guardar se reintenta solo y te avisa en pantalla." },
  { p: "¿Mis datos están seguros?", r: "Los datos de cada empresa están separados en la base de datos, las contraseñas se guardan cifradas, puedes activar la verificación en dos pasos y se hacen copias de seguridad automáticas." },
  { p: "¿Qué pasa cuando termina la prueba gratis?", r: "Tus datos se quedan guardados. Puedes verlos, pero para seguir registrando eliges un plan. No pedimos tarjeta para la prueba." },
  { p: "¿Hay contrato de permanencia?", r: "No. Pagas mes a mes y puedes cambiar de plan o cancelar cuando quieras." },
  { p: "¿Sirve si tengo varias marcas o locales?", r: "Sí. Cada plan incluye una cantidad de marcas y locales, y ves las ventas y el stock de cada uno por separado o juntos." },
  { p: "¿Se conecta con mi tienda en WordPress?", r: "Sí. En el plan Crecimiento conectas tu tienda WooCommerce: los pedidos entran solos y el stock se actualiza en la tienda. Los formularios y popups de tu web también entran como leads al CRM." },
  { p: "¿Cómo empiezo?", r: "Creas tu cuenta con tu RUC y eliges empezar con datos de ejemplo para practicar o en blanco con tus productos. Si prefieres, agenda una demo y te ayudamos por WhatsApp." },
];

function Antetitulo({ children, claro = false }: { children: ReactNode; claro?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-semibold tracking-[.08em] uppercase ${claro ? "bg-white/10 text-gold" : "bg-primary-soft text-primary"}`}>
      {children}
    </span>
  );
}

function Encabezado({ antetitulo, titulo, texto }: { antetitulo: string; titulo: string; texto?: string }) {
  return (
    <div className="mx-auto max-w-[760px] text-center">
      <Antetitulo>{antetitulo}</Antetitulo>
      <h2 className="mt-4 font-display text-[clamp(1.9rem,3.4vw,2.7rem)] leading-[1.12] font-bold tracking-[-0.02em]">{titulo}</h2>
      {texto && <p className="mt-3 text-[16px] leading-relaxed text-muted">{texto}</p>}
    </div>
  );
}

/**
 * Página pública de Aycha, con la distribución y los textos de la página del prototipo: portada con el
 * tablero del día, el costo del desorden, los módulos con su vista, lo que cambia, los 3 pasos, los planes
 * (de la API), las preguntas y el pedido de demo. «Pruébalo gratis» abre el pedido de demo hasta que
 * exista el registro de empresas.
 */
export default function Landing() {
  return <MarcoPublico actual="inicio"><ContenidoLanding /></MarcoPublico>;
}

function ContenidoLanding() {
  const { planes, pruebaDias: dias, cargando, plan, setPlan, pedirDemo } = useMarco();

  const botonPrueba = (texto = "Pruébalo gratis", grande = false) => (
    <button type="button" onClick={() => pedirDemo()}
      className={`inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary font-semibold text-primary-ink shadow-[0_10px_24px_rgba(110,20,35,.25)] transition-[filter] hover:brightness-110 ${grande ? "px-6 py-3.5 text-[15.5px]" : "px-4 py-2 text-[14px]"}`}>
      {texto}{grande && <ArrowRight size={18} />}
    </button>
  );

  return (
    <>
      {/* Portada */}
      <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 pt-12 pb-20 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:pt-16">
        <div>
          <Antetitulo><span className="size-1.5 rounded-full bg-primary" /> Software para el negocio de la carne</Antetitulo>
          <h1 className="mt-5 font-display text-[clamp(2.3rem,4.6vw,3.6rem)] leading-[1.06] font-bold tracking-[-0.025em]">
            Vende, reparte y factura tu carne <span className="text-primary">desde un solo lugar</span>
          </h1>
          <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-muted">
            Pedidos por WhatsApp, peso variable en el mostrador, rutas de reparto, lotes con vencimiento y boletas SUNAT. Sin instalar nada en tu computadora.
          </p>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[14px] font-medium">
            {[`${dias} días gratis sin tarjeta`, "Tus datos de ejemplo listos", "Soporte por WhatsApp"].map((t) => (
              <li key={t} className="flex items-center gap-1.5"><CheckCircle2 size={17} className="text-ok" />{t}</li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-3">
            {botonPrueba("Pruébalo gratis", true)}
            <button type="button" onClick={() => pedirDemo()} className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-6 py-3.5 text-[15.5px] font-semibold shadow-card transition-colors hover:bg-surface-2">
              <CalendarDays size={18} className="text-primary" /> Agenda una demo
            </button>
          </div>
        </div>
        <VistaTablero />
      </section>

      {/* El costo del desorden */}
      <section className="border-y border-line bg-surface-2/70">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
          <Encabezado antetitulo="El costo del desorden" titulo="¿Te suena familiar?" texto="El cuaderno de apuntes manchado, los mensajes de WhatsApp que se traspapelan y las cuentas que nunca cuadran al final del día." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PROBLEMAS.map(({ icono: Icono, titulo, texto, costo }) => (
              <article key={titulo} className="flex flex-col rounded-2xl border border-line bg-surface p-6 shadow-card">
                <span aria-hidden="true" className="grid size-11 place-items-center rounded-xl bg-bad-soft text-bad"><Icono size={21} /></span>
                <h3 className="mt-4 text-[16.5px] leading-snug font-semibold">{titulo}</h3>
                <p className="mt-2 flex-1 text-[14px] leading-relaxed text-muted">{texto}</p>
                <span className="mt-5 border-t border-line pt-3 text-[12.5px] font-semibold text-bad">{costo}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Módulos */}
      <section id="funciones" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 py-20 sm:px-6">
        <Encabezado antetitulo="Módulos creados para la carne" titulo="Todo lo que pasa en tu camal, mostrador y ruta bajo control" texto="Hecho para el día a día de carnicerías, avícolas, granjas de cuy y distribuidoras de carne." />
        <div className="mt-16 space-y-20 lg:space-y-24">
          {MODULOS.map(({ icono: Icono, antetitulo, titulo, texto, puntos, vista }, i) => (
            <div key={titulo} id={FUNCIONES[i]?.id} className="grid scroll-mt-28 items-center gap-10 lg:grid-cols-12 lg:gap-12">
              <div className={`lg:col-span-5 ${i % 2 ? "lg:order-2" : ""}`}>
                <Antetitulo><Icono size={13} /> {antetitulo}</Antetitulo>
                <h3 className="mt-4 font-display text-[clamp(1.6rem,2.6vw,2.1rem)] leading-[1.15] font-bold tracking-[-0.015em]">{titulo}</h3>
                <p className="mt-3 text-[16px] leading-relaxed text-muted">{texto}</p>
                <ul className="mt-5 space-y-2.5">
                  {puntos.map((p) => <li key={p} className="flex gap-2.5 text-[14.5px]"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ok" />{p}</li>)}
                </ul>
                <button type="button" onClick={() => pedirDemo()} className="mt-6 inline-flex cursor-pointer items-center gap-1.5 text-[14.5px] font-semibold text-primary hover:underline">
                  Pruébalo gratis <ArrowRight size={16} />
                </button>
              </div>
              {/* Como en el prototipo: el ejemplo ocupa 7 de 12 columnas, dentro de un marco beige. */}
              <div className={`rounded-[18px] bg-[#F7F2EA] p-4 shadow-sm sm:p-6 lg:col-span-7 ${i % 2 ? "lg:order-1" : ""}`}>{vista}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Lo que cambia */}
      <section className="border-y border-line bg-surface-2/70">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
          <Encabezado antetitulo="Lo que cambia" titulo="Lo que cambia desde la primera semana" />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CAMBIOS.map(({ icono: Icono, antetitulo, titulo, texto }) => (
              <article key={titulo} className="rounded-2xl border border-line bg-surface p-6 shadow-card">
                <span aria-hidden="true" className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary"><Icono size={21} /></span>
                <p className="mt-4 text-[12px] font-semibold tracking-[.08em] text-primary uppercase">{antetitulo}</p>
                <h3 className="mt-1 text-[16.5px] font-semibold">{titulo}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{texto}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section id="como-funciona" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 py-20 sm:px-6">
        <Encabezado antetitulo="Rápido y práctico" titulo="Empieza en 3 pasos sencillos" texto="Sin comprar servidores caros ni esperar semanas de instalación técnica." />
        <ol className="mt-12 grid gap-5 md:grid-cols-3">
          {PASOS.map(({ titulo, texto, icono: Icono, nota }, i) => (
            <li key={titulo} className="flex flex-col rounded-2xl border border-line bg-surface p-7 shadow-card">
              <span className="font-display text-[46px] leading-none font-bold text-primary/20">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-3 text-[17px] font-semibold">{titulo}</h3>
              <p className="mt-2 flex-1 text-[14.5px] leading-relaxed text-muted">{texto}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 self-start rounded-full bg-ok-soft px-3 py-1 text-[12.5px] font-semibold text-ok"><Icono size={14} />{nota}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Precios */}
      <section id="precios" className="scroll-mt-24 border-y border-line bg-surface-2/70">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
          <Encabezado antetitulo="Precios claros" titulo="Planes pensados para tu negocio" texto="Sin comisiones sobre lo que vendes ni cobros sorpresa a fin de mes." />
          <div className="mt-14"><Planes planes={planes} cargando={cargando} pruebaDias={dias} onElegir={pedirDemo} /></div>
          <p className="mt-10 text-center">
            <Link href="/precios" className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-primary hover:underline">
              Compara todo lo que incluye cada plan <ArrowRight size={16} />
            </Link>
          </p>
        </div>
      </section>

      {/* Preguntas */}
      <section id="preguntas" className="mx-auto max-w-[860px] scroll-mt-24 px-4 py-20 sm:px-6">
        <Encabezado antetitulo="Respuestas claras" titulo="Preguntas frecuentes" texto="Facturación, balanzas, internet, datos y soporte." />
        <div className="mt-10 divide-y divide-line rounded-2xl border border-line bg-surface shadow-card">
          {PREGUNTAS.map((q) => (
            <details key={q.p} className="group px-6 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-semibold">
                {q.p}
                <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-[18px] text-primary transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">{q.r}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Cierre y pedido de demo */}
      <section id="contacto" className="relative isolate scroll-mt-20 overflow-hidden bg-[#6e1423] text-white">
        <span aria-hidden="true" className="pointer-events-none absolute -top-40 -right-32 -z-10 size-[520px] rounded-full bg-[rgba(255,198,118,.18)] blur-[120px]" />
        <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <h2 className="font-display text-[clamp(2rem,3.6vw,3rem)] leading-[1.08] font-bold tracking-[-0.02em]">Ordena tu negocio de carne esta misma semana</h2>
            <p className="mt-4 max-w-[46ch] text-[17px] leading-relaxed text-white/85">
              Pruébalo {dias} días con tus productos y tu equipo. Si prefieres, te lo mostramos en una llamada de 20 minutos.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button type="button" onClick={() => pedirDemo()} className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-gold px-6 py-3.5 text-[15.5px] font-bold transition-[filter] hover:brightness-105" style={{ color: "var(--franja-base)" }}>
                Empezar prueba gratis <ArrowRight size={18} />
              </button>
              <BotonWhatsApp claro />
            </div>
            <ul className="mt-8 space-y-2.5 text-[15px] text-white/85">
              {["Te escribimos por WhatsApp para coordinar el día y la hora", "La demo es con tus propios cortes y productos", "Sin tarjeta ni contrato de permanencia"].map((t) => (
                <li key={t} className="flex items-center gap-2.5"><Clock size={16} className="text-gold" />{t}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl bg-surface p-6 text-ink shadow-[0_30px_70px_rgba(0,0,0,.3)] sm:p-8">
            <h3 className="font-display text-[22px] font-bold">Agenda una demo</h3>
            <p className="mt-1 text-[14px] text-muted">Te escribimos por WhatsApp para coordinar el día y la hora.</p>
            <div className="mt-5"><FormDemo planes={planes} plan={plan} onPlan={setPlan} /></div>
          </div>
        </div>
      </section>

    </>
  );
}
