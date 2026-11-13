<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * La página pública de Aycha (landing): sin sesión y sin empresa. Solo lee el catálogo de planes y guarda
 * pedidos de demo (la app no puede leer los pedidos: los ve la plataforma). Límite por IP en las rutas.
 */
class PublicoController extends Controller
{
    /** Tipos de negocio del formulario de la página. */
    public const TIPOS = ['CARNICERIA', 'DISTRIBUIDORA', 'AVICOLA', 'GRANJA', 'PLANTA', 'OTRO'];

    /** Lo que la persona quiere ver en la demo (casillas del formulario). */
    public const INTERESES = ['PEDIDOS', 'MOSTRADOR', 'REPARTO', 'COMPROBANTES', 'DESPIECE', 'CONSIGNACION'];

    /** Días de la prueba gratis que se anuncian en la página. */
    public const PRUEBA_DIAS = 14;

    /** Planes activos con lo que incluyen y sus módulos (nombre y código), en su orden. */
    public function planes()
    {
        $planes = DB::table('saas_plans')->where('status', 'ACTIVE')->orderBy('sort_order')
            ->get(['code', 'name', 'description', 'price_pen', 'users_max', 'brands_max', 'sites_max', 'is_featured', 'all_modules', 'includes_previous', 'highlights']);
        $todos = DB::table('platform_modules')->orderBy('sort_order')->get(['code', 'name']);
        $porPlan = DB::table('saas_plan_modules')->whereIn('plan_code', $planes->pluck('code'))->get()->groupBy('plan_code')
            ->map(fn ($filas) => $filas->pluck('module_code')->flip());
        // Solo los módulos que existen en la plataforma, en su orden; «todos» para el plan que los incluye todos.
        $modulos = fn ($p) => $todos->filter(fn ($m) => $p->all_modules || isset($porPlan[$p->code][$m->code]))
            ->map(fn ($m) => ['code' => $m->code, 'name' => $m->name])->values();

        return response()->json([
            'prueba_dias' => self::PRUEBA_DIAS,
            'planes' => $planes->map(fn ($p) => [
                'code' => $p->code, 'name' => $p->name, 'description' => $p->description, 'price_pen' => (float) $p->price_pen,
                'users_max' => (int) $p->users_max, 'brands_max' => (int) $p->brands_max, 'sites_max' => (int) $p->sites_max,
                'is_featured' => (bool) $p->is_featured, 'includes_previous' => $p->includes_previous,
                'highlights' => json_decode($p->highlights ?? '[]', true) ?: [],
                'modulos' => $modulos($p),
            ])->values(),
        ])->header('Cache-Control', 'public, max-age=300');
    }

    /**
     * Pedido de demo desde la página. Todo se valida aquí aunque la página ya valide; «sitio_web» es una
     * trampa para robots (las personas no la ven): si viene llena, se responde igual pero no se guarda.
     */
    public function demo(Request $request)
    {
        $listo = response()->json(['message' => 'Gracias. Te escribiremos por WhatsApp para coordinar el día y la hora de tu demo.'], 201);
        if (filled($request->input('sitio_web'))) {
            return $listo;
        }

        $d = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:80'],
            'phone' => ['required', 'string', 'regex:/^\+?[0-9 ()\-]{6,20}$/'],
            'email' => ['nullable', 'string', 'email:rfc', 'max:120'],
            'business_type' => ['required', Rule::in(self::TIPOS)],
            'interests' => ['nullable', 'array', 'max:6'],
            'interests.*' => ['string', 'distinct', Rule::in(self::INTERESES)],
            'plan_code' => ['nullable', 'string', Rule::exists('saas_plans', 'code')->where('status', 'ACTIVE')],
            'source' => ['nullable', 'string', 'max:200'],
            'consent' => ['accepted'],
        ], [
            'name.required' => 'Escribe tu nombre.',
            'phone.required' => 'Escribe tu WhatsApp.',
            'phone.regex' => 'Escribe un número válido (solo números, espacios, +, guiones o paréntesis).',
            'email.email' => 'Revisa el correo.',
            'business_type.required' => 'Elige tu rubro.',
            'business_type.in' => 'Elige tu rubro.',
            'consent.accepted' => 'Acepta que te escribamos para coordinar la demo.',
        ]);

        $limpio = fn (?string $v) => $v === null ? null : trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v));
        DB::table('demo_requests')->insert([
            'name' => $limpio($d['name']), 'phone' => trim($d['phone']),
            'email' => filled($d['email'] ?? null) ? mb_strtolower(trim($d['email'])) : null,
            'business_type' => $d['business_type'], 'interests' => json_encode(array_values($d['interests'] ?? [])),
            'plan_code' => $d['plan_code'] ?? null, 'source' => $limpio($d['source'] ?? null) ?: null, 'consent_at' => now(),
            'ip' => mb_substr((string) $request->ip(), 0, 45), 'user_agent' => mb_substr((string) $request->userAgent(), 0, 200) ?: null,
        ]);

        return $listo;
    }
}
