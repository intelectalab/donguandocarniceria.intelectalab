"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListChecks, Upload } from "lucide-react";
import { Alert, ArchivoImportar, Badge, Button, Cifra, DataTable, Field, PageHeader, Select, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { celular, type FilaImportada } from "@/modulos/cli/tipos";

type Revision = { filas: FilaImportada[]; resumen: { filas: number; nuevas: number; duplicadas: number; con_error: number; maximo: number } };
const ORIGENES = [{ value: "WHATSAPP", label: "Agenda de WhatsApp" }, { value: "WEB", label: "Base de la web" }, { value: "OTHER", label: "Otro" }];
const EJEMPLO = "nombre;celular;correo;documento;distrito\nMaría Torres;987 654 321;maria@correo.pe;45879632;Santiago de Surco\nRestaurante El Tumi;+51 912 345 678;;20601234561;Miraflores";

/**
 * CLI-12 Importar clientes: pega o sube un CSV (nombre; celular; correo; documento; distrito),
 * revísalo (celular a +51, duplicados en la base y dentro del archivo) y confirma fila por fila.
 * Las direcciones no se importan: sin pin no se guardan (RN-CLI-02).
 */
export default function ImportarClientes() {
  const router = useRouter();
  const { can } = useSesion();
  const [texto, setTexto] = useState("");
  const [origen, setOrigen] = useState("WHATSAPP");
  const [rev, setRev] = useState<{ texto: string; r: Revision } | null>(null);
  const [acciones, setAcciones] = useState<Record<number, "CREATE" | "SKIP">>({});
  const [ocupado, setOcupado] = useState<"" | "revisar" | "importar">("");

  const r = rev?.texto === texto ? rev.r : null;

  async function revisar() {
    setOcupado("revisar");
    try {
      const res = await api<Revision>("/v1/cli/importar/revisar", { method: "POST", body: { texto } });
      setRev({ texto, r: res });
      setAcciones({});
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  async function importar() {
    if (!r) return;
    setOcupado("importar");
    try {
      const res = await api<{ creados: number; omitidos: number; marcados: number }>("/v1/cli/importar", { method: "POST", body: { texto, origen, acciones: { ...Object.fromEntries(r.filas.map((f) => [f.fila, f.accion])), ...acciones } } });
      toast.ok(`Importación lista: ${res.creados} creado(s), ${res.omitidos} omitido(s)${res.marcados ? `, ${res.marcados} marcado(s) como posible duplicado` : ""}.`);
      router.push("/m/cli/cli-01");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  const accion = (f: FilaImportada) => acciones[f.fila] ?? f.accion;
  const fija = (f: FilaImportada) => Boolean(f.error) || f.motivo === "SAME_DOC";
  const crear = r ? r.filas.filter((f) => !fija(f) && accion(f) === "CREATE").length : 0;

  const columnas: Column<FilaImportada>[] = [
    { key: "fila", header: "Fila", align: "right", hideOnMobile: true, render: (f) => <span className="font-mono text-muted">{f.fila}</span> },
    { key: "full_name", header: "Nombre", cardTitle: true, render: (f) => f.full_name || <span className="text-muted">—</span> },
    { key: "phone", header: "Celular", render: (f) => f.phone ? <span className="font-mono whitespace-nowrap">{celular(f.phone)}</span> : <span className="font-mono text-muted">{f.phone_raw || "—"}</span> },
    { key: "doc", header: "Documento", hideOnMobile: true, render: (f) => f.doc_type === "NONE" ? <span className="text-muted">—</span> : <span className="font-mono">{f.doc_type} {f.doc_number}</span> },
    { key: "email", header: "Correo", hideOnMobile: true, render: (f) => f.email ?? <span className="text-muted">—</span> },
    {
      key: "revision", header: "Revisión",
      render: (f) => f.error ? <Badge tone="bad">{f.error}</Badge>
        : f.existe ? <span className="text-[12.5px]"><Badge tone="warn">{f.motivo_texto}</Badge> con <Link href={`/m/cli/cli-02?id=${f.existe.id}`} className="font-medium underline" target="_blank">{f.existe.nombre}</Link></span>
        : f.repetida_en ? <Badge tone="warn">Repite la fila {f.repetida_en}</Badge>
        : <Badge tone="ok">Nuevo</Badge>,
    },
    {
      key: "accion", header: "Qué hacer",
      render: (f) => fija(f) ? <span className="text-[12.5px] text-muted">Se omite</span> : (
        <div className="w-[190px]">
          <Select aria-label={`Qué hacer con la fila ${f.fila}`} value={accion(f)} onChange={(e) => setAcciones((a) => ({ ...a, [f.fila]: e.target.value as "CREATE" | "SKIP" }))}
            className="!min-h-8 h-8 py-1 text-[12.5px]"
            options={[{ value: "CREATE", label: f.existe || f.repetida_en ? "Crear y marcar duplicado" : "Crear" }, { value: "SKIP", label: "Omitir" }]} />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Trae clientes de la agenda de WhatsApp o de la web. Primero se revisa todo y nada se guarda hasta que confirmes. Las direcciones se piden después con el enlace de ubicación." />

      <section className="grid gap-4 rounded-xl border border-line bg-surface p-4 shadow-card lg:grid-cols-[minmax(0,1fr)_260px]">
        <Field label="Clientes (una fila por cliente)" hint="Descarga el modelo en Excel, llénalo y súbelo, o sube un CSV. También puedes pegar las filas: nombre; celular; correo; documento; distrito.">
          <Textarea rows={8} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={EJEMPLO} className="font-mono text-[12.5px]" />
        </Field>
        <div className="flex flex-col gap-3">
          <Field label="De dónde vienen"><Select value={origen} onChange={(e) => setOrigen(e.target.value)} options={ORIGENES} /></Field>
          <div className="[&>div]:flex-col [&>div>*]:w-full">
            <ArchivoImportar plantilla="/v1/cli/importar/plantilla" archivo="/v1/cli/importar/archivo" nombre="plantilla-clientes.xlsx"
              disabled={!can("cli.customer.manage")} onTexto={setTexto} />
          </div>
          <Button onClick={() => setTexto(EJEMPLO)} variant="ghost">Ver un ejemplo</Button>
          <Button variant="primary" icon={ListChecks} loading={ocupado === "revisar"} disabled={!texto.trim() || !can("cli.customer.manage")} onClick={revisar} className="mt-auto">Revisar</Button>
        </div>
      </section>

      {rev && !r && <Alert tone="info">Cambiaste el texto: vuelve a revisarlo antes de importar.</Alert>}
      {r && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Filas" icono={ListChecks} destacada valor={numero(r.resumen.filas)} detalle={`Máximo ${numero(r.resumen.maximo)} por archivo`} />
          <Cifra titulo="Nuevos" valor={numero(r.resumen.nuevas)} tono="ok" detalle="No están en la base" />
          <Cifra titulo="Posibles duplicados" valor={numero(r.resumen.duplicadas)} tono={r.resumen.duplicadas ? "warn" : undefined} detalle="Se omiten salvo que elijas crear" />
          <Cifra titulo="Con error" valor={numero(r.resumen.con_error)} tono={r.resumen.con_error ? "bad" : undefined} detalle="Se omiten siempre" />
        </div>
        {r.resumen.filas > r.resumen.maximo && <Alert tone="warn">El archivo tiene más de {numero(r.resumen.maximo)} filas: impórtalo en partes.</Alert>}
        <DataTable rows={r.filas} columns={columnas} rowKey={(f) => String(f.fila)} empty="El texto no tiene filas." />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-[13px] text-muted">Se crearán {numero(crear)} cliente(s).</span>
          <Button variant="primary" icon={Upload} loading={ocupado === "importar"} disabled={!crear} onClick={importar}>Confirmar importación</Button>
        </div>
      </>}
    </div>
  );
}
