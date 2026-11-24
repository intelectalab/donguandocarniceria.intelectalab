"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { History, Pencil, Search } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, IconButton, Input, Modal, PageHeader, Textarea, toast } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { erroresDe, mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { fechaHora } from "@/lib/formato";

type Parametro = {
  key: string; value: unknown; description: string; updated_at: string; updated_by: string | null; regla: [string, number?, number?] | null;
  historial: { old_value: unknown; new_value: unknown; reason: string; changed_by_name: string; changed_at: string }[]; modificado: boolean;
};
type Cambio = { key: string; old_value: unknown; new_value: unknown; reason: string; changed_by_name: string; changed_at: string };

const PRIORIDAD: Record<string, string> = { URGENT: "Urgente", HIGH: "Alta", NORMAL: "Normal", LOW: "Baja" };
const mostrar = (v: unknown): string => {
  if (Array.isArray(v)) return v.length ? v.join(", ") : "Vacía (acepta todo)";
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${PRIORIDAD[k] ?? k}: ${x}`).join(" · ");
  if (v === "" || v === null || v === undefined) return "Vacío";
  return String(v);
};
/** Grupos por el comienzo de la clave: así se encuentran juntos los de la consola, los del cobro y los del registro. */
const GRUPOS: [string, string][] = [["ops_", "Consola, soporte y operación"], ["sus_", "Suscripciones y cobro"], ["onb_", "Registro de empresas"]];
const grupoDe = (key: string) => GRUPOS.find(([pre]) => key.startsWith(pre))?.[1] ?? "Otros";
const sinTildes = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** OPS-16 Parámetros de plataforma: valores de toda la plataforma; cada cambio pide motivo y queda en su historial (RN-OPS-05). */
export default function ParametrosPlataforma() {
  const yo = useUsuarioConsola();
  const [lista, setLista] = useState<Parametro[] | null>(null);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<Parametro | null>(null);
  const [historia, setHistoria] = useState<Parametro | null>(null);
  const [buscar, setBuscar] = useState("");
  const [cambios, setCambios] = useState<Cambio[]>([]);
  const grupos = useMemo(() => {
    const q = sinTildes(buscar.trim());
    const vistos = (lista ?? []).filter((p) => !q || sinTildes(`${p.key} ${p.description} ${mostrar(p.value)}`).includes(q));
    return [...GRUPOS.map(([, n]) => n), "Otros"].map((n) => ({ nombre: n, items: vistos.filter((p) => grupoDe(p.key) === n) })).filter((g) => g.items.length);
  }, [lista, buscar]);
  const total = grupos.reduce((s, g) => s + g.items.length, 0);

  const cargar = () => apiConsola<{ data: Parametro[]; historial: Cambio[] }>("/parametros").then((r) => { setLista(r.data); setCambios(r.historial); setError(""); }).catch((e) => setError(mensajeDe(e)));
  useEffect(() => { cargar(); }, []);

  return (
    <div className="grid gap-5">
      <PageHeader description="Valores que valen para toda la plataforma: la consola, el soporte, la operación, el registro y el cobro de las suscripciones. Cada cambio pide un motivo y queda en su historial." />
      {error && <Alert tone="bad">{error}</Alert>}
      {!yo.puede["params.manage"] && lista && <p className="text-[13px] text-muted">Solo un administrador de plataforma los cambia. Tú puedes consultarlos.</p>}
      {lista && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-muted" />
            <Input aria-label="Buscar parámetro" placeholder="Buscar por nombre, descripción o valor" value={buscar} onChange={(e) => setBuscar(e.target.value)} className="pl-9" />
          </div>
          <span className="text-[13px] text-muted">{buscar ? `${total} de ${lista.length}` : `${lista.length} parámetros`}</span>
        </div>
      )}
      {lista && total === 0 && <p className="text-[13.5px] text-muted">Ningún parámetro coincide con «{buscar}».</p>}
      {grupos.map((g) => (
      <div key={g.nombre} className="grid gap-3">
        <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">{g.nombre}</p>
        {g.items.map((p) => (
          <section key={p.key} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-5 py-4 shadow-card">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2"><span className="font-mono text-[12px] text-accent">{p.key}</span>
                {p.modificado ? <Badge tone="warn">Modificado</Badge> : <Badge>Por defecto</Badge>}</p>
              <p className="text-[13.5px] text-ink">{p.description}</p>
              <p className="text-[12px] text-muted">Último cambio: {fechaHora(p.updated_at)}{p.updated_by ? ` · ${p.updated_by}` : " · valor inicial"}</p>
            </div>
            <p className="font-display text-[17px] font-bold text-ink">{mostrar(p.value)}</p>
            <div className="flex gap-1">
              <IconButton icon={History} label="Ver historial" onClick={() => setHistoria(p)} />
              {yo.puede["params.manage"] && p.regla && <IconButton icon={Pencil} label="Cambiar" onClick={() => setEditando(p)} />}
            </div>
          </section>
        ))}
      </div>
      ))}
      {lista && (
        <div className="grid gap-2">
          <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Historial de cambios</p>
          <DataTable rows={cambios} rowKey={(c) => `${c.key}-${c.changed_at}`} empty="Sin cambios: todos los parámetros tienen su valor inicial." columns={[
            { key: "changed_at", header: "Fecha", render: (c) => <span className="whitespace-nowrap">{fechaHora(c.changed_at)}</span> },
            { key: "key", header: "Parámetro", cardTitle: true, render: (c) => <span className="text-[12.5px]">{lista.find((x) => x.key === c.key)?.description ?? c.key}</span> },
            { key: "old_value", header: "Antes", render: (c) => mostrar(c.old_value) },
            { key: "new_value", header: "Después", render: (c) => <span className="font-semibold text-ink">{mostrar(c.new_value)}</span> },
            { key: "reason", header: "Motivo", hideOnMobile: true },
            { key: "changed_by_name", header: "Por", hideOnMobile: true },
          ]} />
        </div>
      )}
      {editando && <Editar p={editando} onClose={() => setEditando(null)} onGuardado={() => { setEditando(null); cargar(); }} />}
      {historia && (
        <Modal open onClose={() => setHistoria(null)} title={`Historial de ${historia.key}`} description={historia.description}>
          {historia.historial.length ? (
            <ol className="grid gap-3">
              {historia.historial.map((h, i) => (
                <li key={i} className="border-l-2 border-line pl-3">
                  <p className="text-[13.5px] font-semibold text-ink">{mostrar(h.old_value)} → {mostrar(h.new_value)}</p>
                  <p className="text-[13px] text-muted">{h.reason}</p>
                  <p className="text-[12px] text-muted">{fechaHora(h.changed_at)} · {h.changed_by_name}</p>
                </li>
              ))}
            </ol>
          ) : <p className="text-[13.5px] text-muted">Conserva su valor inicial.</p>}
        </Modal>
      )}
    </div>
  );
}

function Editar({ p, onClose, onGuardado }: { p: Parametro; onClose: () => void; onGuardado: () => void }) {
  const esLista = p.regla?.[0] === "redes" || p.regla?.[0] === "dominios";
  const esDominios = p.regla?.[0] === "dominios";
  const esTexto = p.regla?.[0] === "ruc" || p.regla?.[0] === "texto";
  const [valor, setValor] = useState(esLista ? (p.value as string[]).join("\n") : String(p.value ?? ""));
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setErrores({});
    setGeneral("");
    try {
      await apiConsola(`/parametros/${p.key}`, { method: "PUT", body: { value: esLista || esTexto ? valor.trim() : Number(valor), reason: motivo } });
      toast.ok("Parámetro cambiado");
      onGuardado();
    } catch (err) {
      const c = erroresDe(err);
      setErrores(c);
      if (!Object.keys(c).length) setGeneral(mensajeDe(err));
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} placement="center" dismissable={!guardando} title={`Cambiar ${p.key}`} description={p.description}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-parametro" loading={guardando}>Guardar</Button></>}>
      <form id="f-parametro" onSubmit={guardar} className="grid gap-4">
        {esLista ? (
          <Field label={esDominios ? "Dominios de correo permitidos" : "Redes permitidas"} error={errores.value}
            hint={esDominios ? "Un dominio por línea, sin @ (por ejemplo intelectalab.com). Vacía acepta cualquier correo. Solo vale para las cuentas nuevas."
              : "Una IP o red por línea (por ejemplo 190.237.14.22 o 10.0.0.0/8). Vacía acepta todas. Incluye la tuya o te quedarás sin acceso."}>
            <Textarea rows={4} value={valor} onChange={(e) => setValor(e.target.value)} className="font-mono" />
          </Field>
        ) : esTexto ? (
          <Field label="Valor" error={errores.value} hint={p.regla?.[0] === "ruc" ? "11 dígitos. Vacío: la corrida de cobro no emite comprobantes." : `Hasta ${p.regla?.[1]} caracteres.`}>
            <Input value={valor} onChange={(e) => setValor(e.target.value)} inputMode={p.regla?.[0] === "ruc" ? "numeric" : undefined} maxLength={p.regla?.[0] === "ruc" ? 11 : p.regla?.[1]} />
          </Field>
        ) : (
          <Field label="Valor" error={errores.value} hint={p.regla ? `Entre ${p.regla[1]} y ${p.regla[2]}` : undefined}>
            <Input type="number" value={valor} onChange={(e) => setValor(e.target.value)} min={p.regla?.[1]} max={p.regla?.[2]} />
          </Field>
        )}
        <Field label="Motivo" required error={errores.reason} hint="Queda en el historial del parámetro y en la bitácora.">
          <Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
        </Field>
        {general && <Alert tone="bad">{general}</Alert>}
      </form>
    </Modal>
  );
}
