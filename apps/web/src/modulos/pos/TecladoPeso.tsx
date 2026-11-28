"use client";

import { useState } from "react";
import { Delete, Minus, Plus, ScanBarcode } from "lucide-react";
import { Alert, Button, Checkbox, Field, Input } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { kg, soles } from "@/lib/formato";
import { n, type Producto } from "./tipos";

export type PesoElegido = { weight_kg: string; qty: number; weight_source: "MANUAL" | "SCALE" | "LABEL"; barcode?: string; override: boolean };

const TECLAS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "."];

/**
 * POS-03 Ingreso de peso: teclado numérico con 3 decimales y el rango aceptado de la variante.
 * Con balanza conectada pide el peso estable (sin integración todavía, se digita lo que marca);
 * con etiqueta, lee el peso del código de barras de la balanza (RN-POS-06).
 */
export function TecladoPeso({ producto, modo, inicial, puedeForzar, onAceptar, onCancelar }: {
  producto: Producto; modo: "MANUAL" | "SCALE" | "LABEL"; inicial?: { weight_kg?: string; qty?: number };
  puedeForzar: boolean; onAceptar: (p: PesoElegido) => void; onCancelar?: () => void;
}) {
  const porUnidad = producto.sale_mode === "UNIT_VARIABLE_WEIGHT";
  const [texto, setTexto] = useState(inicial?.weight_kg ? String(Number(inicial.weight_kg)) : "");
  const [unidades, setUnidades] = useState(inicial?.qty ?? 1);
  const [codigo, setCodigo] = useState("");
  const [etiqueta, setEtiqueta] = useState<string | null>(null);
  const [forzar, setForzar] = useState(false);
  const [error, setError] = useState("");
  const [validando, setValidando] = useState(false);

  const min = producto.min_weight_kg !== null ? n(producto.min_weight_kg) : null;
  const max = producto.max_weight_kg !== null ? n(producto.max_weight_kg) : null;
  const peso = Number(texto || 0);
  const pesoUnidad = porUnidad && unidades > 0 ? peso / unidades : peso;
  const fuera = porUnidad && min !== null && max !== null && peso > 0 && (pesoUnidad < min - 0.0005 || pesoUnidad > max + 0.0005);

  function tecla(t: string) {
    setError("");
    setEtiqueta(null);
    setTexto((v) => {
      if (t === "." && v.includes(".")) return v;
      const nuevo = v === "0" && t !== "." ? t : v + t;
      const [, dec = ""] = nuevo.split(".");
      if (dec.length > 3 || nuevo.replace(".", "").length > 6) return v;
      return nuevo.startsWith(".") ? `0${nuevo}` : nuevo;
    });
  }

  async function leerEtiqueta() {
    if (!codigo.trim()) return;
    setError("");
    try {
      const r = await api<{ etiqueta: { weight_kg: string; barcode: string } }>("/v1/pos/codigo", { method: "POST", body: { code: codigo, variant_id: producto.id } });
      setTexto(String(Number(r.etiqueta.weight_kg)));
      setEtiqueta(r.etiqueta.barcode);
      setCodigo("");
    } catch (e) {
      setError(mensajeDe(e));
    }
  }

  async function aceptar() {
    setValidando(true);
    setError("");
    try {
      const r = await api<{ weight_kg: string }>("/v1/pos/peso", { method: "POST", body: { variant_id: producto.id, weight_kg: texto, qty: porUnidad ? unidades : 1, override: forzar } });
      onAceptar({ weight_kg: r.weight_kg, qty: porUnidad ? unidades : 1, weight_source: etiqueta ? "LABEL" : modo === "SCALE" ? "SCALE" : "MANUAL", barcode: etiqueta ?? undefined, override: forzar });
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setValidando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface-2/60 p-3">
        <div className="text-[13px] text-muted">{producto.name} · {producto.marca}</div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className={`text-[34px] leading-none font-semibold tabular-nums ${fuera ? "text-bad" : "text-ink"}`} aria-live="polite">
            {texto ? Number(texto).toFixed(3) : "0.000"} <span className="text-[16px] text-muted">kg</span>
          </span>
          {producto.precio !== null && peso > 0 && <span className="text-[15px] font-medium text-ink tabular-nums">{soles(Math.round(peso * Number(producto.precio) * 100) / 100)}</span>}
        </div>
        <div className="mt-1 text-[12.5px] text-muted">
          {min !== null && max !== null
            ? <>Rango aceptado: <b>{kg(min)} a {kg(max)}</b>{porUnidad ? " por unidad" : ""}{porUnidad && unidades > 1 && peso > 0 ? ` · ahora ${kg(pesoUnidad)} por unidad` : ""}</>
            : "Sin rango de peso: se acepta cualquier peso mayor que 0."}
          {producto.precio !== null && <> · {soles(producto.precio)} por kg</>}
        </div>
      </div>

      {modo === "SCALE" && (
        <Alert tone="info">La caja está en modo balanza conectada, pero la balanza todavía no está integrada: digita el peso estable que marca.</Alert>
      )}
      {modo === "LABEL" && (
        <div className="flex items-end gap-2">
          <Field label="Etiqueta de balanza" className="flex-1" hint="Escanea o digita el código de 13 dígitos que empieza con 2.">
            <Input value={codigo} inputMode="numeric" maxLength={13} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void leerEtiqueta(); } }} />
          </Field>
          <Button icon={ScanBarcode} onClick={leerEtiqueta} disabled={codigo.length !== 13}>Leer</Button>
        </div>
      )}
      {etiqueta && <p className="text-[12.5px] text-ok">Peso leído de la etiqueta {etiqueta}.</p>}

      {porUnidad && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
          <span className="text-[13.5px] text-ink">Unidades</span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Una unidad menos" disabled={unidades <= 1} onClick={() => setUnidades((u) => Math.max(1, u - 1))}
              className="flex size-10 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface disabled:opacity-40"><Minus size={16} /></button>
            <span className="w-8 text-center text-[16px] font-semibold tabular-nums">{unidades}</span>
            <button type="button" aria-label="Una unidad más" onClick={() => setUnidades((u) => Math.min(99, u + 1))}
              className="flex size-10 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface"><Plus size={16} /></button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {TECLAS.map((t) => (
          <button key={t} type="button" onClick={() => tecla(t)}
            className="h-14 cursor-pointer rounded-xl border border-line bg-surface text-[22px] font-medium text-ink shadow-card active:bg-surface-2">{t}</button>
        ))}
        <button type="button" aria-label="Borrar" onClick={() => { setTexto((v) => v.slice(0, -1)); setEtiqueta(null); setError(""); }}
          className="flex h-14 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface-2 text-ink active:bg-line"><Delete size={22} /></button>
      </div>

      {fuera && (
        <Alert tone="bad" title="Peso fuera del rango">
          {kg(pesoUnidad)} por unidad está fuera de {kg(min)} a {kg(max)}. Revisa el peso{puedeForzar ? " o acéptalo con tu permiso de supervisora." : " o pide a la supervisora que lo acepte."}
        </Alert>
      )}
      {fuera && puedeForzar && <Checkbox checked={forzar} onChange={setForzar} label="Aceptar este peso fuera de rango (queda registrado)" />}
      {error && <Alert tone="bad">{error}</Alert>}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancelar && <Button onClick={onCancelar}>Cancelar</Button>}
        <Button variant="primary" loading={validando} disabled={!(peso > 0) || (fuera && !forzar)} onClick={aceptar}>Aceptar peso</Button>
      </div>
    </div>
  );
}
