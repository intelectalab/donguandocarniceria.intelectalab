<?php

namespace App\Modulos\Gas\Services;

use App\Models\User;
use App\Modulos\Int\Services\Archivos;
use App\Modulos\Mae\Services\TiposDeCambio;
use App\Modulos\Plt\Services\CentrosCosto;
use App\Modulos\Plt\Services\Marcas;
use App\Modulos\Plt\Services\Periodos;
use App\Modulos\Plt\Services\Ruc;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * GAS-01 Registrar gasto y GAS-02 Mis gastos: registro desde el celular con la foto del comprobante, envío a
 * aprobación, corrección de lo que observa la contadora y anulación con motivo (RN-GAS-01 a 06, 09 a 11, 13 y 14).
 */
final class Gastos
{
    /** Guarda un gasto nuevo o corrige un borrador o rechazado propio. Con $enviar lo manda a aprobación. */
    public static function guardar(array $d, UploadedFile|string|null $foto, User $u, ?string $id = null, bool $enviar = false): object
    {
        $gastoId = DB::transaction(function () use ($d, $foto, $u, $id) {
            $antes = null;
            if ($id) {
                $antes = DB::table('expenses')->where('id', $id)->lockForUpdate()->first();
                if (! $antes) {
                    abort(404, 'No se encontró el gasto.');
                }
                if ($antes->created_by !== $u->id) {
                    RuleError::fail('RN-GAS-01', 'Solo quien registró el gasto puede cambiarlo.');
                }
                if (! in_array($antes->status, ['DRAFT', 'REJECTED'], true)) {
                    RuleError::fail('RN-GAS-01', 'El gasto ya está '.mb_strtolower(Base::ESTADOS[$antes->status]).': no se cambia. Si hay un error, anúlalo y regístralo de nuevo.');
                }
                if ($antes->driver_expense_id) {
                    RuleError::fail('RN-GAS-01', 'Este gasto vino de la app del repartidor: no se cambia aquí.');
                }
            }
            $fila = self::validar($d, $u, $antes);
            $fotoId = self::foto($foto, $u);
            if ($fotoId) {
                $fila['receipt_file_id'] = $fotoId;
            }
            if ($antes) {
                $fila['history'] = Base::historia($antes->history, $u, 'Corrigió el gasto');
                $fila['updated_at'] = now();
                DB::table('expenses')->where('id', $antes->id)->update($fila);
                $gid = $antes->id;
            } else {
                $fila += [
                    'number' => Base::numero('expenses', 'GS-'), 'status' => 'DRAFT', 'created_by' => $u->id,
                    'history' => Base::historia(null, $u, 'Registró el gasto'),
                ];
                try {
                    $gid = DB::table('expenses')->insertGetId($fila, 'id');
                } catch (QueryException $e) {
                    if (str_contains($e->getMessage(), 'expenses_comprobante_unico')) {
                        RuleError::fail('RN-GAS-05', 'Ese comprobante ya está registrado.');
                    }
                    throw $e;
                }
            }
            if (($fila['pay_source'] ?? null) === 'PETTY') {
                CajaChica::asignar($gid);
            } else {
                DB::table('expenses')->where('id', $gid)->update(['petty_cash_report_id' => null]);
            }

            return $gid;
        });
        if ($enviar) {
            return self::enviar($gastoId, $u);
        }

        return self::fila($gastoId);
    }

    /** RN-GAS-01 a 03, 05, 06, 09 a 11 y 13. Devuelve la fila a guardar, con los montos calculados aquí. */
    public static function validar(array $d, User $u, ?object $antes = null): array
    {
        $t = fn (string $k) => trim((string) ($d[$k] ?? ''));
        foreach (['establishment_id' => 'el local', 'cost_center_id' => 'el centro de costo', 'category_id' => 'la categoría', 'issue_date' => 'la fecha'] as $k => $n) {
            if ($t($k) === '') {
                RuleError::fail('RN-GAS-01', "Falta {$n} del gasto.");
            }
        }
        if ($t('description') === '') {
            RuleError::fail('RN-GAS-01', 'Escribe una descripción: en qué se gastó.');
        }
        $fecha = $t('issue_date');
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha) || strtotime($fecha) === false) {
            RuleError::fail('RN-GAS-01', 'La fecha no es válida.');
        }
        if ($fecha > Base::hoy()) {
            RuleError::fail('RN-GAS-01', 'La fecha del comprobante no puede ser futura.');
        }
        $local = DB::table('establishments')->where('id', $t('establishment_id'))->first(['id', 'company_id', 'status', 'name']);
        if (! $local) {
            RuleError::fail('RN-GAS-01', 'El local elegido no existe.');
        }
        $alcance = Access::for($u)['establishments'];
        if ($alcance && ! in_array($local->id, $alcance, true)) {
            RuleError::fail('RN-GAS-01', 'Ese local no está en tu alcance.');
        }
        Periodos::abierto($fecha, $local->company_id);   // RN-GAS-10

        $cat = DB::table('expense_categories')->where('id', $t('category_id'))->first();
        if (! $cat || $cat->status !== 'ACTIVE') {
            RuleError::fail('RN-GAS-03', 'La categoría elegida no existe o está inactiva.');
        }
        CentrosCosto::activo($t('cost_center_id'));
        $cc = DB::table('cost_centers')->where('id', $t('cost_center_id'))->first(['brand_id']);
        $marca = $t('brand_id') ?: ($cc->brand_id ?? null) ?: self::marcaPorDefecto();
        if (! $marca) {
            RuleError::fail('RN-GAS-01', 'Elige la marca del gasto.');
        }
        Marcas::activa($marca);

        // RN-GAS-02: montos. Total = subtotal + IGV + otros tributos; solo la factura lleva IGV con crédito fiscal.
        $doc = $t('doc_type') ?: $cat->default_doc_type;
        if (! isset(Base::DOCUMENTOS[$doc])) {
            RuleError::fail('RN-GAS-02', 'Elige el tipo de comprobante.');
        }
        foreach (['total', 'igv', 'other_taxes'] as $k) {
            if (isset($d[$k]) && $d[$k] !== '' && $d[$k] !== null && ! is_numeric($d[$k])) {
                RuleError::fail('RN-GAS-02', 'Los montos deben ser números.');
            }
        }
        $total = Base::r($d['total'] ?? 0);
        $igv = Base::r($d['igv'] ?? 0);
        $otros = Base::r($d['other_taxes'] ?? 0);
        if ($total <= 0) {
            RuleError::fail('RN-GAS-01', 'El total del gasto debe ser mayor que cero.');
        }
        if ($total > 9999999) {
            RuleError::fail('RN-GAS-02', 'El total es demasiado alto. Revisa el monto.');
        }
        if ($igv < 0 || $otros < 0) {
            RuleError::fail('RN-GAS-02', 'El IGV y los otros tributos no pueden ser negativos.');
        }
        if ($doc !== 'INVOICE' && $igv > Base::EPS) {
            RuleError::fail('RN-GAS-02', 'Solo la factura lleva IGV con crédito fiscal. En '.mb_strtolower(Base::DOCUMENTOS[$doc]).' deja el IGV en cero: el total va completo.');
        }
        $subtotal = Base::r($total - $igv - $otros);
        if ($subtotal < 0) {
            RuleError::fail('RN-GAS-02', 'El IGV y los otros tributos no pueden sumar más que el total.');
        }

        // Proveedor y número (RN-GAS-02, RN-GAS-11).
        $ruc = preg_replace('/\D/', '', $t('supplier_doc'));
        $nombre = $t('supplier_name');
        $proveedor = null;
        if ($ruc !== '') {
            if ($p = Ruc::problema($ruc)) {
                RuleError::fail('RN-GAS-02', $p);
            }
            $proveedor = DB::table('suppliers')->where('doc_number', $ruc)->first(['id', 'legal_name']);
            $nombre = $proveedor->legal_name ?? $nombre;
        } elseif ($t('supplier_id') !== '') {
            $proveedor = DB::table('suppliers')->where('id', $t('supplier_id'))->first(['id', 'legal_name', 'doc_number']);
            if (! $proveedor) {
                RuleError::fail('RN-GAS-02', 'El proveedor elegido no existe.');
            }
            $ruc = (string) $proveedor->doc_number;
            $nombre = $proveedor->legal_name;
        }
        $serie = mb_strtoupper($t('doc_series'));
        $numero = ltrim(mb_strtoupper($t('doc_number')), '0') ?: ($t('doc_number') !== '' ? '0' : '');
        if (in_array($doc, Base::CON_PROVEEDOR, true)) {
            if ($ruc === '' || $nombre === '') {
                RuleError::fail($doc === 'FEES_RECEIPT' ? 'RN-GAS-11' : 'RN-GAS-02', Base::DOCUMENTOS[$doc].' exige el RUC y el nombre del proveedor.');
            }
            if ($serie === '' || $numero === '') {
                RuleError::fail($doc === 'FEES_RECEIPT' ? 'RN-GAS-11' : 'RN-GAS-02', Base::DOCUMENTOS[$doc].' exige la serie y el número.');
            }
        }
        if ($doc === 'FOREIGN_INVOICE' && ($nombre === '' || $numero === '')) {
            RuleError::fail('RN-GAS-02', 'La factura del exterior exige el proveedor y su número.');
        }
        if ($doc === 'NONE') {
            $serie = '';
            $numero = '';
        }
        if (mb_strlen($serie) > 20 || mb_strlen($numero) > 20) {
            RuleError::fail('RN-GAS-02', 'La serie y el número tienen hasta 20 caracteres.');
        }

        // RN-GAS-03: lo que exige la categoría.
        $veh = $t('vehicle_id') ?: null;
        $ruta = $t('route_id') ?: null;
        $emp = $t('employee_id') ?: null;
        $camp = $t('ad_campaign_id') ?: null;
        $galones = isset($d['fuel_gallons']) && $d['fuel_gallons'] !== '' && $d['fuel_gallons'] !== null ? Base::r($d['fuel_gallons'], 4) : null;
        if ($ruta && ! $veh) {
            $veh = DB::table('delivery_routes')->where('id', $ruta)->value('vehicle_id');
        }
        if ($cat->requires_vehicle && ! $veh) {
            RuleError::fail('RN-GAS-03', "«{$cat->name}» exige el vehículo.");
        }
        if ($cat->requires_gallons && (! $galones || $galones <= 0)) {
            RuleError::fail('RN-GAS-03', "«{$cat->name}» exige los galones del vale.");
        }
        if ($cat->requires_employee && ! $emp) {
            RuleError::fail('RN-GAS-03', "«{$cat->name}» exige el repartidor o trabajador.");
        }
        if ($cat->requires_supplier && $ruc === '' && $nombre === '') {
            RuleError::fail('RN-GAS-03', "«{$cat->name}» exige el proveedor.");
        }
        if ($cat->requires_campaign && ! $camp) {
            RuleError::fail('RN-GAS-03', "«{$cat->name}» exige la campaña.");
        }
        if ($cat->category_group === 'DELIVERY' && ! $veh && ! $ruta && ! $emp && $ruc === '' && $nombre === '') {
            RuleError::fail('RN-GAS-03', 'Un gasto de reparto lleva el vehículo, la ruta, el repartidor o el proveedor, para que llegue a los costos de Delivery.');
        }
        foreach (['vehicles' => $veh, 'delivery_routes' => $ruta, 'employees' => $emp, 'ad_campaigns' => $camp] as $tabla => $v) {
            if ($v && ! DB::table($tabla)->where('id', $v)->exists()) {
                RuleError::fail('RN-GAS-03', 'Uno de los datos elegidos (vehículo, ruta, trabajador o campaña) no existe.');
            }
        }
        $canal = $t('sales_channel') ?: null;
        if ($canal && ! isset(Base::CANALES[$canal])) {
            RuleError::fail('RN-GAS-01', 'El canal elegido no es válido.');
        }

        // RN-GAS-13: moneda extranjera con la venta de su fecha.
        $moneda = $t('currency') ?: 'PEN';
        if (! in_array($moneda, ['PEN', 'USD'], true)) {
            RuleError::fail('RN-GAS-13', 'La moneda debe ser soles o dólares.');
        }
        $tc = $moneda === 'PEN' ? 1.0 : TiposDeCambio::para($fecha, $moneda)['sell'];
        $soles = Base::r($total * $tc);

        // RN-GAS-11: retención de cuarta categoría.
        $retencion = 0.0;
        if ($doc === 'FEES_RECEIPT' && $total >= (float) (Params::get('gas_fees_withholding_threshold') ?? 1500)) {
            $retencion = Base::r($total * (float) (Params::get('gas_fees_withholding_pct') ?? 8) / 100);
        }

        $origen = $t('pay_source') ?: 'PAYABLE';
        if (! in_array($origen, ['PAYABLE', 'PETTY'], true)) {
            RuleError::fail('RN-GAS-09', 'Indica si se paga por tesorería o con caja chica.');
        }
        if ($origen === 'PETTY') {
            CajaChica::validarGasto($local->id, $soles, $antes?->id);
        }

        // RN-GAS-05: el mismo comprobante no se registra dos veces.
        $clave = $ruc !== '' ? $ruc : null;
        if ($clave && $numero !== '') {
            $repetido = DB::table('expenses')->where('status', '<>', 'VOIDED')->where('doc_type', $doc)
                ->where(fn ($w) => $w->where('supplier_doc', $clave)->orWhere(fn ($x) => $x->whereNull('supplier_doc')->when($proveedor, fn ($y) => $y->where('supplier_id', $proveedor->id), fn ($y) => $y->whereRaw('false'))))
                ->whereRaw("upper(coalesce(doc_series, '')) = ?", [$serie])->whereRaw('upper(doc_number) = ?', [$numero])
                ->when($antes, fn ($w) => $w->where('id', '<>', $antes->id))->first(['number']);
            if ($repetido) {
                $c = trim(($serie !== '' ? $serie.'-' : '').$numero);
                RuleError::fail('RN-GAS-05', "La {$c} de este proveedor ya está registrada en el gasto {$repetido->number}. Solo se vuelve a registrar si ese gasto se anula.");
            }
        }

        return [
            'company_id' => $local->company_id, 'establishment_id' => $local->id, 'cost_center_id' => $t('cost_center_id'), 'brand_id' => $marca,
            'category_id' => $cat->id, 'category_code' => mb_substr((string) $cat->code, 0, 40), 'supplier_id' => $proveedor->id ?? null,
            'supplier_doc' => $ruc !== '' ? $ruc : null, 'supplier_name' => $nombre !== '' ? mb_substr($nombre, 0, 160) : null,
            'doc_type' => $doc, 'doc_series' => $serie !== '' ? $serie : null, 'doc_number' => $numero !== '' ? $numero : null, 'issue_date' => $fecha,
            'currency' => $moneda, 'exchange_rate' => $tc, 'subtotal' => $subtotal, 'igv' => $igv, 'other_taxes' => $otros, 'total' => $total,
            'withholding_amount' => $retencion, 'net_pen' => Base::r($soles - ($doc === 'INVOICE' ? $igv * $tc : 0)),
            'ad_campaign_id' => $camp, 'description' => mb_substr($t('description'), 0, 2000), 'sales_channel' => $canal,
            'vehicle_id' => $veh, 'route_id' => $ruta, 'employee_id' => $emp, 'fuel_gallons' => $galones,
            'fuel_voucher_no' => $t('fuel_voucher_no') !== '' ? mb_substr($t('fuel_voucher_no'), 0, 20) : null,
            'odometer_km' => isset($d['odometer_km']) && is_numeric($d['odometer_km']) ? Base::r($d['odometer_km'], 3) : null,
            'accounting_flag' => in_array($doc, Base::SIN_VALIDO, true) ? 'NO_VALID_RECEIPT' : 'OK',   // RN-GAS-06
            'pay_source' => $origen,
        ];
    }

    /** RN-GAS-01: enviar a aprobación pide la foto del comprobante, salvo «sin comprobante». */
    public static function enviar(string $id, User $u): object
    {
        DB::transaction(function () use ($id, $u) {
            $g = DB::table('expenses')->where('id', $id)->lockForUpdate()->first();
            if (! $g) {
                abort(404, 'No se encontró el gasto.');
            }
            if ($g->created_by !== $u->id) {
                RuleError::fail('RN-GAS-01', 'Solo quien registró el gasto lo envía a aprobación.');
            }
            if (! in_array($g->status, ['DRAFT', 'REJECTED'], true)) {
                RuleError::fail('RN-GAS-01', 'El gasto ya fue enviado.');
            }
            if ($g->doc_type !== 'NONE' && ! $g->receipt_file_id) {
                RuleError::fail('RN-GAS-01', 'Para enviarlo a aprobación toma la foto del comprobante (o elige «sin comprobante»).');
            }
            Periodos::abierto($g->issue_date, $g->company_id);
            Reparto::validar($g);   // RN-GAS-04
            if ($g->pay_source === 'PETTY') {
                CajaChica::validarGasto($g->establishment_id, (float) $g->amount_pen, $g->id);
                CajaChica::asignar($g->id);
            }
            $nivel = Aprobaciones::nivelRequerido($g);
            DB::table('expenses')->where('id', $id)->update([
                'status' => 'SUBMITTED', 'submitted_at' => now(), 'required_level' => $nivel, 'rejection_reason' => null,
                'history' => Base::historia($g->history, $u, 'Envió a aprobación', 'Nivel '.$nivel.' ('.Base::NOMBRE_NIVEL[$nivel].')'), 'updated_at' => now(),
            ]);
            Events::emit('expense.submitted', 'expenses', $id, ['number' => $g->number, 'amount_pen' => (float) $g->amount_pen, 'level' => $nivel]);
        });

        return self::fila($id);
    }

    /** Lo que observó la contadora: quien lo registró corrige el comprobante (tipo, serie, número, proveedor y foto). */
    public static function corregir(string $id, array $d, UploadedFile|string|null $foto, User $u): object
    {
        DB::transaction(function () use ($id, $d, $foto, $u) {
            $g = DB::table('expenses')->where('id', $id)->lockForUpdate()->first();
            if (! $g) {
                abort(404, 'No se encontró el gasto.');
            }
            if ($g->created_by !== $u->id) {
                RuleError::fail('RN-GAS-06', 'Solo quien registró el gasto corrige lo observado.');
            }
            if ($g->accounting_flag !== 'OBSERVED' || $g->status === 'VOIDED') {
                RuleError::fail('RN-GAS-06', 'Este gasto no tiene una observación de la contadora por corregir.');
            }
            $nuevo = array_merge((array) $g, array_intersect_key($d, array_flip(['doc_type', 'doc_series', 'doc_number', 'supplier_doc', 'supplier_name'])));
            $nuevo['supplier_id'] = null;
            // Los montos, la categoría y el centro de costo no cambian: solo los datos del comprobante.
            foreach (['igv', 'other_taxes', 'total', 'fuel_gallons', 'odometer_km'] as $k) {
                $nuevo[$k] = $g->{$k};
            }
            $fila = self::validar($nuevo, $u, $g);
            $cambios = array_intersect_key($fila, array_flip(['doc_type', 'doc_series', 'doc_number', 'supplier_id', 'supplier_doc', 'supplier_name']));
            if ($fila['doc_type'] !== 'INVOICE' && (float) $g->igv > Base::EPS) {
                RuleError::fail('RN-GAS-02', 'Este gasto tiene IGV: solo puede ser factura.');
            }
            if ($fotoId = self::foto($foto, $u)) {
                $cambios['receipt_file_id'] = $fotoId;
            }
            if ($fila['doc_type'] !== 'NONE' && ! ($cambios['receipt_file_id'] ?? $g->receipt_file_id)) {
                RuleError::fail('RN-GAS-01', 'Adjunta la foto del comprobante.');
            }
            DB::table('expenses')->where('id', $id)->update($cambios + [
                'corrected_at' => now(), 'history' => Base::historia($g->history, $u, 'Corrigió lo observado'), 'updated_at' => now(),
            ]);
        });

        return self::fila($id);
    }

    /**
     * RN-GAS-14: un gasto no se borra, se anula con motivo. Uno pagado se anula solo después del reverso del pago;
     * uno de caja chica, mientras su rendición siga abierta.
     */
    public static function anular(string $id, string $motivo, User $u): object
    {
        DB::transaction(function () use ($id, $motivo, $u) {
            $g = DB::table('expenses')->where('id', $id)->lockForUpdate()->first();
            if (! $g) {
                abort(404, 'No se encontró el gasto.');
            }
            if ($g->status === 'VOIDED') {
                RuleError::fail('RN-GAS-14', 'El gasto ya está anulado.');
            }
            if (mb_strlen(trim($motivo)) < 5) {
                RuleError::fail('RN-GAS-14', 'Escribe el motivo de la anulación.');
            }
            if ($g->driver_expense_id) {
                RuleError::fail('RN-GAS-14', 'Este gasto vino de una ruta ya liquidada en Delivery: no se anula aquí. La contadora puede observarlo.');
            }
            $propio = $g->created_by === $u->id;
            $abierto = in_array($g->status, ['DRAFT', 'SUBMITTED', 'REJECTED'], true);
            if (! ($abierto && ($propio || Base::anulaAprobados($u))) && ! (! $abierto && Base::anulaAprobados($u))) {
                RuleError::fail('RN-GAS-14', $abierto ? 'Solo quien registró el gasto, administración o gerencia lo anulan.' : 'Un gasto aprobado lo anula administración o gerencia.');
            }
            $rendicion = $g->petty_cash_report_id ? DB::table('petty_cash_reports')->where('id', $g->petty_cash_report_id)->first() : null;
            if ($g->status === 'PAID') {
                if ($g->pay_source !== 'PETTY') {
                    RuleError::fail('RN-GAS-14', 'El gasto ya está pagado: primero revierte el pago (Gastos por pagar y pagados) y luego anúlalo.');
                }
                if ($rendicion && $rendicion->status !== 'OPEN') {
                    RuleError::fail('RN-GAS-14', "El gasto ya entró en la rendición {$rendicion->number} (".mb_strtolower(Base::RENDICIONES[$rendicion->status]).'): no se anula.');
                }
            }
            Periodos::abierto($g->issue_date, $g->company_id);
            if ($costo = DB::table('delivery_costs')->where('expense_id', $g->id)->where('status', 'ACTIVE')->value('id')) {
                \App\Modulos\Del\Services\Costos::anular($costo, 'Gasto '.$g->number.' anulado: '.trim($motivo), $u);
            }
            DB::table('expenses')->where('id', $id)->update([
                'status' => 'VOIDED', 'void_reason' => mb_substr(trim($motivo), 0, 255), 'voided_at' => now(), 'voided_by' => $u->id,
                'history' => Base::historia($g->history, $u, 'Anuló el gasto', trim($motivo)), 'updated_at' => now(),
            ]);
            Events::emit('expense.voided', 'expenses', $id, ['number' => $g->number, 'reason' => trim($motivo)]);
        });

        return self::fila($id);
    }

    /** Marca por defecto (la primera activa) cuando ni el formulario ni el centro de costo la dicen. */
    public static function marcaPorDefecto(): ?string
    {
        return DB::table('brands')->where('status', 'ACTIVE')->orderBy('created_at')->orderBy('code')->value('id');
    }

    /** Foto del comprobante: archivo del formulario o imagen en base64 (cámara del celular). */
    public static function foto(UploadedFile|string|null $f, User $u): ?string
    {
        if (is_string($f)) {
            if (! preg_match('#^data:image/(jpeg|jpg|png|webp);base64,(.+)$#s', $f, $m)) {
                RuleError::fail('RN-GAS-01', 'La foto no es una imagen válida.');
            }
            $bytes = base64_decode($m[2], true);
            if ($bytes === false || strlen($bytes) < 50) {
                RuleError::fail('RN-GAS-01', 'La foto no es una imagen válida.');
            }
            $ext = $m[1] === 'png' ? 'png' : ($m[1] === 'webp' ? 'webp' : 'jpg');
            $tmp = tempnam(sys_get_temp_dir(), 'gas');
            file_put_contents($tmp, $bytes);
            $f = new UploadedFile($tmp, 'comprobante.'.$ext, 'image/'.($ext === 'jpg' ? 'jpeg' : $ext), null, true);
        }
        if (! $f) {
            return null;
        }
        $huella = hash_file('sha256', $f->getRealPath());
        $ya = DB::table('file_attachments')->where('sha256', $huella)->where('status', 'ACTIVE')->whereNull('entity')->value('id');

        return $ya ?? Archivos::subir($f, null, null, 'INTERNAL', $u)['id'];
    }

    /** Puede ver el gasto: lo registró, o ve todos los gastos dentro de su alcance. */
    public static function visible(string $id, User $u): object
    {
        $g = DB::table('expenses')->where('id', $id)->first();
        if (! $g) {
            abort(404, 'No se encontró el gasto.');
        }
        if ($g->created_by === $u->id) {
            return $g;
        }
        if (! Base::veTodo($u)) {
            abort(403, 'Este gasto no es tuyo.');
        }
        $a = Access::for($u);
        if (($a['brands'] && ! in_array($g->brand_id, $a['brands'], true)) || ($a['establishments'] && ! in_array($g->establishment_id, $a['establishments'], true))) {
            abort(403, 'Este gasto está fuera de tu alcance.');
        }

        return $g;
    }

    public static function fila(string $id): object
    {
        return DB::table('expenses')->where('id', $id)->first();
    }

    /** Consulta base de listas con los nombres que muestran las pantallas. */
    public static function consulta()
    {
        return DB::table('expenses as e')
            ->leftJoin('expense_categories as c', 'c.id', '=', 'e.category_id')
            ->leftJoin('cost_centers as cc', 'cc.id', '=', 'e.cost_center_id')
            ->leftJoin('establishments as l', 'l.id', '=', 'e.establishment_id')
            ->leftJoin('brands as b', 'b.id', '=', 'e.brand_id')
            ->leftJoin('suppliers as s', 's.id', '=', 'e.supplier_id')
            ->leftJoin('users as u', 'u.id', '=', 'e.created_by')
            ->select(['e.id', 'e.number', 'e.status', 'e.issue_date', 'e.doc_type', 'e.doc_series', 'e.doc_number', 'e.currency', 'e.total', 'e.amount_pen',
                'e.igv', 'e.net_pen', 'e.withholding_amount', 'e.description', 'e.accounting_flag', 'e.accounting_note', 'e.accounting_reviewed_at', 'e.corrected_at',
                'e.pay_source', 'e.required_level', 'e.submitted_at', 'e.approved_at', 'e.paid_at', 'e.paid_amount', 'e.payment_reference', 'e.rejection_reason',
                'e.receipt_file_id', 'e.allocated', 'e.created_by', 'e.created_at', 'e.establishment_id', 'e.brand_id', 'e.category_id', 'e.cost_center_id',
                'e.driver_expense_id', 'e.source_module', 'e.sales_channel', 'e.petty_cash_report_id',
                DB::raw("coalesce(c.name, e.category_code) AS categoria"), 'c.category_group as grupo', 'cc.name as centro', 'cc.code as centro_codigo',
                'l.name as local', 'b.name as marca', DB::raw('coalesce(e.supplier_name, s.legal_name) AS proveedor'), 'u.name as registro']);
    }

    /** Fila de lista para la web. */
    public static function aLista(object $g): array
    {
        return [
            'id' => $g->id, 'number' => $g->number, 'status' => $g->status, 'estado' => Base::ESTADOS[$g->status] ?? $g->status,
            'issue_date' => $g->issue_date, 'doc_type' => $g->doc_type, 'documento' => Base::DOCUMENTOS[$g->doc_type] ?? $g->doc_type,
            'comprobante' => trim(($g->doc_series ? $g->doc_series.'-' : '').($g->doc_number ?? '')) ?: null,
            'currency' => $g->currency, 'total' => (float) $g->total, 'amount_pen' => (float) $g->amount_pen, 'net_pen' => $g->net_pen !== null ? (float) $g->net_pen : null,
            'withholding_amount' => (float) $g->withholding_amount, 'description' => $g->description, 'categoria' => $g->categoria, 'grupo' => $g->grupo,
            'centro' => $g->centro, 'local' => $g->local, 'marca' => $g->marca, 'proveedor' => $g->proveedor, 'registro' => $g->registro,
            'accounting_flag' => $g->accounting_flag, 'accounting_note' => $g->accounting_note, 'revisado' => (bool) $g->accounting_reviewed_at,
            'corregido' => (bool) $g->corrected_at, 'pay_source' => $g->pay_source, 'required_level' => $g->required_level !== null ? (int) $g->required_level : null,
            'submitted_at' => $g->submitted_at, 'approved_at' => $g->approved_at, 'paid_at' => $g->paid_at,
            'paid_amount' => $g->paid_amount !== null ? (float) $g->paid_amount : null, 'payment_reference' => $g->payment_reference,
            'rejection_reason' => $g->rejection_reason, 'foto' => (bool) $g->receipt_file_id, 'repartido' => (bool) $g->allocated,
            'de_ruta' => (bool) $g->driver_expense_id, 'created_at' => $g->created_at,
        ];
    }

    /** Ficha completa (para todas las pantallas), con lo que el usuario puede hacer. */
    public static function ficha(string $id, User $u): array
    {
        self::visible($id, $u);
        $g = self::consulta()->addSelect(['e.subtotal', 'e.other_taxes', 'e.exchange_rate', 'e.supplier_doc', 'e.vehicle_id', 'e.route_id', 'e.employee_id',
            'e.fuel_gallons', 'e.fuel_voucher_no', 'e.odometer_km', 'e.ad_campaign_id', 'e.history', 'e.void_reason', 'e.voided_at', 'e.approved_by',
            'e.paid_from_account_id', 'e.company_id'])->where('e.id', $id)->first();
        $nombre = fn (?string $uid) => $uid ? DB::table('users')->where('id', $uid)->value('name') : null;
        $aprobaciones = DB::table('expense_approvals as a')->leftJoin('users as u', 'u.id', '=', 'a.approver_user_id')->where('a.expense_id', $id)
            ->orderBy('a.decided_at')->get(['a.level', 'a.decision', 'a.comment', 'a.decided_at', 'u.name as quien'])
            ->map(fn ($a) => ['level' => (int) $a->level, 'decision' => $a->decision, 'comment' => $a->comment, 'decided_at' => $a->decided_at, 'quien' => $a->quien]);
        $costo = DB::table('delivery_costs')->where('expense_id', $id)->where('status', 'ACTIVE')->first(['cost_type', 'amount', 'fuel_gallons']);
        $rendicion = $g->petty_cash_report_id ? DB::table('petty_cash_reports')->where('id', $g->petty_cash_report_id)->first(['id', 'number', 'status']) : null;
        $nivel = Base::nivel($u);
        $propio = $g->created_by === $u->id;
        $abierto = in_array($g->status, ['DRAFT', 'SUBMITTED', 'REJECTED'], true);

        return self::aLista($g) + [
            'subtotal' => (float) $g->subtotal, 'other_taxes' => (float) $g->other_taxes, 'exchange_rate' => (float) $g->exchange_rate,
            'supplier_doc' => $g->supplier_doc, 'doc_series' => $g->doc_series, 'doc_number' => $g->doc_number,
            'establishment_id' => $g->establishment_id, 'brand_id' => $g->brand_id, 'category_id' => $g->category_id, 'cost_center_id' => $g->cost_center_id,
            'vehicle_id' => $g->vehicle_id, 'route_id' => $g->route_id, 'employee_id' => $g->employee_id, 'ad_campaign_id' => $g->ad_campaign_id,
            'sales_channel' => $g->sales_channel, 'canal' => $g->sales_channel ? (Base::CANALES[$g->sales_channel] ?? $g->sales_channel) : null,
            'vehiculo' => $g->vehicle_id ? DB::table('vehicles')->where('id', $g->vehicle_id)->value('plate') : null,
            'ruta' => $g->route_id ? DB::table('delivery_routes')->where('id', $g->route_id)->value('code') : null,
            'trabajador' => $g->employee_id ? DB::table('employees')->where('id', $g->employee_id)->value('full_name') : null,
            'campana' => $g->ad_campaign_id ? DB::table('ad_campaigns')->where('id', $g->ad_campaign_id)->value('name') : null,
            'fuel_gallons' => $g->fuel_gallons !== null ? (float) $g->fuel_gallons : null, 'fuel_voucher_no' => $g->fuel_voucher_no,
            'odometer_km' => $g->odometer_km !== null ? (float) $g->odometer_km : null,
            'historia' => json_decode($g->history ?? '[]', true) ?: [], 'void_reason' => $g->void_reason, 'voided_at' => $g->voided_at,
            'aprobo' => $nombre($g->approved_by), 'cuenta_pago' => $g->paid_from_account_id ? DB::table('cash_accounts')->where('id', $g->paid_from_account_id)->value('name') : null,
            'aprobaciones' => $aprobaciones, 'reparto' => Reparto::lineas($id),
            'costo_reparto' => $costo ? ['tipo' => Base::COSTOS_REPARTO[$costo->cost_type] ?? $costo->cost_type, 'amount' => (float) $costo->amount, 'fuel_gallons' => $costo->fuel_gallons !== null ? (float) $costo->fuel_gallons : null] : null,
            'rendicion' => $rendicion ? ['id' => $rendicion->id, 'number' => $rendicion->number, 'estado' => Base::RENDICIONES[$rendicion->status] ?? $rendicion->status] : null,
            'nivel_nombre' => $g->required_level ? Base::NOMBRE_NIVEL[(int) $g->required_level] : null,
            'puede' => [
                'editar' => $propio && in_array($g->status, ['DRAFT', 'REJECTED'], true) && ! $g->driver_expense_id,
                'enviar' => $propio && in_array($g->status, ['DRAFT', 'REJECTED'], true) && ! $g->driver_expense_id,
                'aprobar' => $g->status === 'SUBMITTED' && ! $propio && $nivel >= (int) $g->required_level,
                'anular' => $g->status !== 'VOIDED' && ! $g->driver_expense_id && (($abierto && ($propio || Base::anulaAprobados($u))) || (! $abierto && Base::anulaAprobados($u)))
                    && ! ($g->status === 'PAID' && $g->pay_source !== 'PETTY'),
                'pagar' => $g->status === 'APPROVED' && $g->pay_source === 'PAYABLE' && Pagos::puede($u),
                'revertir' => $g->status === 'PAID' && $g->pay_source === 'PAYABLE' && Pagos::puede($u),
                'repartir' => $abierto && ($propio || Access::can($u, 'gas.accounting.review') || $nivel > 0),
                'revisar' => $g->status !== 'VOIDED' && Access::can($u, 'gas.accounting.review'),
                'corregir' => $propio && $g->accounting_flag === 'OBSERVED' && $g->status !== 'VOIDED',
            ],
        ];
    }

    /** Opciones de los formularios: locales, marcas, centros, categorías, vehículos, rutas, trabajadores, campañas, cuentas. */
    public static function opciones(User $u): array
    {
        $l = Access::for($u)['establishments'];
        $locales = DB::table('establishments')->where('status', 'ACTIVE')->when($l, fn ($w) => $w->whereIn('id', $l))->orderBy('code')->get(['id', 'code', 'name']);
        $fondos = DB::table('petty_cash_funds')->where('status', 'ACTIVE')->get(['id', 'establishment_id', 'max_expense_amount']);

        return [
            'locales' => $locales,
            'marcas' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name']),
            'centros' => DB::table('cost_centers')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name', 'area', 'brand_id', 'establishment_id']),
            'categorias' => DB::table('expense_categories')->where('status', 'ACTIVE')->orderBy('category_group')->orderBy('name')
                ->get(['id', 'code', 'name', 'category_group', 'default_area', 'delivery_cost_type', 'default_cost_center_id', 'default_doc_type',
                    'requires_vehicle', 'requires_gallons', 'requires_employee', 'requires_supplier', 'requires_campaign']),
            'vehiculos' => DB::table('vehicles')->where('status', '<>', 'INACTIVE')->orderBy('plate')->get(['id', 'plate', 'vehicle_type', 'establishment_id']),
            'rutas' => DB::table('delivery_routes')->where('route_date', '>=', now('America/Lima')->subDays(45)->toDateString())->where('status', '<>', 'CANCELLED')
                ->when($l, fn ($w) => $w->whereIn('establishment_id', $l))->orderByDesc('route_date')->orderBy('code')->limit(300)->get(['id', 'code', 'route_date', 'vehicle_id', 'driver_employee_id']),
            'trabajadores' => DB::table('employees')->where('status', 'ACTIVE')->orderBy('full_name')->get(['id', 'full_name', 'position']),
            'campanas' => DB::table('ad_campaigns')->whereIn('status', ['ACTIVE', 'PAUSED'])->orderBy('name')->get(['id', 'code', 'name']),
            'fondos' => $fondos,
            'documentos' => Base::DOCUMENTOS, 'canales' => Base::CANALES, 'grupos' => Base::GRUPOS, 'areas' => Base::AREAS, 'costos_reparto' => Base::COSTOS_REPARTO,
            'estados' => Base::ESTADOS, 'sin_valido' => Base::SIN_VALIDO, 'con_proveedor' => Base::CON_PROVEEDOR,
            'parametros' => [
                'petty_max' => (float) (Params::get('gas_petty_cash_max_expense') ?? 200),
                'retencion_pct' => (float) (Params::get('gas_fees_withholding_pct') ?? 8),
                'retencion_desde' => (float) (Params::get('gas_fees_withholding_threshold') ?? 1500),
            ],
            'hoy' => Base::hoy(), 'nivel' => Base::nivel($u),
        ];
    }

    /** Proveedor por RUC: primero el maestro de Compras; si no está, se escribe la razón social a mano. */
    public static function proveedor(string $ruc): array
    {
        $ruc = preg_replace('/\D/', '', $ruc);
        if ($p = Ruc::problema($ruc)) {
            return ['valido' => false, 'mensaje' => $p];
        }
        $s = DB::table('suppliers')->where('doc_number', $ruc)->first(['id', 'legal_name', 'trade_name', 'status']);
        $ultimo = $s ? null : DB::table('expenses')->where('supplier_doc', $ruc)->whereNotNull('supplier_name')->orderByDesc('created_at')->value('supplier_name');

        return ['valido' => true, 'ruc' => $ruc, 'id' => $s->id ?? null, 'nombre' => $s->legal_name ?? $ultimo, 'del_maestro' => (bool) $s];
    }

    /** KPI-ADS-07: costo de creadores de contenido de una campaña (gastos aprobados o pagados). CA-GAS-08. */
    public static function costoCreadores(string $campaignId): float
    {
        return Base::r(DB::table('expenses as e')->leftJoin('expense_categories as c', 'c.id', '=', 'e.category_id')
            ->where('e.ad_campaign_id', $campaignId)->whereIn('e.status', ['APPROVED', 'PAID'])
            ->where(fn ($w) => $w->where('c.category_group', 'CONTENT_CREATORS')->orWhere('e.category_code', 'CONTENT_CREATORS'))
            ->sum('e.amount_pen'));
    }
}
