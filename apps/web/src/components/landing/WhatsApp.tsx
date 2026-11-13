// WhatsApp de ventas de GestionCarnica en la página pública. El número sale de NEXT_PUBLIC_WHATSAPP_VENTAS (solo
// dígitos, con el código del país: 51987654321); sin él, los botones no se muestran. El enlace abre
// WhatsApp (wa.me) con un mensaje listo, en otra pestaña y sin pasarle datos de esta página.

const NUMERO = (process.env.NEXT_PUBLIC_WHATSAPP_VENTAS ?? "").replace(/\D/g, "");
const MENSAJE = "Hola, quiero ver una demo de GestionCarnica";

/** Enlace a WhatsApp, o null si el número no está configurado o no es válido. */
export const enlaceWhatsApp = /^\d{8,15}$/.test(NUMERO) ? `https://wa.me/${NUMERO}?text=${encodeURIComponent(MENSAJE)}` : null;

function Icono({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.31l-.34-.2-3.57.93.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.01c0-5.2 4.24-9.43 9.44-9.43a9.4 9.4 0 0 1 6.67 2.77 9.37 9.37 0 0 1 2.76 6.67c0 5.2-4.24 9.43-9.44 9.43m8.03-17.46A11.3 11.3 0 0 0 12.05.7C5.8.7.7 5.79.7 12.05c0 2 .52 3.95 1.52 5.67L.6 23.3l5.71-1.5a11.33 11.33 0 0 0 5.73 1.46h.01c6.26 0 11.35-5.09 11.35-11.35 0-3.03-1.18-5.88-3.32-8.02" />
    </svg>
  );
}

/** Botón redondo fijo abajo a la derecha, como en el prototipo. */
export function BotonWhatsAppFlotante() {
  if (!enlaceWhatsApp) return null;
  return (
    <a href={enlaceWhatsApp} target="_blank" rel="noopener noreferrer" aria-label="Escríbenos por WhatsApp" title="Escríbenos por WhatsApp"
      className="fixed right-5 bottom-5 z-30 grid size-14 place-items-center rounded-full bg-[#25d366] text-white shadow-[0_10px_30px_rgba(37,211,102,.4)] transition-transform hover:scale-105">
      <Icono size={28} />
    </a>
  );
}

/** «Escríbenos por WhatsApp» como botón (en el cierre y en el pie). */
export function BotonWhatsApp({ claro = false }: { claro?: boolean }) {
  if (!enlaceWhatsApp) return null;
  return (
    <a href={enlaceWhatsApp} target="_blank" rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[15px] font-semibold transition-colors ${claro
        ? "border border-white/30 text-white hover:bg-white/10" : "bg-[#25d366] text-white hover:brightness-105"}`}>
      <Icono size={18} /> Escríbenos por WhatsApp
    </a>
  );
}
