"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button, Checkbox, DetailList, Field, Input, Modal, Select, Textarea, toast } from "@/components/ui";
import { api, apiImagen, erroresDe, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import type { Empresa, Marca } from "./tipos";

type Valores = {
  company_id: string; code: string; name: string; primary_color: string; whatsapp_display_name: string; website: string;
  description: string; legal_footer: string; print_legends: string; print_show_logo: boolean; sort_order: string; status: string;
};

/** Crear o editar una marca (PLT-05). Se monta al abrir. */
export function MarcaForm({ marca, empresas, siguienteOrden, onClose, onGuardada }:
  { marca: Marca | null; empresas: Empresa[]; siguienteOrden: number; onClose: () => void; onGuardada: () => void }) {
  const [v, setV] = useState<Valores>(() => ({
    company_id: marca?.company_id ?? empresas[0]?.id ?? "", code: marca?.code ?? "", name: marca?.name ?? "",
    primary_color: marca?.primary_color ?? "#922242", whatsapp_display_name: marca?.whatsapp_display_name ?? "",
    website: marca?.website ?? "", description: marca?.description ?? "", legal_footer: marca?.legal_footer ?? "",
    print_legends: marca?.print_legends ?? "", print_show_logo: marca?.print_show_logo ?? true,
    sort_order: String(marca?.sort_order ?? siguienteOrden), status: marca?.status ?? "ACTIVE",
  }));
  const [series, setSeries] = useState<string[] | null>(null);
  // Logo: el archivo nuevo elegido, o quitar el que tiene. Se sube después de guardar la marca.
  const [logo, setLogo] = useState<{ archivo: File | null; quitar: boolean }>({ archivo: null, quitar: false });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = <K extends keyof Valores>(campo: K) => (valor: Valores[K]) => setV((x) => ({ ...x, [campo]: valor }));
  const separada = marca?.status === "SEPARATED";

  // Las series propias solo vienen en el detalle.
  useEffect(() => {
    if (!marca) return;
    let vigente = true;
    api<Marca>(`/v1/plt/marcas/${marca.id}`).then((m) => vigente && setSeries(m.series ?? [])).catch(() => vigente && setSeries([]));
    return () => { vigente = false; };
  }, [marca]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const body = {
        ...v, sort_order: Number(v.sort_order), website: v.website || null, description: v.description || null,
        print_legends: v.print_legends || null,
      };
      const guardada = await api<Marca>(marca ? `/v1/plt/marcas/${marca.id}` : "/v1/plt/marcas", { method: marca ? "PUT" : "POST", body });
      try {
        if (logo.archivo) {
          const datos = new FormData();
          datos.append("logo", logo.archivo);
          await api(`/v1/plt/marcas/${guardada.id}/logo`, { method: "POST", body: datos });
        } else if (logo.quitar && marca?.logo_url) {
          await api(`/v1/plt/marcas/${guardada.id}/logo`, { method: "DELETE" });
        }
      } catch (err) {
        // La marca ya quedó guardada: solo falló el logo.
        toast.error(`${marca ? "Marca actualizada" : "Marca creada"}, pero el logo no se guardó: ${mensajeDe(err)}`);
        onGuardada();
        return;
      }
      toast.ok(marca ? "Marca actualizada" : "Marca creada");
      onGuardada();
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} size="lg"
      title={marca ? marca.name : "Nueva marca"}
      footer={<>
        <Button onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button type="submit" form="f-marca" variant="primary" loading={guardando}>{marca ? "Guardar cambios" : "Crear marca"}</Button>
      </>}>
      <form id="f-marca" onSubmit={guardar} noValidate className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad sm:col-span-2">{error}</p>}
        <Field label="Código" required error={errores.code}
          hint={marca ? "No cambia: lo usan las series, los productos y los reportes." : "De 2 a 6 letras o números. No cambia después."}>
          <Input value={v.code} onChange={(e) => set("code")(e.target.value.toUpperCase())} maxLength={6} disabled={Boolean(marca)}
            className="font-mono uppercase" />
        </Field>
        <Field label="Nombre" required error={errores.name}>
          <Input value={v.name} onChange={(e) => set("name")(e.target.value)} maxLength={40} />
        </Field>
        <Field label="Empresa que factura" required error={errores.company_id} className="sm:col-span-2">
          <Select value={v.company_id} onChange={(e) => set("company_id")(e.target.value)}
            options={empresas.map((c) => ({ value: c.id, label: `${c.legal_name} · ${c.ruc}` }))} />
        </Field>
        <Field label="Nombre en WhatsApp" required error={errores.whatsapp_display_name} hint="Es el que ve el cliente en el chat.">
          <Input value={v.whatsapp_display_name} onChange={(e) => set("whatsapp_display_name")(e.target.value)} maxLength={40} />
        </Field>
        <Field label="Web" error={errores.website}>
          <Input value={v.website} onChange={(e) => set("website")(e.target.value)} maxLength={40} placeholder="www.donguando.com" />
        </Field>
        <Field label="Color principal" required error={errores.primary_color} hint="Se usa en chips, etiquetas y reportes.">
          <div className="flex items-center gap-2">
            <input type="color" aria-label="Elegir color" value={/^#[0-9a-f]{6}$/i.test(v.primary_color) ? v.primary_color : "#922242"}
              onChange={(e) => set("primary_color")(e.target.value.toUpperCase())}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-[9px] border border-line bg-surface p-1" />
            <Input value={v.primary_color} onChange={(e) => set("primary_color")(e.target.value.toUpperCase())} maxLength={7} className="font-mono uppercase" />
          </div>
        </Field>
        <Field label="Orden" required error={errores.sort_order} hint="Posición en los selectores.">
          <Input type="number" min={1} max={999} value={v.sort_order} onChange={(e) => set("sort_order")(e.target.value)} />
        </Field>
        <Logo marca={marca} cambio={logo} onCambio={setLogo} />
        <Field label="Qué vende" error={errores.description} className="sm:col-span-2">
          <Input value={v.description} onChange={(e) => set("description")(e.target.value)} maxLength={500} placeholder="Carnes de granja: cuy, conejo, aves…" />
        </Field>
        <Field label="Pie legal del comprobante" required error={errores.legal_footer} hint="Sale al pie de la representación impresa."
          className="sm:col-span-2">
          <Textarea value={v.legal_footer} onChange={(e) => set("legal_footer")(e.target.value)} maxLength={255} rows={2} />
        </Field>
        <Field label="Leyendas del impreso" error={errores.print_legends} hint="Una por línea: conservación, teléfono de pedidos…"
          className="sm:col-span-2">
          <Textarea value={v.print_legends} onChange={(e) => set("print_legends")(e.target.value)} maxLength={255} rows={2} />
        </Field>
        <Field label="Estado" required error={errores.status}>
          {separada ? (
            <Input value="Separada de la empresa" disabled />
          ) : (
            <Select value={v.status} onChange={(e) => set("status")(e.target.value)}
              options={[{ value: "ACTIVE", label: "Activa" }, { value: "INACTIVE", label: "Inactiva" }]} />
          )}
        </Field>
        <div className="self-end pb-2">
          <Checkbox checked={v.print_show_logo} onChange={set("print_show_logo")} label="Logo en el comprobante impreso" />
        </div>
        {v.status !== "ACTIVE" && (
          <p className="text-[12.5px] text-muted sm:col-span-2">
            Una marca {separada ? "separada" : "inactiva"} no aparece en los selectores ni admite documentos nuevos. Sus documentos anteriores se siguen consultando.
          </p>
        )}
      </form>

      {marca && (
        <section className="mt-6 border-t border-line pt-4">
          <h3 className="mb-3 text-[14px] font-semibold">Uso de la marca</h3>
          <DetailList items={[
            { label: "Pedidos", value: numero(marca.orders_count) },
            { label: "Comprobantes", value: numero(marca.documents_count) },
            { label: "Productos", value: numero(marca.products_count) },
            { label: "Series propias", value: series === null ? "…" : series.join(", ") || "Ninguna" },
            { label: "Colores", value: marca.theme_name ? `Tema propio: ${marca.theme_name}` : "Usa los de la empresa" },
          ]} />
        </section>
      )}
    </Modal>
  );
}

const TIPOS_LOGO = ["image/png", "image/jpeg", "image/webp"];

/** Logo de la marca: vista previa, elegir otro o quitarlo. El cambio se guarda con la marca. */
function Logo({ marca, cambio, onCambio }:
  { marca: Marca | null; cambio: { archivo: File | null; quitar: boolean }; onCambio: (c: { archivo: File | null; quitar: boolean }) => void }) {
  const [actual, setActual] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const entrada = useRef<HTMLInputElement>(null);

  // El logo guardado viene de la API con el token; se muestra como URL local y se libera al cerrar.
  useEffect(() => {
    if (!marca?.logo_url) return;
    let url: string | null = null;
    let vigente = true;
    apiImagen(`/v1/plt/marcas/${marca.id}/logo`).then((u) => { url = u; if (vigente) setActual(u); });
    return () => { vigente = false; if (url) URL.revokeObjectURL(url); };
  }, [marca]);
  useEffect(() => () => { if (nuevo) URL.revokeObjectURL(nuevo); }, [nuevo]);

  function elegir(archivo: File | undefined) {
    if (!archivo) return;
    if (!TIPOS_LOGO.includes(archivo.type)) return setAviso("El logo debe ser una imagen PNG, JPG o WEBP.");
    if (archivo.size > 1024 * 1024) return setAviso("El logo no puede pesar más de 1 MB.");
    setAviso("");
    setNuevo(URL.createObjectURL(archivo));
    onCambio({ archivo, quitar: false });
  }

  const vista = cambio.archivo ? nuevo : cambio.quitar ? null : actual;
  const tiene = Boolean(cambio.archivo || (marca?.logo_url && !cambio.quitar));

  return (
    <Field label="Logo" error={aviso || undefined} className="sm:col-span-2"
      hint={cambio.archivo ? "Se guarda al guardar la marca." : cambio.quitar ? "Se quita al guardar la marca." : "PNG, JPG o WEBP de hasta 1 MB. Mejor con fondo transparente."}>
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-line bg-surface-2/60">
          {vista ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen local (blob) del logo subido.
            <img src={vista} alt="Logo de la marca" className="max-h-14 max-w-24 object-contain" />
          ) : (
            <span className="text-[12px] text-muted">{tiene ? "…" : "Sin logo"}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={entrada} type="file" accept={TIPOS_LOGO.join(",")} className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ""; }} />
          <Button size="sm" icon={ImagePlus} onClick={() => entrada.current?.click()}>{tiene ? "Cambiar" : "Subir logo"}</Button>
          {tiene && (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onCambio({ archivo: null, quitar: Boolean(marca?.logo_url) })}>Quitar</Button>
          )}
        </div>
      </div>
    </Field>
  );
}
