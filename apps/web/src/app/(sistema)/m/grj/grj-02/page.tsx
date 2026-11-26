"use client";

import { useState } from "react";
import { Link2, Unlink, Plus } from "lucide-react";
import { Alert, Button, DataTable, Field, Input, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { kg, numero, soles } from "@/lib/formato";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { BuscaVariante } from "@/modulos/alm/comunes";
import type { Variante } from "@/modulos/alm/tipos";
import { CifraLink, Seccion, useDatos, useOpcionesGrj, type Num } from "@/modulos/grj/comunes";

type Mapeo = { id: string; supplier_id: string; farm_item_code: string; farm_item_name: string | null; variant_id: string; sku: string; variant_name: string; sale_mode: string;
  conversion_factor: Num; transfer_price: Num; status: string; lines: number; received_kg: Num };
type SinMapear = { code: string; name: string | null; count: number; kg: Num; unit_price: Num };

/** GRJ-02 Mapeo de productos: cada ítem de la granja con su variante en Aycha, el factor de conversión y el precio de transferencia. */
export default function Mapeo() {
  const op = useOpcionesGrj();
  const { datos, recargar } = useDatos<{ data: Mapeo[]; unmapped: SinMapear[] }>("/v1/grj/mapeos");
  const [editar, setEditar] = useState<Partial<Mapeo> | null>(null);
  const columnas: Column<Mapeo>[] = [
    { key: "farm_item_code", header: "Ítem de la granja", cardTitle: true, render: (m) => <div className="min-w-[140px]"><p className="font-mono font-semibold">{m.farm_item_code}</p><p className="text-[12px] text-muted">{m.farm_item_name ?? ""}</p></div> },
    { key: "variant_name", header: "Variante en Aycha", render: (m) => <div><p>{m.variant_name}</p><p className="font-mono text-[12px] text-muted">{m.sku}</p></div> },
    { key: "conversion_factor", header: "Factor", align: "right", render: (m) => numero(m.conversion_factor, 4) },
    { key: "transfer_price", header: "Precio de transferencia", align: "right", render: (m) => m.transfer_price !== null ? `${soles(m.transfer_price)} / kg` : "—" },
    { key: "received_kg", header: "Recibido", align: "right", hideOnMobile: true, render: (m) => `${kg(m.received_kg)} · ${m.lines} líneas` },
    { key: "status", header: "Estado", render: (m) => <StatusBadge status={m.status} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="La granja usa sus propios códigos. Cada ítem se mapea una vez a su variante en Aycha; un envío con un ítem sin mapear queda detenido hasta mapearlo, y al mapearlo se reprocesa solo."
        actions={op?.can.mapping && <Button variant="primary" icon={Plus} onClick={() => setEditar({})}>Nuevo mapeo</Button>} />
      <div className="grid grid-cols-2 gap-3">
        <CifraLink destacada titulo="Ítems mapeados" valor={datos ? numero(datos.data.filter((m) => m.status === "ACTIVE").length) : undefined} icono={Link2} />
        <CifraLink titulo="Ítems sin mapear" valor={datos ? numero(datos.unmapped.length) : undefined} detalle="Detienen sus envíos" icono={Unlink} tono={datos?.unmapped.length ? "bad" : "ok"} />
      </div>
      {datos && datos.unmapped.length > 0 && <Seccion titulo="Sin mapear">
        <div className="space-y-2">{datos.unmapped.map((u) => (
          <div key={u.code} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-[13px]">
            <span><b className="font-mono">{u.code}</b> {u.name ?? ""} · {u.count} línea(s) · {kg(u.kg)} · {soles(u.unit_price)} / kg</span>
            {op?.can.mapping && <Button size="sm" variant="primary" onClick={() => setEditar({ farm_item_code: u.code, farm_item_name: u.name, transfer_price: u.unit_price })}>Mapear</Button>}
          </div>))}</div>
      </Seccion>}
      {op && !op.can.mapping && <Alert tone="info">El mapeo lo mantienen Compras y Producción.</Alert>}
      <DataTable rows={datos?.data ?? []} rowKey={(m) => m.id} loading={!datos} columns={columnas} onRowClick={(m) => op?.can.mapping && setEditar(m)} empty="Sin ítems mapeados." />
      {editar && <FormMapeo m={editar} farmId={op?.farm?.id ?? null} onClose={() => setEditar(null)} onGuardado={() => { setEditar(null); recargar(); }} />}
    </div>
  );
}

function FormMapeo({ m, farmId, onClose, onGuardado }: { m: Partial<Mapeo>; farmId: string | null; onClose: () => void; onGuardado: () => void }) {
  const [v, setV] = useState<Variante | null>(null);
  const [f, setF] = useState({ farm_item_code: m.farm_item_code ?? "", farm_item_name: m.farm_item_name ?? "", conversion_factor: String(m.conversion_factor ?? "1"), transfer_price: String(m.transfer_price ?? ""), status: m.status ?? "ACTIVE" });
  const set = (k: keyof typeof f) => (x: { target: { value: string } }) => setF({ ...f, [k]: x.target.value });
  return (
    <Dialogo titulo={m.id ? `Mapeo de ${m.farm_item_code}` : "Mapear ítem de la granja"} boton="Guardar" onClose={onClose}
      enviar={async () => {
        const r = await api<{ reprocessed?: number }>("/v1/grj/mapeos", { method: "POST", body: { supplier_id: farmId, ...f, variant_id: v?.id ?? m.variant_id, conversion_factor: Number(f.conversion_factor.replace(",", ".")),
          transfer_price: f.transfer_price ? Number(f.transfer_price.replace(",", ".")) : null } });
        toast.ok(r.reprocessed ? `Mapeo guardado: ${r.reprocessed} envío(s) reprocesados` : "Mapeo guardado"); onGuardado();
      }}>
      {(e) => <>
        <Field label="Código de la granja" required error={e.farm_item_code}><Input value={f.farm_item_code} maxLength={40} disabled={Boolean(m.id)} onChange={set("farm_item_code")} /></Field>
        <Field label="Nombre en la granja" error={e.farm_item_name}><Input value={f.farm_item_name} maxLength={200} onChange={set("farm_item_name")} /></Field>
        <Field label="Variante en Aycha" required error={e.variant_id} className="sm:col-span-2" hint={m.variant_name ? `Actual: ${m.sku} · ${m.variant_name}` : undefined}><BuscaVariante value={v} onChange={setV} invalid={Boolean(e.variant_id)} /></Field>
        <Field label="Factor de conversión" error={e.conversion_factor} hint="Kg de Aycha por kg de la granja"><Input inputMode="decimal" value={f.conversion_factor} onChange={set("conversion_factor")} /></Field>
        <Field label="Precio de transferencia" error={e.transfer_price}><Input inputMode="decimal" prefix="S/" suffix="/ kg" value={f.transfer_price} onChange={set("transfer_price")} /></Field>
        {m.id && <Field label="Estado" error={e.status}><Select value={f.status} onChange={set("status")} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} /></Field>}
      </>}
    </Dialogo>
  );
}
