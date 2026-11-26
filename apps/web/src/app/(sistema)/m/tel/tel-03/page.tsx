"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, FiltroSelect, Input, PageHeader, Select, toast, type Column } from "@/components/ui";
import { usePagina, type Pagina } from "@/lib/paginas";
import { api, mensajeDe } from "@/lib/api";
import { Dialogo } from "@/modulos/mae/Dialogo";
import { TelefoniaApagada, useTelefonia } from "@/modulos/tel/comun";

type Opcion = { value: string; label: string };
type Numero = {
  id: string; e164: string; number_kind: string; tipo: string; brand_id: string | null; marca: string; menu_id: string | null; ring_group_id: string | null;
  atiende: string; forwarded_from: string[]; provider_ref: string | null; status: string;
};
type Lista = Pagina<Numero> & {
  opciones: { tipos: Opcion[]; estados: Opcion[]; marcas: Opcion[]; menus: Opcion[]; grupos: Opcion[] };
  whatsapp: { numero: string; nombre: string }[]; puede: boolean;
};

/**
 * TEL-03 Números y desvíos: los números de la central, generales o por marca, con el menú de voz o el grupo que los
 * atiende, y los celulares de la publicidad que el operador desvía a la central.
 */
export default function Numeros() {
  const encendida = useTelefonia();
  const [f, setF] = useState({ estado: "", tipo: "", marca: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [editar, setEditar] = useState<Numero | "nuevo" | null>(null);
  const pag = usePagina(JSON.stringify(f));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    if (!encendida) return;
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/tel/numeros?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs, encendida]);
  useEffect(() => cargar(), [cargar]);

  if (!encendida) return <div className="grid gap-5"><PageHeader description="Los números de la central y los celulares desviados." /><TelefoniaApagada /></div>;
  const columnas: Column<Numero>[] = [
    { key: "numero", sortable: true, header: "Número", cardTitle: true, render: (n) => <div><p className="font-mono font-semibold text-ink">{n.e164}</p>{n.provider_ref && <p className="font-mono text-[11.5px] text-muted">{n.provider_ref}</p>}</div> },
    { key: "tipo", sortable: true, header: "Tipo", render: (n) => <span className="text-[12.5px]">{n.tipo}</span> },
    { key: "marca", sortable: true, header: "Marca", render: (n) => <span className="text-[12.5px]">{n.marca}</span> },
    { key: "atiende", header: "Atiende", render: (n) => <span className="text-[12.5px]">{n.atiende}</span> },
    { key: "desvios", header: "Celulares desviados", render: (n) => n.forwarded_from.length ? <div className="flex flex-wrap gap-1">{n.forwarded_from.map((x) => <Badge key={x} tone="neutral">{x}</Badge>)}</div> : <span className="text-muted">—</span> },
    { key: "status", sortable: true, sortKey: "estado", header: "Estado", render: (n) => n.status === "ACTIVE" ? <Badge tone="ok">Activo</Badge> : <Badge tone="neutral">Inactivo</Badge> },
  ];
  const o = lista?.opciones;
  return (
    <div className="grid gap-5">
      <PageHeader description="Los números a los que llaman los clientes: uno general con el menú de voz y, si se quiere, números por marca que suenan directo en su grupo. Los celulares de la publicidad no se cambian: el operador desvía sus llamadas a la central." />
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={lista?.puede ? (n) => setEditar(n) : undefined} empty="Ningún número con estos filtros." search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar número o celular desviado…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Estado" ancho={150} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={o?.estados ?? []} />
          <FiltroSelect etiqueta="Tipo" ancho={190} value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} options={o?.tipos ?? []} />
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={180} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={[{ value: "GENERAL", label: "General" }, ...(o?.marcas ?? [])]} />
          {lista?.puede && <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditar("nuevo")}>Agregar número</Button>}
        </>} />
      <Alert tone="info">Por defecto la central usa un número general con un menú que ofrece cada marca. Los números de WhatsApp siguen en la app; solo sus llamadas de voz se desvían{lista?.whatsapp.length ? ` (${lista.whatsapp.map((w) => w.numero).join(", ")})` : ""}.</Alert>
      {editar && lista && <EditarNumero n={editar === "nuevo" ? null : editar} o={lista.opciones} onClose={() => setEditar(null)} onListo={() => { setEditar(null); cargar(); }} />}
    </div>
  );
}

function EditarNumero({ n, o, onClose, onListo }: { n: Numero | null; o: Lista["opciones"]; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ e164: n?.e164 ?? "", number_kind: n?.number_kind ?? "LANDLINE_LIMA", brand_id: n?.brand_id ?? "", destino: n?.ring_group_id ? "GRUPO" : "MENU",
    menu_id: n?.menu_id ?? o.menus[0]?.value ?? "", ring_group_id: n?.ring_group_id ?? "", desvios: (n?.forwarded_from ?? []).join(", "), provider_ref: n?.provider_ref ?? "", status: n?.status ?? "ACTIVE" });
  return (
    <Dialogo titulo={n ? `Número ${n.e164}` : "Nuevo número"} boton="Guardar" onClose={onClose} aviso="Un número que deja de usarse se pasa a inactivo: no se borra."
      enviar={async () => {
        await api(n ? `/v1/tel/numeros/${n.id}` : "/v1/tel/numeros", { method: n ? "PUT" : "POST", body: {
          e164: d.e164, number_kind: d.number_kind, brand_id: d.brand_id || null, menu_id: d.destino === "MENU" ? d.menu_id || null : null,
          ring_group_id: d.destino === "GRUPO" ? d.ring_group_id || null : null, forwarded_from: d.desvios.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean),
          provider_ref: d.provider_ref || null, status: d.status } });
        toast.ok("Número guardado");
        onListo();
      }}>
      {(errores) => (
        <>
          <Field label="Número" required error={errores.e164} hint="Con código de país, por ejemplo +5117085500."><Input value={d.e164} onChange={(e) => setD({ ...d, e164: e.target.value })} /></Field>
          <Field label="Tipo" required error={errores.number_kind}><Select value={d.number_kind} onChange={(e) => setD({ ...d, number_kind: e.target.value })} options={o.tipos} /></Field>
          <Field label="Marca" error={errores.brand_id}><Select value={d.brand_id} onChange={(e) => setD({ ...d, brand_id: e.target.value })} placeholder="General (todas las marcas)" options={o.marcas} /></Field>
          <Field label="Atiende con" required><Select value={d.destino} onChange={(e) => setD({ ...d, destino: e.target.value })} options={[{ value: "MENU", label: "El menú de voz" }, { value: "GRUPO", label: "Un grupo de llamada" }]} /></Field>
          {d.destino === "MENU"
            ? <Field label="Menú de voz" error={errores.menu_id}><Select value={d.menu_id} onChange={(e) => setD({ ...d, menu_id: e.target.value })} placeholder="Elige el menú" options={o.menus} /></Field>
            : <Field label="Grupo de llamada" error={errores.ring_group_id}><Select value={d.ring_group_id} onChange={(e) => setD({ ...d, ring_group_id: e.target.value })} placeholder="Elige el grupo" options={o.grupos} /></Field>}
          <Field label="Estado" required error={errores.status}><Select value={d.status} onChange={(e) => setD({ ...d, status: e.target.value })} options={o.estados} /></Field>
          <Field label="Celulares desviados" error={errores.forwarded_from} className="sm:col-span-2" hint="Los celulares de la publicidad que el operador desvía a este número, separados por coma.">
            <Input value={d.desvios} onChange={(e) => setD({ ...d, desvios: e.target.value })} placeholder="987 650 101, 987 650 102" />
          </Field>
          <Field label="Referencia del proveedor" error={errores.provider_ref}><Input maxLength={60} value={d.provider_ref} onChange={(e) => setD({ ...d, provider_ref: e.target.value })} /></Field>
        </>
      )}
    </Dialogo>
  );
}
