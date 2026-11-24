"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Pencil, Plus, Save, Send } from "lucide-react";
import { Badge, Button, confirmAction, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, toast, type Column, type Tone } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { erroresDe, mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { useOrdenLocal } from "@/lib/paginas";
import { soles } from "@/lib/formato";

type Complemento = {
  code: string; name: string; description: string | null; kind: "MODULE" | "LIMIT"; module_code: string | null; module_name: string | null; limit_key: string | null;
  limit_name: string | null; unit_qty: number; price_pen: number | null; status: string; status_name: string; empresas: number;
};
type Datos = { data: Complemento[]; modulos: { code: string; name: string }[] };

const TONO: Record<string, Tone> = { DRAFT: "neutral", PUBLISHED: "ok", RETIRED: "neutral" };
const SINGULAR: Record<string, string> = { users: "usuario", brands: "marca", sites: "local" };

/** Complementos: encienden un módulo o suben un límite; nacen en borrador y se publican con precio. */
export default function ComplementosConsola() {
  const yo = useUsuarioConsola();
  const puede = Boolean(yo.puede["plans.manage"]);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<Complemento | "nuevo" | null>(null);

  const cargar = useCallback(() => {
    apiConsola<Datos>("/complementos").then((r) => { setDatos(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(() => cargar(), [cargar]);

  async function accion(c: Complemento, ruta: "publicar" | "retirar") {
    if (!(await confirmAction({ title: ruta === "publicar" ? `¿Publicar «${c.name}» a ${soles(c.price_pen)} al mes?` : `¿Retirar «${c.name}»?`,
      confirmLabel: ruta === "publicar" ? "Publicar" : "Retirar", danger: ruta === "retirar",
      message: ruta === "retirar" ? "Ya no se podrá contratar; las empresas que lo tienen lo conservan hasta quitarlo." : "Las empresas lo podrán contratar desde Mi suscripción." }))) return;
    try {
      await apiConsola(`/complementos/${c.code}/${ruta}`, { method: "POST" });
      toast.ok(ruta === "publicar" ? "Complemento publicado" : "Complemento retirado");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const [estado, setEstado] = useState("");
  const ord = useOrdenLocal((datos?.data ?? []).filter((c) => !estado || c.status === estado), { name: (c) => c.name, kind: (c) => c.kind, price_pen: (c) => c.price_pen, status: (c) => c.status_name });
  const columnas: Column<Complemento>[] = [
    { key: "name", sortable: true, header: "Complemento", cardTitle: true, render: (c) => <div><p className="font-semibold text-ink">{c.name}</p><p className="text-[12.5px] text-muted">{c.description}</p></div> },
    { key: "kind", sortable: true, header: "Qué hace", render: (c) => (c.kind === "MODULE" ? `Enciende ${c.module_name ?? c.module_code}` : `Suma ${c.unit_qty} ${c.unit_qty === 1 ? SINGULAR[c.limit_key ?? ""] : c.limit_name}`) },
    { key: "cobro", header: "Cobro", hideOnMobile: true, render: (c) => (c.kind === "MODULE" ? "Fijo al mes" : c.unit_qty > 1 ? `Por paquete de ${c.unit_qty}` : "Por unidad") },
    { key: "price_pen", sortable: true, header: "Precio al mes", align: "right", render: (c) => (c.price_pen !== null ? soles(c.price_pen) : <span className="text-muted">Por definir</span>) },
    { key: "status", sortable: true, header: "Estado", render: (c) => <div className="grid gap-0.5"><Badge tone={TONO[c.status]} dot>{c.status_name}</Badge>{c.empresas > 0 && <span className="text-[12px] text-muted">{c.empresas} empresa(s)</span>}</div> },
    ...(puede ? [{ key: "acciones", header: "", align: "right" as const, render: (c: Complemento) => (
      <div className="flex justify-end gap-1.5">
        {c.status !== "RETIRED" && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditando(c)}>Editar</Button>}
        {c.status === "DRAFT" && <Button size="sm" variant="primary" icon={Send} disabled={c.price_pen === null} onClick={() => accion(c, "publicar")}>Publicar</Button>}
        {c.status === "PUBLISHED" && <Button size="sm" variant="ghost" icon={Archive} onClick={() => accion(c, "retirar")}>Retirar</Button>}
      </div>
    ) }] : []),
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Un complemento enciende un módulo que el plan no trae o suma unidades a un límite (usuarios, marcas, locales). Nace en borrador y se publica con su precio; se cobra en la corrida del mes. Retirado ya no se contrata."
        actions={puede ? <Button variant="primary" icon={Plus} onClick={() => setEditando("nuevo")}>Nuevo complemento</Button> : undefined} />
      <DataTable toolbar={<>
          <FiltroSelect etiqueta="Estado" ancho={170} value={estado} onChange={(v) => setEstado(v)}
            options={[...new Map((datos?.data ?? []).map((c) => [c.status, c.status_name])).entries()].map(([value, label]) => ({ value, label }))} />
        </>}
        {...ord.orden} columns={columnas} rows={ord.filas} rowKey={(c) => c.code} loading={!datos && !error} error={error} onRetry={cargar} empty="No hay complementos." />
      {editando && datos && <FormComplemento modulos={datos.modulos} actual={editando === "nuevo" ? undefined : editando} onClose={() => setEditando(null)} onListo={() => { setEditando(null); cargar(); }} />}
    </div>
  );
}

function FormComplemento({ modulos, actual, onClose, onListo }: { modulos: { code: string; name: string }[]; actual?: Complemento; onClose: () => void; onListo: () => void }) {
  const publicado = actual && actual.status !== "DRAFT";
  const [f, setF] = useState({
    code: actual?.code ?? "", name: actual?.name ?? "", description: actual?.description ?? "", kind: actual?.kind ?? "LIMIT", module_code: actual?.module_code ?? "",
    limit_key: actual?.limit_key ?? "users", unit_qty: String(actual?.unit_qty ?? 1), price_pen: actual?.price_pen !== null && actual?.price_pen !== undefined ? String(actual.price_pen) : "",
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await apiConsola(actual ? `/complementos/${actual.code}` : "/complementos", { method: actual ? "PUT" : "POST", body: {
        ...f, unit_qty: Number(f.unit_qty), price_pen: f.price_pen ? Number(f.price_pen) : null, module_code: f.module_code || null, description: f.description || null,
      } });
      toast.ok("Complemento guardado");
      onListo();
    } catch (err) {
      setErrores(erroresDe(err));
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} title={actual ? `Editar ${actual.name}` : "Nuevo complemento"}
      description={publicado ? "Publicado: solo cambian el nombre y la descripción. Para otro precio, crea otro complemento y retira este." : undefined}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-complemento" icon={Save} loading={guardando}>Guardar</Button></>}>
      <form id="f-complemento" onSubmit={guardar} className="grid gap-4">
        {!actual && <Field label="Código" required error={errores.code} hint="Letras, números y guion bajo (ej. USERS_10)."><Input value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>}
        <Field label="Nombre" required error={errores.name}><Input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Descripción" error={errores.description}><Input value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Qué hace" required error={errores.kind}>
            <Select value={f.kind} disabled={publicado} onChange={(e) => setF({ ...f, kind: e.target.value as "MODULE" | "LIMIT" })}
              options={[{ value: "LIMIT", label: "Sube un límite" }, { value: "MODULE", label: "Enciende un módulo" }]} />
          </Field>
          <Field label="Precio al mes (sin IGV)" error={errores.price_pen} hint="Vacío mientras no se apruebe.">
            <Input type="number" step="0.01" min={0.01} disabled={publicado} value={f.price_pen} onChange={(e) => setF({ ...f, price_pen: e.target.value })} />
          </Field>
        </div>
        {f.kind === "MODULE" ? (
          <Field label="Módulo" required error={errores.module_code}>
            <Select value={f.module_code} disabled={publicado} onChange={(e) => setF({ ...f, module_code: e.target.value })} placeholder="Elige el módulo" options={modulos.map((m) => ({ value: m.code, label: m.name }))} />
          </Field>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Límite" required error={errores.limit_key}>
              <Select value={f.limit_key} disabled={publicado} onChange={(e) => setF({ ...f, limit_key: e.target.value })}
                options={[{ value: "users", label: "Usuarios del personal" }, { value: "brands", label: "Marcas" }, { value: "sites", label: "Locales" }]} />
            </Field>
            <Field label="Unidades que suma" required error={errores.unit_qty}><Input type="number" min={1} disabled={publicado} value={f.unit_qty} onChange={(e) => setF({ ...f, unit_qty: e.target.value })} /></Field>
          </div>
        )}
      </form>
    </Modal>
  );
}
