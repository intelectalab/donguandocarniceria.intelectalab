"use client";

import { useState } from "react";
import { Alert, Badge, Button, Checkbox, DataTable, Field, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { FiltroSelect, Tabla, grados, opcionesEt, useDatos, useOpcionesCal } from "@/modulos/cal/comunes";
import { ESTADO_EXC, GRAVEDAD, TIPO_PUNTO, type Num } from "@/modulos/cal/tipos";

type Exc = { id: string; started_at: string; ended_at: string | null; first_value_c: Num; max_value_c: Num; max_deviation_c: Num; readings_count: number; status: string; action_taken: string | null;
  closed_at: string | null; point_code: string; point_name: string; point_type: string; min_c: Num; max_c: Num; establishment_name: string; closed_by_name: string | null; nc_number: string | null; duration_min: Num };
type Detalle = Exc & { readings: { id: string; read_at: string; value_c: Num; in_range: boolean; read_by_name: string | null }[] };

/** CAL-06 Excursiones y alertas: cada salida de rango con su duración, desvío máximo y lotes expuestos; se cierra con la acción tomada (RN-CAL-13). */
export default function Excursiones() {
  const { local, puede } = useSesion();
  const op = useOpcionesCal();
  const [estado, setEstado] = useState("OPEN");
  const lista = useListado<Exc>("/v1/cal/excursiones", { orden: "-started_at", filtros: { status: estado, site: local } });
  const [ver, setVer] = useState<string | null>(null);
  const columnas: Column<Exc>[] = [
    { key: "point_name", header: "Punto", cardTitle: true, render: (x) => <div><p className="font-medium">{x.point_name}</p><p className="text-[12px] text-muted">{TIPO_PUNTO[x.point_type]} · {x.establishment_name}</p></div> },
    { key: "started_at", header: "Empezó", sortable: true, render: (x) => fechaHora(x.started_at) },
    { key: "duration", header: "Duración", render: (x) => x.ended_at ? `${numero(Number(x.duration_min) / 60, 1)} h` : <Badge tone="bad">Sigue fuera</Badge> },
    { key: "max_value_c", header: "Peor lectura", align: "right", render: (x) => <span>{grados(x.max_value_c)} <span className="text-[12px] text-muted">({grados(x.max_deviation_c)} fuera)</span></span> },
    { key: "range", header: "Rango", hideOnMobile: true, render: (x) => `${grados(x.min_c)} a ${grados(x.max_c)}` },
    { key: "readings_count", header: "Lecturas", align: "right", hideOnMobile: true },
    { key: "nc_number", header: "No conformidad", render: (x) => x.nc_number ?? "—" },
    { key: "status", header: "Estado", render: (x) => <StatusBadge status={x.status} labels={ESTADO_EXC} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Una excursión se abre con la primera lectura fuera de rango y termina cuando vuelve al rango, pero sigue abierta hasta que Calidad registre la acción tomada." />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(x) => setVer(x.id)} empty="No hay excursiones con ese estado."
        toolbar={<FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesEt(ESTADO_EXC)} />} />
      {ver && <Ficha id={ver} cierra={Boolean(op?.can.close) && puede("CAL", "E")} onClose={() => setVer(null)} onCambio={() => { setVer(null); lista.recargar(); }} />}
    </div>
  );
}

function Ficha({ id, cierra, onClose, onCambio }: { id: string; cierra: boolean; onClose: () => void; onCambio: () => void }) {
  const { datos: x } = useDatos<Detalle>(`/v1/cal/excursiones/${id}`);
  const [accionTomada, setAccion] = useState("");
  const [nc, setNc] = useState(false);
  const [sev, setSev] = useState("MAJOR");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  return (
    <Modal open onClose={onClose} size="lg" title={x ? `Excursión en ${x.point_name}` : "Excursión"}
      footer={x?.status === "OPEN" && cierra && <><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={enviando} onClick={async () => {
        setEnviando(true); setError("");
        try { await api(`/v1/cal/excursiones/${id}/cerrar`, { method: "POST", body: { action_taken: accionTomada, create_nc: nc, severity: nc ? sev : null } }); toast.ok("Excursión cerrada"); onCambio(); }
        catch (e) { setError(mensajeDe(e)); } finally { setEnviando(false); }
      }}>Cerrar excursión</Button></>}>
      {x && <div className="space-y-4">
        <p className="text-[13px] text-muted">Desde {fechaHora(x.started_at)}{x.ended_at ? ` hasta ${fechaHora(x.ended_at)}` : " · sigue fuera de rango"} · rango {grados(x.min_c)} a {grados(x.max_c)}</p>
        <Tabla cabeza={["Hora", "Temperatura", "Leyó"]} filas={x.readings.map((r) => [fechaHora(r.read_at), <Badge key="t" tone={r.in_range ? "ok" : "bad"}>{grados(r.value_c)}</Badge>, r.read_by_name ?? "—"])} />
        {x.status === "CLOSED" ? <Alert tone="ok">Cerrada {fechaHora(x.closed_at)} por {x.closed_by_name}: {x.action_taken}</Alert> : cierra && <>
          {error && <Alert tone="bad">{error}</Alert>}
          <Field label="Acción tomada" required><Textarea rows={2} value={accionTomada} onChange={(e) => setAccion(e.target.value)} /></Field>
          <Checkbox checked={nc} onChange={setNc} label="Abrir una no conformidad" hint="Si el producto expuesto pudo afectarse" />
          {nc && <Field label="Gravedad"><Select value={sev} options={opcionesEt(GRAVEDAD)} onChange={(e) => setSev(e.target.value)} /></Field>}
        </>}
      </div>}
    </Modal>
  );
}
