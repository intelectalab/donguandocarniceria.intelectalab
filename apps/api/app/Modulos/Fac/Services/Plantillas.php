<?php

namespace App\Modulos\Fac\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * FAC-11 Plantillas impresas (RN-FAC-16): por marca, el logo, el color, el pie legal y las leyendas.
 * La razón social y el RUC son siempre los de la empresa emisora. El color y el logo se cambian en
 * Marcas (PLT-05); FAC guarda solo lo del impreso: pie legal, leyendas y si muestra el logo.
 */
final class Plantillas
{
    /** Lo que necesita la representación impresa (A4 y 80 mm) de un comprobante. */
    public static function impresion(object $d): array
    {
        $empresa = DB::table('companies')->where('id', $d->company_id)->first();
        $local = DB::table('establishments')->where('id', $d->establishment_id)->first(['name', 'address', 'short']);
        $marca = DB::table('brands')->where('id', $d->brand_id)->first();

        return [
            'empresa' => $empresa ? ['ruc' => $empresa->ruc, 'razon_social' => $empresa->legal_name, 'nombre_comercial' => $empresa->trade_name, 'direccion' => $empresa->fiscal_address] : null,
            'local' => $local,
            'marca' => $marca ? self::marca($marca) : null,
            'codigo_sunat' => Catalogos::CODIGO[$d->doc_type] ?? null,
            'doc_id' => Catalogos::DOC_ID[$d->customer_doc_type] ?? '0',
        ];
    }

    public static function marca(object $m): array
    {
        return ['id' => $m->id, 'code' => $m->code, 'name' => $m->name, 'color' => $m->primary_color, 'status' => $m->status,
            'logo' => (bool) $m->logo_url, 'mostrar_logo' => $m->print_show_logo !== false, 'pie' => $m->legal_footer, 'leyendas' => $m->print_legends];
    }

    /** Plantillas de las marcas activas, con un comprobante de muestra de cada una. */
    public static function lista(User $u): array
    {
        $a = Access::for($u);
        $marcas = DB::table('brands')->where('status', 'ACTIVE')->when($a['brands'], fn ($w) => $w->whereIn('id', $a['brands']))->orderBy('sort_order')->orderBy('name')->get();
        $empresa = DB::table('companies')->orderBy('created_at')->first();

        return [
            'empresa' => $empresa ? ['ruc' => $empresa->ruc, 'razon_social' => $empresa->legal_name, 'direccion' => $empresa->fiscal_address] : null,
            'marcas' => $marcas->map(function ($m) {
                $muestra = DB::table('sales_documents')->where('brand_id', $m->id)->whereIn('doc_type', ['RECEIPT', 'INVOICE'])->where('status', 'ISSUED')
                    ->whereIn('sunat_status', ['ACCEPTED', 'OBSERVED'])->orderByDesc('issued_at')->value('id');

                return self::marca($m) + ['muestra_id' => $muestra];
            })->values(),
        ];
    }

    public static function guardar(string $brandId, array $d, User $u): array
    {
        $m = DB::table('brands')->where('id', $brandId)->first() ?? RuleError::fail('RN-FAC-16', 'La marca no existe.');
        Emision::alcance($u, $m->id, null);
        $pie = trim((string) ($d['legal_footer'] ?? ''));
        $ruc = DB::table('companies')->where('id', $m->company_id)->value('ruc');
        if ($pie === '') {
            RuleError::fail('RN-FAC-16', 'El pie legal es obligatorio: sale en el comprobante impreso.');
        }
        if (! preg_match('/RUC/i', $pie)) {
            RuleError::fail('RN-FAC-16', "El pie legal menciona a la empresa emisora y su RUC ({$ruc}): la razón social y el RUC son siempre los de la empresa.");
        }
        $leyendas = trim((string) ($d['print_legends'] ?? ''));
        DB::table('brands')->where('id', $m->id)->update([
            'legal_footer' => mb_substr($pie, 0, 255), 'print_legends' => $leyendas !== '' ? mb_substr($leyendas, 0, 255) : null,
            'print_show_logo' => (bool) ($d['print_show_logo'] ?? true), 'updated_at' => now(),
        ]);

        return self::marca(DB::table('brands')->where('id', $m->id)->first());
    }
}
