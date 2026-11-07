<?php

namespace App\Modulos\Cat\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cat\Models\Product;
use App\Modulos\Cat\Services\Productos;
use App\Modulos\Cat\Services\RegistroSanitario;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * CAT-10 Registros sanitarios: productos con autoridad (SENASA o DIGESA), número de registro y vencimiento,
 * con semáforo a cat_sanitary_alert_days (90), 30 y 0 días, y el certificado adjunto (RN-CAT-09).
 * El certificado va al disco privado: empresas/{tenant}/certificados/{producto}.{pdf|jpg|png}.
 */
class SanitarioController extends Controller
{
    private const ORDEN = ['EXPIRED' => 0, 'MISSING' => 1, 'RED' => 2, 'AMBER' => 3, 'OK' => 4];

    public function index(Request $request)
    {
        $marcas = Access::for($request->user())['brands'];
        $aviso = RegistroSanitario::diasAviso();
        $filas = DB::table('products as p')->leftJoin('brands as b', 'b.id', '=', 'p.brand_id')
            ->whereNotNull('p.sanitary_authority')->where('p.sanitary_authority', '!=', 'NONE')
            ->when($marcas, fn ($q) => $q->whereIn('p.brand_id', $marcas))
            ->when($request->query('brand_id'), fn ($q, $m) => $q->where('p.brand_id', $m))
            ->get(['p.id', 'p.code', 'p.name', 'p.brand_id', 'b.name as brand_name', 'p.status', 'p.sanitary_authority', 'p.sanitary_registry',
                'p.sanitary_registry_expires', 'p.sanitary_alert_days', 'p.sanitary_certificate', 'p.web_publishable'])
            ->map(function ($p) use ($aviso) {
                $p->sanitario = RegistroSanitario::estado($p, null, $aviso);
                $p->web_publishable = (bool) $p->web_publishable;

                return $p;
            })
            ->sort(fn ($a, $b) => self::ORDEN[$a->sanitario['code']] <=> self::ORDEN[$b->sanitario['code']]
                ?: ($a->sanitario['days'] ?? 0) <=> ($b->sanitario['days'] ?? 0) ?: strcmp($a->name, $b->name))
            ->values();

        $n = fn ($c) => $filas->filter(fn ($p) => $p->sanitario['code'] === $c)->count();

        return response()->json([
            'filas' => $filas,
            'resumen' => ['vigentes' => $n('OK'), 'ambar' => $n('AMBER'), 'rojo' => $n('RED'), 'vencidos' => $n('EXPIRED') + $n('MISSING'), 'dias_aviso' => $aviso],
        ]);
    }

    /** Registrar o renovar: el vencimiento debe ser futuro; con activar, el producto se activa. */
    public function update(Request $request, string $id)
    {
        $p = $this->delAlcance($request, $id);
        $d = $request->validate([
            'sanitary_authority' => ['required', Rule::in(['SENASA', 'DIGESA'])],
            'sanitary_registry' => ['required', 'string', 'max:40'],
            'sanitary_registry_expires' => ['required', 'date_format:Y-m-d'],
            'sanitary_alert_days' => ['nullable', 'integer', 'min:1', 'max:365'],
            'activar' => ['boolean'],
        ], ['sanitary_registry.required' => 'Escribe el número de registro sanitario.']);
        if ($d['sanitary_registry_expires'] <= now()->toDateString()) {
            RuleError::fail('RN-CAT-09', 'La fecha de vencimiento ya pasó: registra la renovación vigente.');
        }

        DB::transaction(function () use ($p, $d, $request) {
            $p->forceFill([
                'sanitary_authority' => $d['sanitary_authority'], 'sanitary_registry' => trim($d['sanitary_registry']),
                'sanitary_registry_expires' => $d['sanitary_registry_expires'], 'sanitary_alert_days' => $d['sanitary_alert_days'] ?? null,
            ])->save();
            if (! empty($d['activar']) && $p->status !== 'ACTIVE') {
                Productos::cambiarEstado($p->fresh(), 'ACTIVE', $request->user());
            }
            Events::emit('product.changed', 'products', $p->id, ['product_id' => $p->id, 'sanitary' => true]);
        });

        return response()->json(['id' => $p->id, 'sanitario' => RegistroSanitario::estado($p->fresh())]);
    }

    public function subirCertificado(Request $request, string $id)
    {
        $p = $this->delAlcance($request, $id);
        $request->validate(['certificado' => ['required', 'file', 'max:5120', 'mimes:pdf,jpg,jpeg,png']], [
            'certificado.required' => 'Elige el archivo del certificado.',
            'certificado.max' => 'El certificado no puede pesar más de 5 MB.',
            'certificado.mimes' => 'El certificado debe ser PDF, JPG o PNG.',
        ]);
        $archivo = $request->file('certificado');
        $ext = $archivo->extension() === 'jpeg' ? 'jpg' : $archivo->extension();
        $nombre = $p->id.'.'.$ext;
        if ($p->sanitary_certificate && $p->sanitary_certificate !== $nombre) {
            Storage::disk('local')->delete($this->ruta($p->sanitary_certificate));
        }
        Storage::disk('local')->putFileAs(dirname($this->ruta($nombre)), $archivo, $nombre);
        $p->forceFill(['sanitary_certificate' => $nombre])->save();

        return response()->json(['sanitary_certificate' => $nombre]);
    }

    public function certificado(Request $request, string $id)
    {
        $p = $this->delAlcance($request, $id);
        $ruta = $p->sanitary_certificate ? $this->ruta($p->sanitary_certificate) : null;
        abort_unless($ruta && Storage::disk('local')->exists($ruta), 404, 'No hay certificado.');

        return Storage::disk('local')->response($ruta, null, ['Cache-Control' => 'private, no-cache', 'X-Content-Type-Options' => 'nosniff']);
    }

    private function delAlcance(Request $request, string $id): Product
    {
        $marcas = Access::for($request->user())['brands'];

        return Product::query()->when($marcas, fn ($q) => $q->whereIn('brand_id', $marcas))->findOrFail($id);
    }

    private function ruta(string $nombre): string
    {
        return 'empresas/'.(TenantContext::id() ?? abort(404)).'/certificados/'.basename($nombre);
    }
}
