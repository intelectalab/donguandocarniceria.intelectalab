"use client";

import { useId, useRef, useState } from "react";
import { Input } from "@/components/ui";
import { api } from "@/lib/api";

type Distrito = { code: string; department: string; province: string; district: string };

/**
 * Campo de ubigeo (6 dígitos INEI) con sugerencias de distritos: se escribe el código o el
 * nombre del distrito. Va dentro de un <Field>. `conocido` es el distrito que ya trae el registro.
 */
export function UbigeoInput({ value, onChange, conocido }:
  { value: string; onChange: (v: string) => void; conocido?: { code: string | null; district: string | null } }) {
  const listId = useId();
  const [opciones, setOpciones] = useState<Distrito[]>([]);
  const espera = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function cambiar(texto: string) {
    // Al elegir una sugerencia llega «150140 · Santiago de Surco»: se guarda solo el código.
    const codigo = /^(\d{6})\b/.exec(texto)?.[1];
    onChange(codigo ?? texto);
    clearTimeout(espera.current);
    if (texto.trim().length < 2) return;
    espera.current = setTimeout(() => {
      api<Distrito[]>(`/v1/plt/ubigeo?q=${encodeURIComponent(codigo ?? texto.trim())}`).then(setOpciones).catch(() => setOpciones([]));
    }, 250);
  }

  const elegido = opciones.find((o) => o.code === value);
  const nombre = elegido ? `${elegido.district}, ${elegido.province}` : conocido?.code === value ? conocido.district : null;

  return (
    <>
      <Input value={value} onChange={(e) => cambiar(e.target.value)} list={listId} inputMode="search" autoComplete="off"
        placeholder="Código o distrito" />
      {/^\d{6}$/.test(value) && nombre && <small className="text-[12px] text-ok">{nombre}</small>}
      <datalist id={listId}>
        {opciones.map((o) => <option key={o.code} value={`${o.code} · ${o.district}`}>{o.province}, {o.department}</option>)}
      </datalist>
    </>
  );
}
