"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Eraser, Mic, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";

/** Reduce la foto a 1280 px y la pasa a JPEG en base64: viaja bien sin señal y cabe en la cola del teléfono. */
export async function aDataUrl(f: File, max = 1280): Promise<string> {
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error("No se pudo leer la foto."));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.72);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Botón de cámara: toma la foto (o la elige) y la entrega en base64, con su vista previa. */
export function Foto({ valor, onChange, texto = "Tomar foto" }: { valor: string | null; onChange: (v: string | null) => void; texto?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try { setError(""); onChange(await aDataUrl(f)); } catch (x) { setError(x instanceof Error ? x.message : "No se pudo leer la foto."); }
        }} />
      {valor ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={valor} alt="Foto tomada" className="h-20 w-20 rounded-lg border border-line object-cover" />
          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onChange(null)}>Quitar</Button>
        </div>
      ) : (
        <Button icon={Camera} onClick={() => input.current?.click()}>{texto}</Button>
      )}
      {error && <p className="text-[12.5px] text-bad">{error}</p>}
    </div>
  );
}

/** Firma con el dedo sobre la pantalla; entrega un PNG en base64. */
export function Firma({ onChange }: { onChange: (v: string | null) => void }) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const [hay, setHay] = useState(false);

  useEffect(() => {
    const c = lienzo.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.width = Math.round(r.width * 2);
    c.height = Math.round(r.height * 2);
    const g = c.getContext("2d");
    if (g) { g.scale(2, 2); g.lineWidth = 2.2; g.lineCap = "round"; g.strokeStyle = "#111"; g.fillStyle = "#fff"; g.fillRect(0, 0, r.width, r.height); }
  }, []);

  const punto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  function limpiar() {
    const c = lienzo.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    setHay(false);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <canvas ref={lienzo} aria-label="Firma del cliente" className="h-36 w-full touch-none rounded-lg border border-line bg-white"
        onPointerDown={(e) => { dibujando.current = true; const [x, y] = punto(e); const g = e.currentTarget.getContext("2d"); g?.beginPath(); g?.moveTo(x, y); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!dibujando.current) return; const [x, y] = punto(e); const g = e.currentTarget.getContext("2d"); g?.lineTo(x, y); g?.stroke(); if (!hay) setHay(true); }}
        onPointerUp={(e) => { dibujando.current = false; if (hay) onChange(e.currentTarget.toDataURL("image/png")); }} />
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted">{hay ? "Firma lista" : "El cliente firma con el dedo"}</span>
        <Button size="sm" variant="ghost" icon={Eraser} onClick={limpiar}>Borrar</Button>
      </div>
    </div>
  );
}

/** Codifica la grabación como WAV mono de 16 bits (el sistema acepta WAV, MP3 y OGG; no WEBM). */
function wav(muestras: Float32Array[], tasa: number): Blob {
  const n = muestras.reduce((s, m) => s + m.length, 0);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const txt = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  txt(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); txt(8, "WAVE"); txt(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, tasa, true); v.setUint32(28, tasa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  txt(36, "data"); v.setUint32(40, n * 2, true);
  let o = 44;
  for (const m of muestras) for (let i = 0; i < m.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, m[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

/** Graba un audio corto con el micrófono (máximo 2 minutos) y lo entrega como archivo WAV con sus segundos. */
export function Grabadora({ onListo }: { onListo: (a: { archivo: File; segundos: number } | null) => void }) {
  const [grabando, setGrabando] = useState(false);
  const [seg, setSeg] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const sesion = useRef<{ ctx: AudioContext; stream: MediaStream; proc: ScriptProcessorNode; datos: Float32Array[]; inicio: number; timer: number } | null>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function empezar() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const datos: Float32Array[] = [];
      proc.onaudioprocess = (e) => datos.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(proc);
      proc.connect(ctx.destination);
      const inicio = Date.now();
      const timer = window.setInterval(() => {
        const s = Math.round((Date.now() - inicio) / 1000);
        setSeg(s);
        if (s >= 120) void parar();
      }, 500);
      sesion.current = { ctx, stream, proc, datos, inicio, timer };
      setGrabando(true);
      onListo(null);
    } catch {
      setError("No se pudo usar el micrófono: revisa el permiso del navegador.");
    }
  }

  async function parar() {
    const s = sesion.current;
    if (!s) return;
    sesion.current = null;
    window.clearInterval(s.timer);
    s.proc.disconnect();
    s.stream.getTracks().forEach((t) => t.stop());
    const tasa = s.ctx.sampleRate;
    await s.ctx.close();
    const segundos = Math.max(1, Math.round((Date.now() - s.inicio) / 1000));
    const blob = wav(s.datos, tasa);
    setGrabando(false);
    setUrl(URL.createObjectURL(blob));
    onListo({ archivo: new File([blob], `audio-${Date.now()}.wav`, { type: "audio/wav" }), segundos });
  }

  return (
    <div className="space-y-2">
      {grabando ? (
        <Button variant="danger" icon={Square} onClick={() => void parar()}>Detener ({seg} s)</Button>
      ) : (
        <Button icon={Mic} onClick={() => void empezar()}>{url ? "Grabar de nuevo" : "Grabar audio"}</Button>
      )}
      {url && !grabando && <audio controls src={url} className="w-full" />}
      {error && <p className="text-[12.5px] text-bad">{error}</p>}
    </div>
  );
}
