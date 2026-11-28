"use client";

import { useState } from "react";
import Link from "next/link";
import { Save } from "lucide-react";
import { Alert, Button, Field, PageHeader, Switch, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio, useDatos } from "@/modulos/fac/comunes";
import { Impreso, useLogo } from "@/modulos/fac/Impreso";
import { type Empresa, type Ficha, type Marca } from "@/modulos/fac/tipos";

type Lista = { empresa: Empresa | null; marcas: (Marca & { muestra_id: string | null })[] };

/** FAC-11 Plantillas impresas: por marca, logo, color, pie legal y leyendas, con vista previa en A4 y 80 mm. */
export default function Plantillas() {
  const { datos: d, error, cargando, recargar } = useDatos<Lista>("/v1/fac/plantillas");
  const [elegida, setElegida] = useState("");
  if (cargando) return <Vacio>Cargando…</Vacio>;
  if (error || !d) return <Alert tone="bad">{error || "No se pudieron cargar las plantillas."}</Alert>;
  const m = d.marcas.find((x) => x.id === elegida) ?? d.marcas[0];
  return (
    <div className="space-y-4">
      <PageHeader description={<>Cada marca imprime con su logo, su color, su pie legal y sus leyendas. La razón social y el RUC son siempre los de la empresa emisora{d.empresa ? ` (${d.empresa.razon_social}, RUC ${d.empresa.ruc})` : ""}. El logo y el color se cambian en <Link href="/m/plt/plt-05" className="font-medium text-primary underline">Marcas</Link>.</>} />
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {d.marcas.map((x) => (
          <button key={x.id} type="button" onClick={() => setElegida(x.id)} aria-pressed={x.id === m?.id}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] ${x.id === m?.id ? "border-primary bg-primary-soft font-semibold text-primary" : "border-line bg-surface text-ink hover:bg-surface-2"}`}>
            {x.name}
          </button>
        ))}
      </div>
      {m ? <Editor key={m.id} m={m} alGuardar={recargar} /> : <Vacio>No hay marcas activas.</Vacio>}
    </div>
  );
}

function Editor({ m, alGuardar }: { m: Lista["marcas"][number]; alGuardar: () => void }) {
  const { puede } = useSesion();
  const [pie, setPie] = useState(m.pie ?? "");
  const [leyendas, setLeyendas] = useState(m.leyendas ?? "");
  const [logo, setLogo] = useState(m.mostrar_logo);
  const [formato, setFormato] = useState<"A4" | "80">("A4");
  const [guardando, setGuardando] = useState(false);
  const { datos: muestra, cargando } = useDatos<Ficha>(m.muestra_id ? `/v1/fac/comprobantes/${m.muestra_id}` : null);
  const urlLogo = useLogo(m.id, m.logo && logo);
  const edita = puede("FAC", "E");
  const sinRuc = pie.trim() !== "" && !/ruc/i.test(pie);

  async function guardar() {
    setGuardando(true);
    try {
      await api(`/v1/fac/plantillas/${m.id}`, { method: "PUT", body: { legal_footer: pie.trim(), print_legends: leyendas.trim() || null, print_show_logo: logo } });
      toast.ok(`Plantilla de ${m.name} guardada.`);
      alGuardar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  const vista: Ficha | null = muestra ? { ...muestra, marca: { ...(muestra.marca ?? m), pie: pie.trim() || null, leyendas: leyendas.trim() || null, mostrar_logo: logo } } : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(300px,1fr)_minmax(0,1.6fr)]">
      <Seccion titulo={m.name} className="h-fit">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <span className="size-4 rounded-full border border-line" style={m.color ? { background: m.color } : undefined} aria-hidden="true" />
            Color de la marca {m.color ?? "sin definir"} · {m.logo ? "con logo" : "sin logo cargado"}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13.5px]">Mostrar el logo en el impreso</span>
            <Switch checked={logo} onChange={setLogo} label="Mostrar el logo" disabled={!edita || !m.logo} />
          </div>
          <Field label="Pie legal" hint="Obligatorio. Menciona la razón social y el RUC de la empresa emisora." error={pie.trim() === "" ? "El pie legal es obligatorio." : sinRuc ? "Debe mencionar el RUC de la empresa." : undefined}>
            <Textarea rows={3} maxLength={255} value={pie} disabled={!edita} onChange={(e) => setPie(e.target.value)} />
          </Field>
          <Field label="Leyendas" hint="Opcional: «Gracias por su compra», horario, redes…">
            <Textarea rows={2} maxLength={255} value={leyendas} disabled={!edita} onChange={(e) => setLeyendas(e.target.value)} />
          </Field>
          {edita
            ? <Button variant="primary" icon={Save} loading={guardando} disabled={pie.trim() === "" || sinRuc} onClick={guardar}>Guardar plantilla</Button>
            : <Alert tone="info">Tu rol ve las plantillas pero no las edita.</Alert>}
        </div>
      </Seccion>
      <Seccion titulo="Vista previa" acciones={<div className="flex gap-1">
        <Button size="sm" variant={formato === "A4" ? "primary" : "secondary"} onClick={() => setFormato("A4")}>A4</Button>
        <Button size="sm" variant={formato === "80" ? "primary" : "secondary"} onClick={() => setFormato("80")}>80 mm</Button>
      </div>}>
        {!m.muestra_id ? <Vacio>Aún no hay un comprobante aceptado de esta marca para mostrar de ejemplo.</Vacio>
          : cargando || !vista ? <Vacio>Cargando el ejemplo…</Vacio>
          : <div className="overflow-x-auto"><Impreso f={vista} formato={formato} logo={urlLogo} /></div>}
      </Seccion>
    </div>
  );
}
