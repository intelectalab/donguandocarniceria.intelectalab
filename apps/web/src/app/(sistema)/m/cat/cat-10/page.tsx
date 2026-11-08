"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, DetailList, Field, Input, PageHeader, Select, StatusBadge, toast, type Column, type Tone } from "@/components/ui";
import { api, apiImagen, mensajeDe } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import type { RegistroSanitarioFila } from "@/modulos/cat/tipos";

type Respuesta = { filas: RegistroSanitarioFila[]; resumen: { vigentes: number; ambar: number; rojo: number; vencidos: number; dias_aviso: number } };
const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activo", "ok"], INACTIVE: ["Inactivo", "neutral"] };
const SEMAFORO = [{ value: "OK", label: "Vigente" }, { value: "AMBER", label: "Ámbar" }, { value: "RED", label: "Rojo" }, { value: "EXPIRED", label: "Vencido" }, { value: "MISSING", label: "Sin registro" }];

async function verCertificado(id: string) {
  const url = await apiImagen(`/v1/cat/sanitarios/${id}/certificado`);
  if (!url) { toast.error("No hay certificado adjunto."); return; }
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** CAT-10 Registros sanitarios (RN-CAT-09): autoridad, número y vencimiento con semáforo; adjunto del certificado. */
export default function RegistrosSanitarios() {
  const { me, marca, can } = useSesion();
  const puedeEditar = can("cat.sanitary.manage");
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [buscar, setBuscar] = useState("");
  const [marcaFiltro, setMarcaFiltro] = useState("");
  const [autoridad, setAutoridad] = useState("");
  const [semaforo, setSemaforo] = useState("");
  const [abierto, setAbierto] = useState<RegistroSanitarioFila | null>(null);
  const brand = marca !== "ALL" ? marca : marcaFiltro;

  useEffect(() => {
    let vigente = true;
    api<Respuesta>(`/v1/cat/sanitarios${brand ? `?brand_id=${brand}` : ""}`)
      .then((d) => { if (vigente) { setDatos(d); setError(""); } }).catch((err) => vigente && setError(mensajeDe(err)));
    return () => { vigente = false; };
  }, [brand, version]);
  const recargar = () => setVersion((n) => n + 1);

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (datos?.filas ?? []).filter((p) => (!autoridad || p.sanitary_authority === autoridad) && (!semaforo || p.sanitario.code === semaforo)
      && (!q || p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || (p.sanitary_registry ?? "").toLowerCase().includes(q)));
  }, [datos, buscar, autoridad, semaforo]);

  const r = datos?.resumen;
  const columnas: Column<RegistroSanitarioFila>[] = [
    { key: "code", header: "Código", hideOnMobile: true, render: (p) => <span className="whitespace-nowrap font-mono">{p.code}</span> },
    { key: "name", header: "Producto", cardTitle: true, render: (p) => <div className="min-w-[170px]">{p.name}</div> },
    ...(brand ? [] : [{ key: "brand", header: "Marca", render: (p: RegistroSanitarioFila) => p.brand_name ? <Badge tone="primary">{p.brand_name}</Badge> : "—" }]),
    { key: "auth", header: "Autoridad", render: (p) => p.sanitary_authority },
    { key: "reg", header: "Número de registro", hideOnMobile: true, render: (p) => p.sanitary_registry ? <span className="whitespace-nowrap font-mono text-[12.5px]">{p.sanitary_registry}</span> : <span className="text-muted">—</span> },
    { key: "exp", header: "Vence", render: (p) => <span className="whitespace-nowrap">{fecha(p.sanitary_registry_expires)}</span> },
    { key: "days", header: "Días", align: "right", hideOnMobile: true, render: (p) => p.sanitario.days === null ? "—" : <span className="tabular-nums">{numero(p.sanitario.days)}</span> },
    { key: "sem", header: "Semáforo", render: (p) => <Badge tone={p.sanitario.tone}>{p.sanitario.label}</Badge> },
    { key: "cert", header: "Certificado", hideOnMobile: true, render: (p) => p.sanitary_certificate
      ? <Button size="sm" variant="ghost" icon={FileText} onClick={(e) => { e.stopPropagation(); verCertificado(p.id); }}>Ver</Button> : <span className="text-muted">—</span> },
    { key: "status", header: "Estado", render: (p) => <StatusBadge status={p.status} labels={ESTADOS} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`Autoridad, número y vencimiento con semáforo a ${r?.dias_aviso ?? 90}, 30 y 0 días. SENASA para carne fresca; DIGESA para industrializados y envasados (D-CAT-04, provisional).`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Vigentes" icono={ShieldCheck} valor={r ? numero(r.vigentes) : undefined} detalle={r ? `Más de ${r.dias_aviso} días` : undefined} />
        <Cifra titulo={`Ámbar (≤ ${r?.dias_aviso ?? 90} días)`} icono={ShieldAlert} valor={r ? numero(r.ambar) : undefined} detalle="Programar la renovación" />
        <Cifra titulo="Rojo (≤ 30 días)" icono={ShieldAlert} valor={r ? numero(r.rojo) : undefined} detalle="Renovar ya" />
        <Cifra titulo="Vencidos o sin registro" icono={ShieldX} destacada valor={r ? numero(r.vencidos) : undefined} detalle="No se publican en la web (RN-CAT-09)" />
      </div>

      <DataTable columns={columnas} rows={visibles} rowKey={(p) => p.id} loading={!datos && !error} error={error} onRetry={recargar}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar producto o número de registro…" }}
        onRowClick={(p) => setAbierto(p)} empty="No hay productos con esos filtros."
        toolbar={<>
          {marca === "ALL" && me.brands.length > 1 && (
            <div className="w-44"><Select value={marcaFiltro} onChange={(e) => setMarcaFiltro(e.target.value)} placeholder="Marca: todas" options={me.brands.map((b) => ({ value: b.id, label: b.name }))} /></div>
          )}
          <div className="w-40"><Select value={autoridad} onChange={(e) => setAutoridad(e.target.value)} placeholder="Autoridad: todas" options={[{ value: "SENASA", label: "SENASA" }, { value: "DIGESA", label: "DIGESA" }]} /></div>
          <div className="w-40"><Select value={semaforo} onChange={(e) => setSemaforo(e.target.value)} placeholder="Semáforo: todos" options={SEMAFORO} /></div>
        </>} />

      {abierto && <Registro p={abierto} puedeEditar={puedeEditar} onClose={() => setAbierto(null)} onHecho={() => { setAbierto(null); recargar(); }} />}
    </div>
  );
}

function Registro({ p, puedeEditar, onClose, onHecho }: { p: RegistroSanitarioFila; puedeEditar: boolean; onClose: () => void; onHecho: () => void }) {
  const [v, setV] = useState({
    sanitary_authority: p.sanitary_authority, sanitary_registry: p.sanitary_registry ?? "", sanitary_registry_expires: p.sanitary_registry_expires?.slice(0, 10) ?? "",
    sanitary_alert_days: p.sanitary_alert_days ? String(p.sanitary_alert_days) : "", activar: p.status !== "ACTIVE",
  });
  const [archivo, setArchivo] = useState<File | null>(null);

  const ficha = (
    <div className="sm:col-span-2">
      <DetailList items={[
        { label: "Autoridad", value: p.sanitary_authority },
        { label: "Número actual", value: p.sanitary_registry ?? "—" },
        { label: "Vence", value: fecha(p.sanitary_registry_expires) },
        { label: "Semáforo", value: <Badge tone={p.sanitario.tone}>{p.sanitario.label}</Badge> },
        { label: "Certificado", value: p.sanitary_certificate ? <button type="button" className="text-primary underline" onClick={() => verCertificado(p.id)}>Ver certificado</button> : "—" },
        { label: "Estado del producto", value: <StatusBadge status={p.status} labels={ESTADOS} /> },
      ]} />
    </div>
  );

  return (
    <Dialogo titulo={`Registro sanitario · ${p.name}`} boton={puedeEditar ? "Guardar registro" : "Cerrar"} onClose={onClose}
      aviso={puedeEditar ? "Registra la renovación vigente. El certificado puede ser PDF, JPG o PNG de hasta 5 MB." : undefined}
      enviar={async () => {
        if (!puedeEditar) { onClose(); return; }
        await api(`/v1/cat/sanitarios/${p.id}`, { method: "PUT", body: { ...v, sanitary_alert_days: v.sanitary_alert_days ? Number(v.sanitary_alert_days) : null } });
        if (archivo) {
          const fd = new FormData();
          fd.append("certificado", archivo);
          await api(`/v1/cat/sanitarios/${p.id}/certificado`, { method: "POST", body: fd });
        }
        toast.ok("Registro sanitario actualizado");
        onHecho();
      }}>
      {(errores) => <>
        {ficha}
        {!puedeEditar && <div className="sm:col-span-2"><Alert tone="info">Tu rol solo consulta: renovar exige el permiso cat.sanitary.manage.</Alert></div>}
        {puedeEditar && <>
          <Field label="Autoridad" required error={errores.sanitary_authority}>
            <Select value={v.sanitary_authority} onChange={(e) => setV({ ...v, sanitary_authority: e.target.value })} options={[{ value: "SENASA", label: "SENASA" }, { value: "DIGESA", label: "DIGESA" }]} />
          </Field>
          <Field label="Número de registro" required error={errores.sanitary_registry}>
            <Input value={v.sanitary_registry} maxLength={40} className="font-mono" onChange={(e) => setV({ ...v, sanitary_registry: e.target.value })} />
          </Field>
          <Field label="Vence" required error={errores.sanitary_registry_expires}>
            <Input type="date" value={v.sanitary_registry_expires} onChange={(e) => setV({ ...v, sanitary_registry_expires: e.target.value })} />
          </Field>
          <Field label="Días de aviso propios" error={errores.sanitary_alert_days} hint="Vacío: los de la empresa.">
            <Input type="number" min={1} max={365} value={v.sanitary_alert_days} onChange={(e) => setV({ ...v, sanitary_alert_days: e.target.value })} />
          </Field>
          <Field label="Certificado" error={errores.certificado} className="sm:col-span-2">
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              className="block w-full text-[13px] file:mr-3 file:rounded-[8px] file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-[13px]" />
          </Field>
          {p.status !== "ACTIVE" && <div className="sm:col-span-2"><Checkbox checked={v.activar} onChange={(si) => setV({ ...v, activar: si })} label="Activar el producto" /></div>}
        </>}
      </>}
    </Dialogo>
  );
}
