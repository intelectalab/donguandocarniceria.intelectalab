"use client";

import { useState } from "react";
import { Field, Select } from "@/components/ui";
import { useSesion } from "@/lib/sesion";
import { Seccion } from "@/modulos/ped/Seccion";
import { SelectorProductos } from "@/modulos/ped/SelectorProductos";
import { useOpciones } from "@/modulos/ped/usePedido";
import { CANALES } from "@/modulos/ped/tipos";

/**
 * PED-04 Selector de productos: el mismo buscador que usa «Nuevo pedido», para consultar precio
 * vigente por canal, corte, modo de venta y stock del local sin armar un pedido.
 */
export default function Selector() {
  const { me, marca: marcaSup, local: localSup } = useSesion();
  const op = useOpciones();
  const [marca, setMarca] = useState(marcaSup !== "ALL" ? marcaSup : me.user.default_brand_id ?? "");
  const [canal, setCanal] = useState("WHATSAPP");
  const [local, setLocal] = useState(localSup !== "ALL" ? localSup : "");
  const marcas = (op?.marcas ?? []).filter((m) => !me.brands.length || me.brands.some((b) => b.id === m.id));

  return (
    <div className="space-y-4">
      <Seccion>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Marca" required>
            <Select value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Elige la marca" options={marcas.map((m) => ({ value: m.id, label: m.name }))} />
          </Field>
          <Field label="Canal" hint="El precio puede cambiar por canal.">
            <Select value={canal} onChange={(e) => setCanal(e.target.value)} options={CANALES} />
          </Field>
          <Field label="Local" hint="Para ver su stock disponible.">
            <Select value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Todos los locales" options={(op?.locales ?? []).map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
        </div>
      </Seccion>
      <Seccion titulo="Productos">
        <SelectorProductos marca={marca} canal={canal} local={local || undefined} />
      </Seccion>
    </div>
  );
}
