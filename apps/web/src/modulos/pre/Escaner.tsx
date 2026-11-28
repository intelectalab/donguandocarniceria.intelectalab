"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, CameraOff, ScanLine } from "lucide-react";
import { Button } from "@/components/ui";

/** Detector de códigos del navegador (Chrome en Android). Donde no existe, se escanea con la pistola o se digita. */
type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type ClaseDetector = new (o?: { formats?: string[] }) => Detector;

let audio: AudioContext | null = null;

/** Pitido corto: agudo si la lectura es correcta, grave y doble si se bloqueó. */
export function sonar(ok: boolean) {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    const tonos = ok ? [[880, 0, 0.12]] : [[220, 0, 0.18], [180, 0.22, 0.25]];
    for (const [f, ini, dur] of tonos) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = ok ? "sine" : "square";
      o.frequency.value = f;
      g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + ini);
      o.stop(ctx.currentTime + ini + dur);
    }
    if (!ok) navigator.vibrate?.([120, 60, 120]);
  } catch {
    // sin audio (navegador sin permiso): el color de la pantalla basta
  }
}

/**
 * Caja de escaneo: queda con el foco para la pistola lectora (que escribe y pulsa Enter). Con la cámara del
 * celular, si el navegador sabe leer códigos, cada lectura se envía sola.
 */
export function Escaner({ onLeer, ocupado, placeholder = "Escanea o escribe el código", extra, deshabilitado }: {
  onLeer: (codigo: string) => void | Promise<void>; ocupado?: boolean; placeholder?: string; extra?: ReactNode; deshabilitado?: boolean;
}) {
  const [codigo, setCodigo] = useState("");
  const [camara, setCamara] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hayDetector = typeof window !== "undefined" && "BarcodeDetector" in window;

  // El foco vuelve a la caja después de cada lectura, para seguir con la pistola sin tocar la pantalla.
  useEffect(() => {
    if (!ocupado && !deshabilitado) input.current?.focus();
  }, [ocupado, deshabilitado]);

  function enviar(valor: string) {
    const v = valor.trim();
    if (!v || ocupado) return;
    setCodigo("");
    void onLeer(v);
  }

  return (
    <div className="space-y-2">
      <form onSubmit={(e) => { e.preventDefault(); enviar(codigo); }} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <ScanLine size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input ref={input} value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder={placeholder} aria-label="Código escaneado"
            autoComplete="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="go" disabled={deshabilitado}
            className="h-12 w-full rounded-[10px] border-2 border-line bg-surface pr-3 pl-10 font-mono text-[16px] text-ink outline-none focus:border-primary disabled:opacity-60" />
        </div>
        <Button type="submit" variant="primary" loading={ocupado} disabled={deshabilitado || !codigo.trim()} className="h-12">Leer</Button>
        {hayDetector && (
          <Button icon={camara ? CameraOff : Camera} onClick={() => setCamara(!camara)} className="h-12" aria-label={camara ? "Apagar cámara" : "Usar cámara"}>
            <span className="hidden sm:inline">{camara ? "Apagar" : "Cámara"}</span>
          </Button>
        )}
      </form>
      {extra}
      {camara && <Camara onLeer={enviar} pausa={Boolean(ocupado)} />}
    </div>
  );
}

function Camara({ onLeer, pausa }: { onLeer: (c: string) => void; pausa: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const ultimo = useRef({ codigo: "", t: 0 });
  const enPausa = useRef(pausa);
  const leer = useRef(onLeer);

  useEffect(() => {
    enPausa.current = pausa;
    leer.current = onLeer;
  });

  useEffect(() => {
    let flujo: MediaStream | null = null;
    let vivo = true;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const Clase = (window as unknown as { BarcodeDetector: ClaseDetector }).BarcodeDetector;
    const detector = new Clase({ formats: ["code_128", "ean_13", "ean_8", "qr_code", "code_39"] });

    async function ciclo() {
      if (!vivo || !video.current) return;
      if (!enPausa.current && video.current.readyState >= 2) {
        try {
          const [c] = await detector.detect(video.current);
          const ahora = Date.now();
          // La misma etiqueta frente a la cámara no se envía dos veces seguidas (2,5 s).
          if (c?.rawValue && (c.rawValue !== ultimo.current.codigo || ahora - ultimo.current.t > 2500)) {
            ultimo.current = { codigo: c.rawValue, t: ahora };
            leer.current(c.rawValue);
          }
        } catch {
          // cuadro sin código
        }
      }
      espera = setTimeout(ciclo, 250);
    }

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        if (!vivo) { s.getTracks().forEach((t) => t.stop()); return; }
        flujo = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        void ciclo();
      })
      .catch(() => setError("No se pudo abrir la cámara. Revisa el permiso del navegador o usa la pistola lectora."));

    return () => {
      vivo = false;
      clearTimeout(espera);
      flujo?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (error) return <p className="text-[13px] text-bad">{error}</p>;
  return <video ref={video} muted playsInline className="aspect-video w-full rounded-[10px] border border-line bg-surface-2 object-cover" />;
}
