"use client";

import { useRouter } from "next/navigation";
import { Badge, Button, DataTable, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { ORIGEN_PIN, celular, type Direccion } from "./tipos";

/** Direcciones de un cliente con su zona, pin, quién recibe y último uso (CLI-02 y CLI-05). */
export function TablaDirecciones({ direcciones, puedeEditar, onCambio }: { direcciones: Direccion[]; puedeEditar: boolean; onCambio: () => void }) {
  const router = useRouter();

  async function accion(a: Direccion, que: "predeterminar" | "desactivar") {
    if (que === "desactivar" && !(await confirmAction({ title: `¿Desactivar «${a.label}»?`, message: "Los pedidos que ya la usaron la conservan.", confirmLabel: "Desactivar", danger: true }))) return;
    try {
      await api(`/v1/cli/direcciones/${a.id}/${que}`, { method: "POST" });
      toast.ok(que === "predeterminar" ? "Dirección predeterminada" : "Dirección desactivada");
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const columnas: Column<Direccion>[] = [
    {
      key: "label", header: "Etiqueta", cardTitle: true,
      render: (a) => <span className="flex flex-wrap items-center gap-1.5">{a.label}{a.is_default && <Badge tone="ok">Predeterminada</Badge>}</span>,
    },
    { key: "address_line", header: "Dirección", render: (a) => <div className="min-w-0"><div>{a.address_line}</div><div className="text-[12px] text-muted">{a.district} · {a.reference}</div></div> },
    { key: "zone_name", header: "Zona", render: (a) => a.zone_name ?? <Badge tone="bad">Fuera de cobertura</Badge> },
    {
      key: "pin_source", header: "Pin", hideOnMobile: true,
      render: (a) => <Badge tone={a.confirmado ? "ok" : "warn"}>
        {ORIGEN_PIN[a.pin_source ?? ""] ?? "Sin pin"}{!a.confirmado && a.geocode_confidence != null ? ` · ${a.geocode_confidence.toFixed(2)}` : ""}
      </Badge>,
    },
    { key: "contact_name", header: "Recibe", hideOnMobile: true, render: (a) => <div><div>{a.contact_name ?? "—"}</div><div className="font-mono text-[12px] text-muted">{celular(a.contact_phone)}</div></div> },
    { key: "ultimo_uso", header: "Último uso", hideOnMobile: true, render: (a) => fecha(a.ultimo_uso) },
    ...(puedeEditar ? [{
      key: "acciones", header: "",
      render: (a: Direccion) => (
        <div className="flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {!a.is_default && <Button size="sm" onClick={() => accion(a, "predeterminar")}>Predeterminar</Button>}
          <Button size="sm" variant="ghost" onClick={() => accion(a, "desactivar")}>Desactivar</Button>
        </div>
      ),
    }] : []),
  ];

  return <DataTable rows={direcciones} columns={columnas} rowKey={(a) => a.id} empty="El cliente no tiene direcciones con pin."
    onRowClick={(a) => router.push(`/m/cli/cli-06?cliente=${a.customer_id}&direccion=${a.id}`)} />;
}
