<?php

namespace App\Modulos\Cli\Services;

use App\Models\User;
use App\Modulos\Cli\Models\Customer;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Reglas del cliente: alta y edición (RN-CLI-01, 03, 07, 11), alta rápida (CA-CLI-01), bloqueo
 * (RN-CLI-09), consentimiento de publicidad (RN-CLI-13) y validación del documento (RN-CLI-12).
 * Otros módulos (PED, CRM, POS) usan altaRapida() y buscarPorCelular().
 */
final class Clientes
{
    public const TIPOS = ['PERSON', 'RESTAURANT', 'BUSINESS', 'CONSIGNMENT_POINT', 'RELATED', 'OTHER'];

    public const CANALES = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'WEB', 'POS', 'PHONE', 'B2B', 'IMPORT', 'OTHER'];

    /** Cliente activo (o bloqueado) con ese celular como principal o alterno. Los fusionados no cuentan. */
    public static function buscarPorCelular(?string $raw): ?Customer
    {
        $p = Celulares::normalizar($raw);
        if (! $p) {
            return null;
        }

        return Customer::whereNull('merged_into_id')->where('status', '<>', 'INACTIVE')
            ->where(fn ($q) => $q->where('phone', $p)->orWhere('phone_alt', $p))
            ->orderBy('created_at')->first();
    }

    public static function buscarPorDocumento(string $tipo, ?string $numero, ?string $menos = null): ?Customer
    {
        if ($tipo === 'NONE' || ! $numero) {
            return null;
        }

        return Customer::whereNull('merged_into_id')->where('doc_type', $tipo)->where('doc_number', Documentos::limpiar($numero))
            ->when($menos, fn ($q) => $q->where('id', '<>', $menos))->first();
    }

    /**
     * Crea el cliente y registra los posibles duplicados (RN-CLI-07).
     *
     * @return array{customer: Customer, duplicados: array}
     */
    public static function crear(array $d, User $quien): array
    {
        $datos = self::limpiar($d);
        if (! $datos['phone'] && $datos['doc_type'] === 'NONE') {
            RuleError::fail('RN-CLI-11', 'Sin documento, el celular es el identificador del cliente: escríbelo.');
        }
        if ($otro = self::buscarPorDocumento($datos['doc_type'], $datos['doc_number'])) {
            RuleError::fail('RN-CLI-11', "Ya existe {$otro->nombre()} con {$datos['doc_type']} {$datos['doc_number']}: un cliente es único por tipo y número de documento.");
        }
        $opt = (bool) ($d['marketing_opt_in'] ?? false);
        $c = Customer::create($datos + [
            'customer_type' => $d['customer_type'] ?? 'PERSON',
            'source_channel' => $d['source_channel'] ?? 'WHATSAPP',
            'origin_wa_number' => $d['origin_wa_number'] ?? null,
            'marketing_opt_in' => $opt,
            'marketing_opt_in_at' => $opt ? now() : null,
            'marketing_opt_in_source' => $opt ? ($d['source_channel'] ?? 'WHATSAPP') : null,
            'status' => 'ACTIVE',
            'seller_user_id' => array_key_exists('seller_user_id', $d) ? $d['seller_user_id'] : ($quien->role === 'VENDEDORA' ? $quien->id : null),
            'orders_count' => 0,
            'segment_brands' => [],
            'created_by' => $quien->name,
        ]);
        if ($opt) {
            self::anotarConsentimiento($c->id, true, $c->source_channel === 'WEB' ? 'WEB' : 'WHATSAPP', 'Aceptó recibir promociones al registrarse', $quien);
        }
        $dups = Duplicados::revisar($c);
        Events::emit('customer.created', 'customers', $c->id, ['phone' => $c->phone, 'duplicates' => count($dups)]);

        return ['customer' => $c->refresh(), 'duplicados' => $dups];
    }

    /**
     * CA-CLI-01: si el celular ya es de un cliente, devuelve ese cliente y no crea otro.
     *
     * @return array{customer: Customer, existente: bool, duplicados: array}
     */
    public static function altaRapida(array $d, User $quien): array
    {
        if ($c = self::buscarPorCelular($d['phone'] ?? null)) {
            return ['customer' => $c, 'existente' => true, 'duplicados' => []];
        }

        return self::crear($d, $quien) + ['existente' => false];
    }

    public static function actualizar(Customer $c, array $d, User $quien): Customer
    {
        self::noFusionado($c, 'edita el sobreviviente');
        $datos = self::limpiar($d);
        if ($otro = self::buscarPorDocumento($datos['doc_type'], $datos['doc_number'], $c->id)) {
            RuleError::fail('RN-CLI-11', "Ya existe {$otro->nombre()} con {$datos['doc_type']} {$datos['doc_number']}: si es la misma persona, fusiónalos.");
        }
        if (! $datos['phone'] && $datos['doc_type'] === 'NONE') {
            RuleError::fail('RN-CLI-11', 'Sin documento, el celular es el identificador del cliente: no lo dejes vacío.');
        }
        $cambioDoc = $datos['doc_type'] !== $c->doc_type || $datos['doc_number'] !== $c->doc_number;
        $cambioContacto = $datos['phone'] !== $c->phone || $datos['phone_alt'] !== $c->phone_alt || $datos['email'] !== $c->email;
        $c->fill($datos + [
            'customer_type' => $d['customer_type'] ?? $c->customer_type,
            'seller_user_id' => $d['seller_user_id'] ?? null,
            'notes' => $d['notes'] ?? null,
        ]);
        if ($cambioDoc) {
            $c->fill(['doc_validated_at' => null, 'doc_validation_source' => null, 'doc_validation_state' => null, 'fiscal_address' => null, 'taxpayer_condition' => null]);
        }
        $c->save();
        if ($cambioContacto) {
            Duplicados::revisar($c);
        }

        return $c->refresh();
    }

    /** RN-CLI-09: bloquear exige motivo; el pedido nuevo de un bloqueado se rechaza (lo revisa PED con puedeComprar()). */
    public static function bloquear(Customer $c, string $motivo, User $quien): Customer
    {
        self::noFusionado($c, 'un cliente fusionado no se bloquea: actúa sobre el sobreviviente');
        if (trim($motivo) === '') {
            RuleError::fail('RN-CLI-09', 'Bloquear un cliente exige motivo (fraude, deuda, maltrato…).');
        }
        $c->update(['status' => 'BLOCKED', 'blocked_reason' => mb_substr(trim($motivo), 0, 255), 'blocked_at' => now(), 'blocked_by' => $quien->name]);
        Events::emit('customer.blocked', 'customers', $c->id, ['reason' => $c->blocked_reason]);

        return $c;
    }

    public static function desbloquear(Customer $c, ?string $nota, User $quien): Customer
    {
        self::noFusionado($c, 'no puede volver a activarse');
        $c->update(['status' => 'ACTIVE', 'blocked_reason' => null, 'unblocked_at' => now(), 'unblocked_note' => $nota ? mb_substr($nota, 0, 255) : null]);
        Events::emit('customer.unblocked', 'customers', $c->id, ['note' => $nota]);

        return $c;
    }

    /** Para PED: null si el cliente puede comprar; si no, el motivo con su regla. */
    public static function puedeComprar(Customer $c): ?array
    {
        if ($c->fusionado()) {
            return ['RN-CLI-08', "{$c->nombre()} fue fusionado: cambia el cliente del pedido al sobreviviente."];
        }
        if ($c->status === 'BLOCKED') {
            return ['RN-CLI-09', "{$c->nombre()} está bloqueado ({$c->blocked_reason}): no se le confirman pedidos nuevos."];
        }

        return null;
    }

    /** RN-CLI-13: alta o baja del consentimiento de publicidad, con su constancia (Ley 29733). */
    public static function consentimiento(Customer $c, bool $acepta, string $canal, ?string $evidencia, User $quien): Customer
    {
        self::noFusionado($c, 'registra el consentimiento en el sobreviviente');
        $antes = (bool) $c->marketing_opt_in;
        $c->update(['marketing_opt_in' => $acepta, 'marketing_opt_in_at' => now(), 'marketing_opt_in_source' => $canal]);
        self::anotarConsentimiento($c->id, $acepta, $canal, $evidencia ?: ($acepta ? 'Aceptó recibir promociones' : 'Pidió no recibir promociones'), $quien);
        if ($antes && ! $acepta) {
            Events::emit('consent.opted_out', 'customers', $c->id, ['channel' => $canal]);
        }

        return $c;
    }

    private static function anotarConsentimiento(string $id, bool $acepta, string $canal, string $evidencia, User $quien): void
    {
        DB::table('contact_consents')->insert([
            'customer_id' => $id, 'purpose' => 'MARKETING', 'granted' => $acepta, 'channel' => $canal,
            'evidence_text' => mb_substr($evidencia, 0, 500), 'recorded_at' => now(), 'recorded_by' => mb_substr($quien->name, 0, 255),
        ]);
    }

    /**
     * RN-CLI-12: guarda el documento validado con su fuente y fecha. Con manual=true exige el
     * permiso cli.customer.validate_manual (lo revisa el controlador) y una nota.
     */
    public static function validarDocumento(Customer $c, string $tipo, string $numero, bool $manual, ?string $nota, User $quien): array
    {
        self::noFusionado($c, 'valida el documento del sobreviviente');
        $n = (string) Documentos::limpiar($numero);
        if ($e = Documentos::problema($tipo, $n)) {
            RuleError::fail('RN-CLI-03', $e);
        }
        if ($otro = self::buscarPorDocumento($tipo, $n, $c->id)) {
            RuleError::fail('RN-CLI-11', "{$tipo} {$n} ya pertenece a {$otro->nombre()}: si es la misma persona, fusiónalos (CLI-11).");
        }
        if ($manual) {
            if (trim((string) $nota) === '') {
                RuleError::fail('RN-CLI-12', 'La validación manual exige una nota: qué documento se vio.');
            }
            $r = ['ok' => true, 'source' => 'MANUAL', 'name' => $c->full_name, 'state' => 'VALIDADO A MANO', 'condition' => null, 'fiscal_address' => null];
        } else {
            $r = Documentos::consultar($tipo, $n);
            if (! $r['ok']) {
                RuleError::fail('RN-CLI-03', $r['error']);
            }
        }
        $datos = ['doc_type' => $tipo, 'doc_number' => $n, 'doc_validated_at' => now(), 'doc_validation_source' => $r['source'],
            'doc_validation_state' => $r['condition'] ? "{$r['state']} · {$r['condition']}" : $r['state']];
        if ($tipo === 'RUC' && $r['source'] === 'SUNAT') {
            $datos += ['full_name' => $r['name'], 'fiscal_address' => $r['fiscal_address'], 'taxpayer_condition' => $r['condition']];
        }
        $c->update($datos);
        // Bitácora de consultas (Ley 29733): quién consultó qué documento y qué respondió el proveedor.
        Events::emit('customer.document_checked', 'customers', $c->id, [
            'doc' => "{$tipo} {$n}", 'source' => $r['source'], 'state' => $datos['doc_validation_state'], 'note' => $nota, 'user' => $quien->name,
        ]);

        return $r;
    }

    /** Saldo a favor del cliente (CAJ): suma de sus movimientos de saldo. */
    public static function saldo(string $id): float
    {
        return round((float) DB::table('customer_balance_movements')->where('customer_id', $id)->sum('amount'), 2);
    }

    /**
     * Cuentas por cobrar: comprobantes con saldo y pedidos entregados sin comprobante que no están pagados.
     *
     * @return array{comprobantes: array, pedidos: array, total: float}
     */
    public static function porCobrar(string $id): array
    {
        $docs = DB::table('sales_documents')->where('customer_id', $id)->where('balance', '>', 0.005)
            ->where('status', '<>', 'VOIDED')->where('doc_type', '<>', 'CREDIT_NOTE')
            ->orderBy('issue_date')->get(['id', 'full_number', 'doc_type', 'issue_date', 'due_date', 'balance', 'total']);
        $ped = DB::table('sales_orders as o')->where('o.customer_id', $id)->whereIn('o.status', ['DELIVERED', 'CLOSED'])
            ->whereNotExists(fn ($q) => $q->from('sales_documents as d')->whereColumn('d.order_id', 'o.id')->where('d.status', '<>', 'VOIDED'))
            ->whereRaw('coalesce(o.final_total, o.estimated_total) - coalesce(o.paid_amount, 0) > 0.5')
            ->orderBy('o.delivery_date')
            ->get(['o.id', 'o.number', 'o.delivery_date', DB::raw('round(coalesce(o.final_total, o.estimated_total) - coalesce(o.paid_amount, 0), 2) as saldo')]);

        return ['comprobantes' => $docs->all(), 'pedidos' => $ped->all(),
            'total' => round($docs->sum('balance') + $ped->sum(fn ($o) => (float) $o->saldo), 2)];
    }

    private static function noFusionado(Customer $c, string $que): void
    {
        if ($c->fusionado()) {
            $sob = Customer::find($c->merged_into_id);
            RuleError::fail('RN-CLI-08', "{$c->nombre()} fue fusionado en ".($sob?->nombre() ?? 'otro cliente').": {$que}.");
        }
    }

    /** Normaliza y valida celulares, correo y documento (RN-CLI-01, RN-CLI-03). */
    private static function limpiar(array $d): array
    {
        $nombre = trim((string) ($d['full_name'] ?? ''));
        if ($nombre === '') {
            RuleError::fail('RN-CLI-11', 'Escribe el nombre del cliente.');
        }
        $phone = Celulares::normalizar($d['phone'] ?? null);
        $alt = Celulares::normalizar($d['phone_alt'] ?? null);
        if ($phone && ! Celulares::valido($phone)) {
            RuleError::fail('RN-CLI-01', "El celular «{$d['phone']}» no es válido: para Perú son 9 dígitos que empiezan en 9 (se guarda como +51XXXXXXXXX).");
        }
        if ($alt && ! Celulares::valido($alt)) {
            RuleError::fail('RN-CLI-01', "El celular alterno «{$d['phone_alt']}» no es válido.");
        }
        $tipo = $d['doc_type'] ?? 'NONE';
        $numero = $tipo === 'NONE' ? null : Documentos::limpiar($d['doc_number'] ?? null);
        if ($e = Documentos::problema($tipo, $numero)) {
            RuleError::fail('RN-CLI-03', $e);
        }
        $correo = trim(mb_strtolower((string) ($d['email'] ?? '')));

        return [
            'full_name' => mb_substr($nombre, 0, 255),
            'trade_name' => trim((string) ($d['trade_name'] ?? '')) ?: null,
            'phone' => $phone,
            'phone_alt' => $alt === $phone ? null : $alt,
            'email' => $correo === '' ? null : $correo,
            'doc_type' => $tipo,
            'doc_number' => $numero,
        ];
    }
}
