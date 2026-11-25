"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, CalendarClock, Database, Eraser, ShieldCheck } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, Field, FiltroSelect, Input, PageHeader, Textarea, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { useOrdenLocal, usePaginaLocal } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/mae/Dialogo";
import { sinTildes } from "@/modulos/mae/tipos";

type Politica = {
  category: string; nombre: string; que: string; months: number; unit: "DAYS" | "MONTHS"; plazo: string; archive_before_purge: boolean;
  reason: string; updated_by: string; updated_at: string | null; corte: string | null; total: number; para_depurar: number; ultima: string | null; minimo: number;
};
type Respuesta = { data: Politica[]; anios: number; puede: boolean; enmascarado: { campo: string; original: string; en_auditoria: string }[] };

/**
 * AUD-06 Políticas de retención: cuánto se conserva cada categoría y si se archiva (comprimido y cifrado) antes de
 * depurar. Cambios y accesos: al menos aud_retention_years años. «Depurar ahora» queda como corrida en AUD-07.
 */
export default function PoliticasDeRetencion() {
  const router = useRouter();
  const { can } = useSesion();
  const permitido = Boolean(can("aud.retention.manage") || can("aud.change_log.view"));
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const [f, setF] = useState({ buscar: "", archiva: "" });
  const [editar, setEditar] = useState<Politica | null>(null);

  const cargar = useCallback(() => {
    if (!permitido) return;
    api<Respuesta>("/v1/aud/retencion").then((r) => { setDatos(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [permitido]);
  useEffect(() => cargar(), [cargar]);

  const visibles = useMemo(() => {
    const q = sinTildes(f.buscar.trim());
    return (datos?.data ?? []).filter((p) => (!q || sinTildes(`${p.nombre} ${p.que} ${p.reason} ${p.updated_by}`).includes(q))
      && (!f.archiva || String(p.archive_before_purge) === f.archiva));
  }, [datos, f]);
  const ord = useOrdenLocal(visibles, {
    nombre: (p) => p.nombre, plazo: (p) => (p.unit === "DAYS" ? p.months : p.months * 30), corte: (p) => p.corte, total: (p) => p.total,
    para_depurar: (p) => p.para_depurar, updated_at: (p) => p.updated_at,
  });
  const pagina = usePaginaLocal(ord.filas, `${JSON.stringify(f)}|${ord.orden.sort}`);

  if (!permitido) return <Alert tone="warn">Tu rol no consulta las políticas de retención.</Alert>;

  async function depurar(p: Politica) {
    const ok = await confirmAction({ title: `¿Depurar ${p.nombre.toLowerCase()}?`, confirmLabel: "Depurar", danger: true,
      message: `Se ${p.archive_before_purge ? "archivarán (comprimidas y cifradas) y " : ""}borrarán ${numero(p.para_depurar)} fila(s) anteriores al ${fecha(p.corte)}. No se puede deshacer${p.archive_before_purge ? ", pero queda el archivo" : ""}. Queda registrado en Corridas de depuración.` });
    if (!ok) return;
    try {
      const r = await api<{ number: string; purged_rows: number; status: string; error: string | null }>(`/v1/aud/retencion/${p.category}/depurar`, { method: "POST" });
      if (r.status === "FAILED") toast.error(`${r.number}: la depuración falló y no se borró nada`);
      else toast.ok(`${r.number}: ${numero(r.purged_rows)} fila(s) depuradas`);
      router.push("/m/aud/aud-07");
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const columnas: Column<Politica>[] = [
    { key: "nombre", sortable: true, header: "Categoría", cardTitle: true, render: (p) => (
      <div className="min-w-[190px] max-w-[240px]"><p className="font-semibold text-ink">{p.nombre}</p><p className="text-[12px] text-muted">{p.que}</p></div>
    ) },
    { key: "plazo", sortable: true, header: "Conservación", render: (p) => (
      <div className="whitespace-nowrap"><p className="font-semibold text-ink">{p.plazo}</p>
        {p.archive_before_purge ? <Badge tone="ok" dot>Se archiva cifrado</Badge> : <span className="text-[11.5px] text-muted">Sin archivo</span>}</div>
    ) },
    { key: "corte", sortable: true, header: "Fecha de corte", render: (p) => (
      <div className="whitespace-nowrap"><p className="tabular-nums" title="Se depura lo anterior a esta fecha">{fecha(p.corte)}</p>
        <p className="text-[11.5px] text-muted">{p.ultima ? `Última corrida: ${fecha(p.ultima)}` : "Sin corridas"}</p></div>
    ) },
    { key: "total", sortable: true, header: "Filas actuales", align: "right", render: (p) => numero(p.total) },
    { key: "para_depurar", sortable: true, header: "Para depurar", align: "right", render: (p) => (p.para_depurar ? <b className="text-warn">{numero(p.para_depurar)}</b> : <span className="text-muted">0</span>) },
    { key: "updated_at", sortable: true, header: "Motivo", hideOnMobile: true, render: (p) => (
      <div className="min-w-[150px] max-w-[200px] text-[12.5px]"><p>{p.reason}</p><p className="text-[11.5px] text-muted">{p.updated_by}</p>{p.updated_at && <p className="text-[11.5px] text-muted">{fecha(p.updated_at)}</p>}</div>
    ) },
    ...(datos?.puede && (datos?.data ?? []).some((x) => x.para_depurar > 0) ? [{ key: "acciones", header: "", align: "right" as const, render: (p: Politica) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {p.para_depurar > 0 && <Button size="sm" icon={Eraser} onClick={() => depurar(p)} title="Depurar ahora lo vencido">Depurar</Button>}
      </div>
    ) }] : []),
  ];

  const pol = datos?.data ?? [];
  const pendiente = pol.reduce((s, p) => s + p.para_depurar, 0);
  return (
    <div className="grid gap-5">
      <PageHeader description={`Cuánto tiempo se conserva cada cosa y si se archiva, comprimida y cifrada, antes de depurarla. La auditoría de cambios y la bitácora de accesos se conservan al menos ${datos?.anios ?? 5} años y siempre se archivan. La depuración corre sola el primer día de cada mes y cada corrida queda en Corridas de depuración.${datos?.puede ? " Haz clic en una categoría para cambiar su plazo o el archivado." : ""}`} />
      {datos && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Categorías" valor={numero(pol.length)} icono={Database} destacada detalle={`${pol.filter((p) => p.archive_before_purge).length} se archivan antes`} />
          <Cifra titulo="Cambios y accesos" valor={`${datos.anios} años`} icono={ShieldCheck} detalle="Mínimo de conservación" />
          <Cifra titulo="Para depurar" valor={numero(pendiente)} icono={Eraser} tono={pendiente ? "warn" : "ok"} detalle={pendiente ? "Filas vencidas hoy" : "Nada vencido"} />
          <Cifra titulo="Próxima corrida" valor={fecha(proximaCorrida())} icono={CalendarClock} detalle="Mantenimiento programado" />
        </div>
      )}
      <Alert tone="info">Decisiones pendientes: los 5 años de cambios y accesos los confirma la contadora; las grabaciones de llamadas se guardan 12 meses (por validar con un abogado de datos personales) y solo las escuchan la supervisora de ventas y la gerencia.</Alert>
      <DataTable {...ord.orden} rowKey={(p) => p.category} onRowClick={datos?.puede ? setEditar : undefined} columns={columnas} rows={pagina.filas} pagination={pagina.props} loading={!datos && !error} error={error} onRetry={cargar}
        empty="Ninguna categoría coincide con la búsqueda."
        search={{ value: f.buscar, onChange: (v) => setF({ ...f, buscar: v }), placeholder: "Buscar categoría o motivo…" }}
        toolbar={<FiltroSelect etiqueta="Archiva antes" ancho={190} value={f.archiva} onChange={(v) => setF({ ...f, archiva: v })} options={[{ value: "true", label: "Sí, cifrado" }, { value: "false", label: "No" }]} />} />

      {datos && (
        <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <div>
            <h2 className="text-[14px] font-semibold text-ink">Enmascarado de datos sensibles</h2>
            <p className="text-[12.5px] text-muted">Las contraseñas, los secretos del segundo factor, las credenciales cifradas y las claves se guardan como *** en la auditoría. El celular, el documento y el correo se muestran enmascarados a quien no tiene permiso de ver datos personales; verlos sin máscara queda en Accesos a datos sensibles. Así queda un registro de ejemplo:</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-[12.5px]">
              <thead><tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-muted"><th className="py-2 pr-3 font-semibold">Campo</th><th className="py-2 pr-3 font-semibold">Lo que se escribió</th><th className="py-2 font-semibold">Así queda en la auditoría y en pantalla</th></tr></thead>
              <tbody>
                {datos.enmascarado.map((m) => (
                  <tr key={m.campo} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-3 font-mono text-[12px] text-muted">{m.campo}</td>
                    <td className="py-2 pr-3 font-mono text-[12px]">{m.original}</td>
                    <td className={`py-2 font-mono text-[12px] ${m.en_auditoria === "***" ? "font-semibold text-ok" : "text-ink"}`}>{m.en_auditoria}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {editar && datos && <EditarPolitica p={editar} anios={datos.anios} onClose={() => setEditar(null)} onListo={() => { setEditar(null); cargar(); }} />}
    </div>
  );
}

/** El 1 del mes siguiente (la tarea corre a las 03:30 de Lima). */
function proximaCorrida(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 12).toISOString().slice(0, 10);
}

function EditarPolitica({ p, anios, onClose, onListo }: { p: Politica; anios: number; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ months: String(p.months), archive: p.archive_before_purge, reason: "" });
  const auditoria = p.category === "CHANGE_LOG" || p.category === "ACCESS_LOG";
  return (
    <Dialogo titulo={`Retención · ${p.nombre}`} boton="Guardar" onClose={onClose}
      aviso={auditoria ? `Se conserva al menos ${p.minimo} meses (${anios} años) y siempre se archiva antes de depurarse.` : undefined}
      enviar={async () => {
        await api(`/v1/aud/retencion/${p.category}`, { method: "PUT", body: { months: Number(d.months), archive: d.archive, reason: d.reason } });
        toast.ok("Política actualizada");
        onListo();
      }}>
      {(errores) => (
        <>
          <Field label={p.unit === "DAYS" ? "Días" : "Meses"} required error={errores.months} hint={`Hoy: ${p.plazo}.`}>
            <Input type="number" min={p.minimo} value={d.months} onChange={(e) => setD({ ...d, months: e.target.value })} />
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox checked={d.archive} disabled={auditoria} onChange={(v) => setD({ ...d, archive: v })} label="Archivar (comprimido y cifrado) antes de depurar" />
          </div>
          <Field label="Motivo del cambio" required error={errores.reason} hint="Al menos 10 caracteres. Queda en la política y en la auditoría de cambios." className="sm:col-span-2">
            <Textarea rows={3} maxLength={300} value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} />
          </Field>
          <p className="flex items-center gap-1.5 text-[12px] text-muted sm:col-span-2"><Archive className="size-3.5" />{p.que}</p>
        </>
      )}
    </Dialogo>
  );
}
