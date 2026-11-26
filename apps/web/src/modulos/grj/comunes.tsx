"use client";

import type { Etiquetas, Num } from "@/modulos/com/tipos";
import { opcionesDe } from "@/modulos/com/comunes";

export { useDatos, qs, accion, CifraLink, FiltroSelect, Barras, Seccion, limpio, mesActual, nombreMes, hoyLima } from "@/modulos/com/comunes";

export type OpcionesGrj = {
  farm: { id: string; name: string; doc_number: string } | null;
  farms: { id: string; legal_name: string; trade_name: string | null; doc_number: string }[];
  companies: { id: string; legal_name: string; ruc: string }[];
  warehouses: { id: string; code: string; name: string; wh_type: string; establishment_id: string }[];
  scales: { id: string; code: string; name: string; establishment_id: string }[];
  default_warehouse_id: string | null; tolerance_pct: number; today: string; expected_today: string | null;
  can: { link: boolean; mapping: boolean; receive: boolean; close: boolean; agree: boolean };
};

const grj = opcionesDe<OpcionesGrj>("/v1/grj/opciones");
export const useOpcionesGrj = grj.usar;
export const olvidarOpcionesGrj = grj.olvidar;

export const MODO: Record<string, string> = { NTI: "Nota de transferencia interna", INVOICE: "Factura" };
export const VINCULO: Etiquetas = { ACTIVE: ["Vigente", "ok"], SCHEDULED: ["Programado", "primary"], ENDED: ["Terminado", "neutral"], CLOSED: ["Cerrado", "neutral"] };
export const ENVIO: Etiquetas = {
  RECEIVED_PENDING: ["Por recibir", "warn"], RECEIVED: ["Recibido", "ok"], DISPUTED: ["En disputa", "bad"], ERROR: ["Con error", "bad"], PENDING_MAPPING: ["Falta mapeo", "warn"],
};
export const CONCILIACION: Etiquetas = { OPEN: ["Abierta", "warn"], AGREED: ["Acordada con la granja", "primary"], CLOSED: ["Cerrada", "ok"] };
export const DOC_GRANJA: Record<string, string> = { NTI: "NTI", INVOICE: "Factura", GUIDE: "Guía" };
export const DECISION_DISPUTA: Record<string, string> = {
  ACCEPT_RECEIVED: "Vale lo recibido (la granja ajusta)", ACCEPT_SENT: "Vale lo enviado", CREDIT_NOTE: "La granja emite una nota de crédito",
};
export type { Num };
