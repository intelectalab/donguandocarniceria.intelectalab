"use client";

import { useState } from "react";
import { ArrowRight, CalendarCheck, FileText, Undo2 } from "lucide-react";
import { Alert, Button, Field, Input, PageHeader, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { CifraLink, MODO, Seccion, accion, useDatos, useOpcionesGrj } from "@/modulos/grj/comunes";

type Vinculo = { id: string; mode: string; valid_from: string; valid_to: string | null; farm_ruc: string | null; state: string; supplier_name: string };

/** GRJ-06 Cambio a factura: fecha de corte, nuevo RUC de la granja, cierre del vínculo NTI y apertura del vínculo con factura al día siguiente. */
export default function CambioAFactura() {
  const op = useOpcionesGrj();
  const v = useDatos<{ data: Vinculo[] }>("/v1/grj/vinculos");
  const [f, setF] = useState({ cut_date: "", new_ruc: "", legal_name: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const vinculos = v.datos?.data ?? [];
  const nti = vinculos.find((x) => x.mode === "NTI" && x.state === "ACTIVE");
  const programado = vinculos.find((x) => x.mode === "INVOICE" && (x.state === "SCHEDULED" || x.state === "ACTIVE"));
  const siguiente = f.cut_date ? new Date(new Date(`${f.cut_date}T12:00:00`).getTime() + 86400000).toISOString().slice(0, 10) : null;
  async function aplicar() {
    setEnviando(true); setError(""); setErrores({});
    try { await api("/v1/grj/cambio-a-factura", { method: "POST", body: { ...f, legal_name: f.legal_name || null, supplier_id: op?.farm?.id ?? null } }); toast.ok("Cambio programado: desde el día siguiente al corte la granja factura"); v.recargar(); }
    catch (e) { const c = erroresDe(e); setErrores(c); if (!Object.keys(c).length) setError(mensajeDe(e)); } finally { setEnviando(false); }
  }
  return (
    <div className="space-y-5">
      <PageHeader description="Cuando la granja se separe y tenga su propio RUC, deja de mandar notas de transferencia interna y empieza a facturar con IGV. El cambio se hace en una fecha de corte, el último día de un mes, para que la conciliación y el cierre contable no se mezclen." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <CifraLink destacada titulo="Documento esperado hoy" valor={op ? (op.expected_today === "INVOICE" ? "Factura" : op.expected_today === "NTI" ? "NTI" : "Sin vínculo") : undefined} icono={FileText} />
        <CifraLink titulo="Vínculo NTI vigente" valor={v.datos ? (nti ? `desde ${fecha(nti.valid_from)}` : "Ninguno") : undefined} detalle={nti?.valid_to ? `hasta ${fecha(nti.valid_to)}` : undefined} icono={CalendarCheck} href="/m/grj/grj-01" />
        <CifraLink titulo="Vínculo con factura" valor={v.datos ? (programado ? `desde ${fecha(programado.valid_from)}` : "No programado") : undefined} detalle={programado?.farm_ruc ? `RUC ${programado.farm_ruc}` : undefined} icono={ArrowRight} />
      </div>
      {programado ? <Alert tone="info" title="El cambio ya está programado">
        <p>La granja factura desde el {fecha(programado.valid_from)} con el RUC {programado.farm_ruc}. Mientras no llegue ninguna factura, se puede deshacer.</p>
        {op?.can.link && <div className="mt-2"><Button size="sm" icon={Undo2} onClick={() => accion({ title: "¿Deshacer el cambio a factura?", message: "El vínculo NTI vuelve a quedar sin fecha de fin.", confirmLabel: "Deshacer", danger: true },
          () => api("/v1/grj/cambio-a-factura/deshacer", { method: "POST" }), "Cambio deshecho", v.recargar)}>Deshacer</Button></div>}
      </Alert> : op && !op.can.link ? <Alert tone="info">El cambio a factura lo hace Gerencia.</Alert> : <Seccion titulo="Asistente">
        <ol className="mb-4 space-y-1 text-[13px] text-muted">
          <li>1. Elige el último día con NTI (fin de mes).</li><li>2. Escribe el RUC nuevo de la granja.</li><li>3. Se cierra el vínculo NTI en el corte y se abre el de factura al día siguiente.</li>
        </ol>
        {error && <div className="mb-3"><Alert tone="bad">{error}</Alert></div>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Fecha de corte" required error={errores.cut_date} hint="Último día de un mes"><Input type="date" value={f.cut_date} onChange={(x) => setF({ ...f, cut_date: x.target.value })} /></Field>
          <Field label="RUC nuevo de la granja" required error={errores.new_ruc}><Input inputMode="numeric" maxLength={11} value={f.new_ruc} onChange={(x) => setF({ ...f, new_ruc: x.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Razón social nueva" error={errores.legal_name}><Input maxLength={200} value={f.legal_name} onChange={(x) => setF({ ...f, legal_name: x.target.value })} /></Field>
        </div>
        {siguiente && <p className="mt-3 text-[13px]">{MODO.NTI} hasta el <b>{fecha(f.cut_date)}</b> → {MODO.INVOICE.toLowerCase()} desde el <b>{fecha(siguiente)}</b>.</p>}
        <div className="mt-4 flex justify-end"><Button variant="primary" loading={enviando} disabled={!f.cut_date || f.new_ruc.length !== 11} onClick={aplicar}>Programar el cambio</Button></div>
      </Seccion>}
    </div>
  );
}
