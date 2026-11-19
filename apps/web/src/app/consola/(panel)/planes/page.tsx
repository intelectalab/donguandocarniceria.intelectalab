"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Field, Input, Modal, PageHeader, Textarea, confirmAction, toast } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { erroresDe, mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { fecha, soles } from "@/lib/formato";

type Modulo = { code: string; name: string; phase: number; is_core: boolean; depends_on: string[] };
type Version = {
  id: string; plan_code: string; version: number; status: string; status_name: string; name: string; description: string; price_pen: number;
  users_max: number; brands_max: number; sites_max: number; all_modules: boolean; modules: string[]; highlights: string[]; includes_previous: string | null;
  is_featured: boolean; sort_order: number; published_at: string | null; retired_at: string | null; faltan: { modulo: string; faltan: string[] }[]; suscripciones: number;
};
type Plan = { code: string; name: string; publicada: Version | null; borrador: Version | null; retiradas: Version[] };
type Catalogo = { planes: Plan[]; modulos: Modulo[] };

const FASES = ["Núcleo", "Ventas y operación", "Producción y abastecimiento", "Nuevos canales y control", "Producto SaaS"];

/** Dependencias que faltan, como texto corto. */
/** «1 marca», «3 marcas». */
const cuantos = (n: number, uno: string, varios = `${uno}s`) => `${n} ${n === 1 ? uno : varios}`;

const textoFaltan = (f: Version["faltan"]) => f.map((x) => `${x.modulo} necesita ${x.faltan.join(", ")}`).join(" · ");

/**
 * SUS-09 Catálogo de planes (consola): cada plan con su versión publicada (la que se vende), su borrador y las
 * retiradas. Publicado no cambia (RN-SUS-02); para publicar hace falta precio, un módulo y sus dependencias (RN-SUS-01).
 */
export default function CatalogoPlanes() {
  const yo = useUsuarioConsola();
  const puede = yo.puede["plans.manage"];
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<Version | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const cargar = () => apiConsola<Catalogo>("/planes").then((c) => { setCat(c); setError(""); }).catch((e) => setError(mensajeDe(e)));
  useEffect(() => { cargar(); }, []);

  async function nuevaVersion(p: Plan) {
    try {
      const v = await apiConsola<Version>("/planes/borradores", { method: "POST", body: { plan_code: p.code } });
      await cargar();
      setEditando(v);
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function publicar(v: Version) {
    if (!(await confirmAction({ title: `¿Publicar ${v.name} versión ${v.version}?`, confirmLabel: "Publicar",
      message: "Desde ahora se vende con estos datos y la versión publicada anterior se retira. Las empresas que ya lo tienen conservan su versión." }))) return;
    try {
      setCat(await apiConsola<Catalogo>(`/planes/borradores/${v.id}/publicar`, { method: "POST" }));
      toast.ok(`${v.name} versión ${v.version} publicada`);
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function retirar(p: Plan) {
    const r = await confirmAction({ title: `¿Retirar el plan ${p.name}?`, danger: true, confirmLabel: "Retirar", reason: { min: 5 },
      message: "Deja de mostrarse en la página y no se puede elegir en el alta. Las empresas que lo tienen lo conservan." });
    if (!r) return;
    try {
      setCat(await apiConsola<Catalogo>(`/planes/${p.code}/retirar`, { method: "POST", body: { reason: r.reason } }));
      toast.ok(`${p.name} retirado`);
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function borrar(v: Version) {
    if (!(await confirmAction({ title: `¿Borrar el borrador ${v.version} de ${v.name}?`, danger: true, confirmLabel: "Borrar" }))) return;
    try {
      await apiConsola(`/planes/borradores/${v.id}`, { method: "DELETE" });
      toast.ok("Borrador borrado");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        description="Los planes que vende la plataforma, con sus módulos, límites y precio mensual (más IGV). Un plan publicado no cambia: el cambio es una versión nueva, y las empresas conservan la versión que contrataron."
        actions={puede ? <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Nuevo plan</Button> : undefined} />
      {error && <Alert tone="bad">{error}</Alert>}
      {!cat && !error && <p className="text-muted">Cargando…</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {cat?.planes.map((p) => {
          const v = p.publicada;
          return (
            <section key={p.code} className="grid gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-[17px] font-bold text-ink">{p.name}</h2>
                </div>
                {v ? <Badge tone="ok" dot>Publicado · versión {v.version}</Badge> : <Badge tone="neutral" dot>Sin versión publicada</Badge>}
              </div>
              {v ? (
                <>
                  <p className="text-[13.5px] text-muted">{v.description}</p>
                  <p className="text-[14px] text-ink"><b>{soles(v.price_pen)}</b> al mes · {cuantos(v.users_max, "usuario")} · {cuantos(v.brands_max, "marca")} · {cuantos(v.sites_max, "local", "locales")}</p>
                  <p className="text-[13px] text-muted">{v.all_modules ? "Todos los módulos" : `${v.modules.length} módulos además del núcleo`} · {v.suscripciones} empresa{v.suscripciones === 1 ? "" : "s"} con esta versión · desde {fecha(v.published_at)}</p>
                  {v.faltan.length > 0 && (
                    <p className="flex gap-1.5 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>Le faltan módulos de los que dependen otros del plan: {textoFaltan(v.faltan)}. Corrígelo en una versión nueva.</span>
                    </p>
                  )}
                </>
              ) : <p className="text-[13.5px] text-muted">Todavía no se vende.</p>}

              {p.borrador && (
                <div className="grid gap-2 rounded-lg border border-dashed border-line p-3">
                  <p className="text-[13px] font-semibold text-ink">Borrador · versión {p.borrador.version} · {soles(p.borrador.price_pen)}</p>
                  {p.borrador.faltan.length > 0 && <p className="text-[12.5px] text-warn">Para publicar falta: {textoFaltan(p.borrador.faltan)}</p>}
                  {puede && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" icon={Pencil} onClick={() => setEditando(p.borrador)}>Editar</Button>
                      <Button size="sm" variant="primary" icon={Send} onClick={() => publicar(p.borrador as Version)}>Publicar</Button>
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => borrar(p.borrador as Version)}>Borrar</Button>
                    </div>
                  )}
                </div>
              )}

              {puede && (
                <div className="flex flex-wrap gap-2">
                  {!p.borrador && <Button size="sm" icon={Plus} onClick={() => nuevaVersion(p)}>Nueva versión</Button>}
                  {v && <Button size="sm" variant="ghost" onClick={() => retirar(p)}>Retirar plan</Button>}
                </div>
              )}
              {p.retiradas.length > 0 && <p className="text-[12px] text-muted">Retiradas: {p.retiradas.map((r) => `versión ${r.version}`).join(", ")}</p>}
            </section>
          );
        })}
      </div>

      {nuevo && <NuevoPlan onClose={() => setNuevo(false)} onCreado={(v) => { setNuevo(false); cargar(); setEditando(v); }} />}
      {editando && cat && <EditarBorrador version={editando} modulos={cat.modulos} onClose={() => setEditando(null)} onGuardado={() => { setEditando(null); cargar(); }} />}
    </div>
  );
}

function NuevoPlan({ onClose, onCreado }: { onClose: () => void; onCreado: (v: Version) => void }) {
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  async function crear(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      onCreado(await apiConsola<Version>("/planes/borradores", { method: "POST", body: { plan_code: codigo, name: nombre, nuevo: true } }));
    } catch (err) {
      const c = erroresDe(err);
      setErrores(Object.keys(c).length ? c : { plan_code: mensajeDe(err) });
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} placement="center" title="Nuevo plan" description="Nace como borrador: lo completas y luego lo publicas."
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-plan-nuevo" loading={guardando}>Crear borrador</Button></>}>
      <form id="f-plan-nuevo" onSubmit={crear} className="grid gap-4">
        <Field label="Código" required error={errores.plan_code} hint="En mayúsculas, sin espacios; no cambia. Por ejemplo GOURMET.">
          <Input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} maxLength={20} />
        </Field>
        <Field label="Nombre" required error={errores.name}><Input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={40} /></Field>
      </form>
    </Modal>
  );
}

function EditarBorrador({ version, modulos, onClose, onGuardado }: { version: Version; modulos: Modulo[]; onClose: () => void; onGuardado: () => void }) {
  const [v, setV] = useState({ ...version, highlightsTexto: version.highlights.join("\n") });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState("");
  const [guardando, setGuardando] = useState(false);
  const porCodigo = useMemo(() => Object.fromEntries(modulos.map((m) => [m.code, m])), [modulos]);
  const elegidos = new Set(v.modules);
  const nucleo = modulos.filter((m) => m.is_core).map((m) => m.code);
  // RN-SUS-01 en vivo: módulos elegidos cuyas dependencias no están en el plan ni en el núcleo.
  const faltan = v.all_modules ? [] : v.modules.map((m) => ({ modulo: m, faltan: (porCodigo[m]?.depends_on ?? []).filter((d) => !elegidos.has(d) && !nucleo.includes(d)) }))
    .filter((x) => x.faltan.length);

  const alternar = (code: string) => setV((x) => ({ ...x, modules: x.modules.includes(code) ? x.modules.filter((m) => m !== code) : [...x.modules, code] }));
  const numero = (k: "price_pen" | "users_max" | "brands_max" | "sites_max") => ({
    value: String(v[k]), onChange: (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: Number(e.target.value) })) });

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setErrores({});
    setGeneral("");
    try {
      await apiConsola(`/planes/borradores/${v.id}`, { method: "PUT", body: { name: v.name, description: v.description, price_pen: v.price_pen,
        users_max: v.users_max, brands_max: v.brands_max, sites_max: v.sites_max, all_modules: v.all_modules, modules: v.modules,
        highlights: v.highlightsTexto.split("\n"), includes_previous: v.includes_previous, is_featured: v.is_featured, sort_order: v.sort_order } });
      toast.ok("Borrador guardado");
      onGuardado();
    } catch (err) {
      const c = erroresDe(err);
      setErrores(c);
      setGeneral(Object.keys(c).length ? "Revisa los campos marcados." : mensajeDe(err));
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" dismissable={!guardando} title={`${version.name} · borrador versión ${version.version}`}
      description="Se guarda como borrador. Para venderlo, publícalo desde el catálogo."
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-borrador" loading={guardando}>Guardar borrador</Button></>}>
      <form id="f-borrador" onSubmit={guardar} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" required error={errores.name}><Input value={v.name} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} maxLength={40} /></Field>
          <Field label="Precio mensual (S/, sin IGV)" required error={errores.price_pen}><Input type="number" min={0} step="0.01" {...numero("price_pen")} /></Field>
        </div>
        <Field label="A quién va dirigido" required error={errores.description}>
          <Textarea rows={2} value={v.description} onChange={(e) => setV((x) => ({ ...x, description: e.target.value }))} maxLength={300} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Usuarios" required error={errores.users_max}><Input type="number" min={1} {...numero("users_max")} /></Field>
          <Field label="Marcas" required error={errores.brands_max}><Input type="number" min={1} {...numero("brands_max")} /></Field>
          <Field label="Locales" required error={errores.sites_max}><Input type="number" min={1} {...numero("sites_max")} /></Field>
        </div>
        <Checkbox checked={v.all_modules} onChange={(c) => setV((x) => ({ ...x, all_modules: c }))} label="Incluye todos los módulos de la plataforma" />
        {!v.all_modules && (
          <div className="grid gap-3">
            <p className="text-[12.5px] text-muted">Módulos del plan. El núcleo (Plataforma, Seguridad, Maestros, Integraciones y Auditoría) va siempre.</p>
            {[1, 2, 3, 4].map((fase) => (
              <fieldset key={fase} className="grid gap-1.5">
                <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted uppercase">{FASES[fase]}</legend>
                <div className="grid gap-1 sm:grid-cols-2">
                  {modulos.filter((m) => m.phase === fase && !m.is_core).map((m) => (
                    <Checkbox key={m.code} checked={elegidos.has(m.code)} onChange={() => alternar(m.code)} label={`${m.code} · ${m.name}`}
                      hint={m.depends_on.length ? `Necesita ${m.depends_on.join(", ")}` : undefined} />
                  ))}
                </div>
              </fieldset>
            ))}
            {faltan.length > 0 && <Alert tone="warn" title="Así no se puede publicar">{textoFaltan(faltan)}</Alert>}
          </div>
        )}
        <Field label="Lo que incluye (una línea por punto, para la página)" error={errores.highlights}>
          <Textarea rows={4} value={v.highlightsTexto} onChange={(e) => setV((x) => ({ ...x, highlightsTexto: e.target.value }))} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Texto antes de la lista" hint="Por ejemplo «Todo lo del Inicial, más:»">
            <Input value={v.includes_previous ?? ""} onChange={(e) => setV((x) => ({ ...x, includes_previous: e.target.value || null }))} maxLength={80} />
          </Field>
          <Field label="Orden en la página"><Input type="number" min={0} max={99} value={String(v.sort_order)} onChange={(e) => setV((x) => ({ ...x, sort_order: Number(e.target.value) }))} /></Field>
        </div>
        <Checkbox checked={v.is_featured} onChange={(c) => setV((x) => ({ ...x, is_featured: c }))} label="Destacado en la página de precios" />
        {general && <Alert tone="bad">{general}</Alert>}
      </form>
    </Modal>
  );
}
