<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Control de vendedoras (RN-CRM-15, 16 y 17): CRM-12 Alertas de control y CRM-13 Reglas e identificadores oficiales.
 *
 * Al enviar, el texto de la vendedora se revisa: un celular peruano de 9 dígitos o una cuenta de 13 a 20 dígitos que no
 * están en los identificadores oficiales (ni es el celular del propio cliente) alertan con gravedad alta; también las
 * frases configuradas (sin tildes ni mayúsculas) y los términos del rubro que no corresponden a ningún producto activo
 * del catálogo. El sistema suma sus propias señales: borrado en el celular y chat sin responder. La supervisora revisa
 * cada alerta y la cierra como confirmada o descartada, siempre con nota; las alertas no se borran.
 */
class Control
{
    public const TIPOS = ['KEYWORD' => 'Frase', 'FOREIGN_PHONE' => 'Celular ajeno', 'FOREIGN_ACCOUNT' => 'Cuenta ajena', 'OFF_CATALOG_TERM' => 'Producto fuera del catálogo',
        'APP_DELETION' => 'Borrado en el celular', 'UNANSWERED_CHAT' => 'Chat sin responder', 'SURVEY_FLAG' => 'Encuesta: compra fuera de la web'];

    /** Los que se crean y editan a mano; los demás son señales del sistema (solo se cambia su gravedad o se apagan). */
    public const TIPOS_EDITABLES = ['KEYWORD', 'FOREIGN_PHONE', 'FOREIGN_ACCOUNT', 'OFF_CATALOG_TERM'];

    public const GRAVEDADES = ['HIGH' => 'Alta', 'MEDIUM' => 'Media', 'LOW' => 'Baja'];

    public const ESTADOS = ['OPEN' => 'Abierta', 'UNDER_REVIEW' => 'En revisión', 'DISMISSED' => 'Descartada', 'CONFIRMED' => 'Confirmada'];

    public const FUENTES = ['MESSAGE' => 'Chat', 'VOICE_NOTE' => 'Nota de voz', 'CALL_TRANSCRIPT' => 'Llamada', 'SYSTEM' => 'Señal del sistema', 'SURVEY' => 'Encuesta'];

    public const IDENTIFICADORES = ['PHONE' => 'Celular o teléfono', 'YAPE' => 'Yape', 'PLIN' => 'Plin', 'BANK_ACCOUNT' => 'Cuenta bancaria', 'CCI' => 'CCI', 'EMAIL' => 'Correo', 'URL' => 'Web'];

    private static ?array $catalogo = null;

    /** Sin tildes y en minúsculas, para comparar frases. */
    public static function normal(string $t): string
    {
        return mb_strtolower(Str::ascii($t));
    }

    private static function digitos(string $t): string
    {
        return preg_replace('/\D/', '', $t);
    }

    /** Celulares (últimos 9 dígitos) y cuentas oficiales activas. */
    private static function oficiales(): array
    {
        $tel = [];
        $cta = [];
        foreach (DB::table('official_identifiers')->where('status', 'ACTIVE')->get(['identifier_type', 'value']) as $o) {
            $d = self::digitos($o->value);
            if (in_array($o->identifier_type, ['PHONE', 'YAPE', 'PLIN'], true) && $d !== '') {
                $tel[substr($d, -9)] = true;
            } elseif (in_array($o->identifier_type, ['BANK_ACCOUNT', 'CCI'], true) && $d !== '') {
                $cta[$d] = true;
            }
        }

        return [$tel, $cta];
    }

    /** ¿Algún producto o presentación activa y vendible contiene el término? (RN-CRM-16) */
    public static function enCatalogo(string $termino): bool
    {
        self::$catalogo ??= array_map(fn ($n) => self::normal((string) $n), array_merge(
            DB::table('products')->where('status', 'ACTIVE')->where('product_type', 'GOODS')->pluck('name')->all(),
            DB::table('product_variants')->where('status', 'ACTIVE')->where('sellable', true)->pluck('name')->all(),
        ));
        $t = self::normal($termino);
        foreach (self::$catalogo as $n) {
            if (str_contains($n, $t)) {
                return true;
            }
        }

        return false;
    }

    public static function olvidarCatalogo(): void
    {
        self::$catalogo = null;
    }

    /**
     * Revisa un texto con las reglas activas. Devuelve [['regla' => fila, 'coincidencia' => texto], …].
     * $celularCliente: el número del propio cliente no alerta.
     */
    public static function revisar(string $texto, ?string $celularCliente = null): array
    {
        $reglas = DB::table('control_alert_rules')->where('active', true)->whereIn('rule_type', self::TIPOS_EDITABLES)->orderBy('code')->get()->groupBy('rule_type');
        if ($reglas->isEmpty() || trim($texto) === '') {
            return [];
        }
        [$tel, $cta] = self::oficiales();
        $propio = $celularCliente ? substr(self::digitos($celularCliente), -9) : null;
        $hits = [];
        $resto = $texto;
        // Primero las cuentas (13 a 20 dígitos), para que un celular dentro de una cuenta no cuente dos veces.
        preg_match_all('/\d(?:[ .\-]?\d){12,19}/u', $texto, $m);
        foreach ($m[0] as $a) {
            $resto = str_replace($a, ' ', $resto);
            $d = self::digitos($a);
            if (strlen($d) < 13 || strlen($d) > 20 || isset($cta[$d])) {
                continue;
            }
            foreach ($reglas['FOREIGN_ACCOUNT'] ?? [] as $r) {
                $hits[] = ['regla' => $r, 'coincidencia' => $a];
            }
        }
        preg_match_all('/(?<!\d)(?:\+?51[ .\-]?)?9(?:[ .\-]?\d){8}(?!\d)/u', $resto, $m);
        foreach ($m[0] as $p) {
            $d = substr(self::digitos($p), -9);
            if (isset($tel[$d]) || ($propio && $d === $propio)) {
                continue;
            }
            foreach ($reglas['FOREIGN_PHONE'] ?? [] as $r) {
                $hits[] = ['regla' => $r, 'coincidencia' => trim($p)];
            }
        }
        $n = self::normal($texto);
        foreach ($reglas['KEYWORD'] ?? [] as $r) {
            $k = self::normal($r->pattern);
            if ($k !== '' && preg_match('/(^|[^a-z0-9])'.preg_quote($k, '/').'($|[^a-z0-9])/u', $n)) {
                $hits[] = ['regla' => $r, 'coincidencia' => $r->pattern];
            }
        }
        foreach ($reglas['OFF_CATALOG_TERM'] ?? [] as $r) {
            $k = self::normal($r->pattern);
            if ($k !== '' && preg_match('/(^|[^a-z0-9])'.preg_quote($k, '/').'(es|s)?($|[^a-z0-9])/u', $n) && ! self::enCatalogo($r->pattern)) {
                $hits[] = ['regla' => $r, 'coincidencia' => $r->pattern];
            }
        }

        return $hits;
    }

    /** Revisa un mensaje saliente de una persona y crea sus alertas (lo llama Mensajes al enviar). */
    public static function revisarMensaje(string $mensaje, object $cv, string $texto, ?string $vendedora, string $fuente = 'MESSAGE'): int
    {
        if (! $vendedora) {
            return 0;
        }
        $celular = ($cv->customer_id ? DB::table('customers')->where('id', $cv->customer_id)->value('phone') : null)
            ?? DB::table('channel_contacts')->where('id', $cv->contact_id)->value('external_user_id');
        $n = 0;
        foreach (self::revisar($texto, $celular) as $h) {
            self::levantar($h['regla'], $h['coincidencia'], $vendedora, $texto, $cv, $mensaje, $fuente);
            $n++;
        }

        return $n;
    }

    /** Señal del sistema (borrado en el celular, chat sin responder, encuesta) con la regla de su tipo, si está activa. */
    public static function senal(string $tipo, string $coincidencia, ?string $vendedora, ?string $extracto, ?object $cv, ?string $mensaje = null, string $fuente = 'SYSTEM'): ?string
    {
        $r = DB::table('control_alert_rules')->where('rule_type', $tipo)->where('active', true)->orderBy('code')->first();

        return $r && $vendedora ? self::levantar($r, $coincidencia, $vendedora, (string) $extracto, $cv, $mensaje, $fuente) : null;
    }

    private static function levantar(object $r, string $coincidencia, string $vendedora, string $extracto, ?object $cv, ?string $mensaje, string $fuente): string
    {
        $id = DB::table('control_alerts')->insertGetId([
            'rule_id' => $r->id, 'rule_code' => $r->code, 'source_type' => $fuente, 'message_id' => $mensaje, 'conversation_id' => $cv?->id, 'user_id' => $vendedora,
            'brand_id' => $cv?->brand_id, 'severity' => $r->severity, 'matched_text' => mb_substr($coincidencia, 0, 500), 'excerpt' => mb_substr(trim($extracto), 0, 250) ?: '—',
            'status' => 'OPEN', 'raised_at' => DB::raw('clock_timestamp()'), 'created_at' => now(), 'updated_at' => now(),
        ], 'id');
        Events::emit('control_alert.raised', 'control_alerts', $id, ['user_id' => $vendedora, 'rule' => $r->code, 'severity' => $r->severity]);
        $nombre = DB::table('users')->where('id', $vendedora)->value('name') ?? 'Vendedora';
        DB::table('notifications')->insert(['role' => 'SUPERVISORA_VENTAS', 'module' => 'CRM', 'tone' => $r->severity === 'HIGH' ? 'bad' : 'warn',
            'severity' => $r->severity === 'HIGH' ? 'CRITICAL' : 'WARNING', 'type' => 'SECURITY', 'at' => now(),
            'title' => 'Alerta de control ('.mb_strtolower(self::GRAVEDADES[$r->severity] ?? $r->severity).')',
            'body' => mb_substr("{$nombre} · {$r->name}: «{$coincidencia}»", 0, 1000),
            'ref' => json_encode(['href' => "/m/crm/crm-12?id={$id}", 'brand_id' => $cv?->brand_id])]);

        return $id;
    }

    /* ------------------------------------------------------------------ CRM-12 Alertas */

    private static function base(User $u)
    {
        $marcas = Access::for($u)['brands'];

        return DB::table('control_alerts as a')->when($marcas, fn ($w) => $w->where(fn ($x) => $x->whereNull('a.brand_id')->orWhereIn('a.brand_id', $marcas)));
    }

    public static function alertas(array $f, User $u): array
    {
        $q = self::base($u)->join('control_alert_rules as r', 'r.id', '=', 'a.rule_id')->leftJoin('users as x', 'x.id', '=', 'a.user_id')
            ->leftJoin('users as rv', 'rv.id', '=', 'a.reviewed_by')->leftJoin('brands as b', 'b.id', '=', 'a.brand_id');
        foreach (['conversacion' => 'a.conversation_id', 'vendedora' => 'a.user_id', 'regla' => 'a.rule_id', 'gravedad' => 'a.severity', 'fuente' => 'a.source_type', 'marca' => 'a.brand_id'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        if (! empty($f['desde'])) {
            $q->where('a.raised_at', '>=', Carbon::parse($f['desde'], 'America/Lima')->startOfDay());
        }
        if (! empty($f['hasta'])) {
            $q->where('a.raised_at', '<=', Carbon::parse($f['hasta'], 'America/Lima')->endOfDay());
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('a.matched_text', 'ilike', $p)->orWhere('a.excerpt', 'ilike', $p)->orWhere('x.name', 'ilike', $p)->orWhere('r.name', 'ilike', $p));
        }
        $mes = now('America/Lima')->startOfMonth();
        $c = (clone $q)->selectRaw("count(*) FILTER (WHERE a.status = 'OPEN') AS abiertas, count(*) FILTER (WHERE a.status = 'OPEN' AND a.severity = 'HIGH') AS altas,
            count(*) FILTER (WHERE a.status = 'UNDER_REVIEW') AS en_revision, count(*) FILTER (WHERE a.status = 'CONFIRMED' AND a.reviewed_at >= ?) AS confirmadas_mes,
            count(*) FILTER (WHERE a.status = 'CONFIRMED') AS confirmadas, count(*) FILTER (WHERE a.status = 'DISMISSED') AS descartadas", [$mes])->first();
        $porVendedora = (clone $q)->whereIn('a.status', ['OPEN', 'UNDER_REVIEW'])->groupBy('a.user_id', 'x.name')
            ->selectRaw("x.name, count(*) AS n, bool_or(a.severity = 'HIGH') AS alta")->orderByDesc('n')->limit(12)->get()
            ->map(fn ($x) => ['nombre' => $x->name, 'n' => (int) $x->n, 'alta' => (bool) $x->alta])->all();
        match ($f['estado'] ?? 'ACTIVAS') {
            'ALL' => null,
            'ACTIVAS' => $q->whereIn('a.status', ['OPEN', 'UNDER_REVIEW']),
            default => $q->where('a.status', $f['estado']),
        };
        $q->orderByDesc('a.raised_at')->orderBy('a.id');
        Paginas::ordenar($q, ['fecha' => 'a.raised_at', 'vendedora' => 'x.name', 'regla' => 'a.rule_code', 'gravedad' => "CASE a.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END",
            'estado' => 'a.status'], 'a.id', $f);
        $q->select(['a.*', 'r.name as regla', 'r.rule_type', 'x.name as vendedora', 'rv.name as reviso', 'b.name as marca']);
        $r = Paginas::de($q, fn ($a) => self::presentar($a, $u), $f);
        $marcas = Access::for($u)['brands'];

        return $r + [
            'cifras' => ['abiertas' => (int) $c->abiertas, 'altas' => (int) $c->altas, 'en_revision' => (int) $c->en_revision, 'confirmadas_mes' => (int) $c->confirmadas_mes,
                'confirmadas' => (int) $c->confirmadas, 'descartadas' => (int) $c->descartadas],
            'por_vendedora' => $porVendedora,
            'conversacion' => ! empty($f['conversacion']) ? self::nombreChat($f['conversacion'], $u) : null,
            'opciones' => [
                'estados' => self::opciones(self::ESTADOS), 'gravedades' => self::opciones(self::GRAVEDADES), 'fuentes' => self::opciones(self::FUENTES),
                'reglas' => DB::table('control_alert_rules')->orderBy('code')->get(['id', 'code', 'name'])->map(fn ($x) => ['value' => $x->id, 'label' => $x->name])->all(),
                'vendedoras' => DB::table('users as x')->whereIn('x.id', self::base($u)->select('a.user_id'))->orderBy('x.name')->get(['x.id', 'x.name'])
                    ->map(fn ($x) => ['value' => $x->id, 'label' => $x->name])->all(),
                'marcas' => DB::table('brands')->when($marcas, fn ($w) => $w->whereIn('id', $marcas))->where('status', 'ACTIVE')->orderBy('name')
                    ->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
            ],
            'puede' => ['revisar' => Access::can($u, 'crm.alert.review')],
        ];
    }

    private static function nombreChat(string $id, User $u): ?string
    {
        $v = Conversaciones::visibles($u)->where('v.id', $id)->leftJoin('customers as cu', 'cu.id', '=', 'v.customer_id')->leftJoin('leads as l', 'l.id', '=', 'v.lead_id')
            ->leftJoin('channel_contacts as k', 'k.id', '=', 'v.contact_id')->first([DB::raw('coalesce(cu.full_name, l.full_name, k.display_name, k.external_user_id) AS n')]);

        return $v?->n;
    }

    private static function presentar(object $a, User $u): array
    {
        return [
            'id' => $a->id, 'raised_at' => $a->raised_at, 'vendedora' => $a->vendedora, 'user_id' => $a->user_id, 'regla' => $a->regla, 'rule_code' => $a->rule_code,
            'tipo' => self::TIPOS[$a->rule_type] ?? $a->rule_type, 'severity' => $a->severity, 'gravedad' => self::GRAVEDADES[$a->severity] ?? $a->severity,
            'coincidencia' => $a->matched_text, 'extracto' => $a->excerpt, 'fuente' => self::FUENTES[$a->source_type] ?? $a->source_type, 'marca' => $a->marca,
            'status' => $a->status, 'estado' => self::ESTADOS[$a->status] ?? $a->status, 'conversation_id' => $a->conversation_id, 'message_id' => $a->message_id,
            'reviso' => $a->reviso, 'reviewed_at' => $a->reviewed_at, 'nota' => $a->resolution_note,
            'puede_revisar' => in_array($a->status, ['OPEN', 'UNDER_REVIEW'], true) && $a->user_id !== $u->id && Access::can($u, 'crm.alert.review'),
            'propia' => $a->user_id === $u->id,
        ];
    }

    public static function alerta(string $id, User $u): array
    {
        $a = self::base($u)->where('a.id', $id)->join('control_alert_rules as r', 'r.id', '=', 'a.rule_id')->leftJoin('users as x', 'x.id', '=', 'a.user_id')
            ->leftJoin('users as rv', 'rv.id', '=', 'a.reviewed_by')->leftJoin('brands as b', 'b.id', '=', 'a.brand_id')
            ->first(['a.*', 'r.name as regla', 'r.rule_type', 'x.name as vendedora', 'rv.name as reviso', 'b.name as marca']) ?? abort(404);
        $fila = self::presentar($a, $u);
        $fila['chat'] = $a->conversation_id ? self::nombreChat($a->conversation_id, $u) : null;
        if (! $fila['chat']) {
            $fila['conversation_id'] = null;   // solo se enlaza si la persona puede abrir el chat
        }

        return $fila;
    }

    /** Tomar en revisión, confirmar o descartar (RN-CRM-17). */
    public static function revisarAlerta(string $id, string $estado, ?string $nota, User $u): array
    {
        if (! Access::can($u, 'crm.alert.review')) {
            RuleError::fail('RN-CRM-17', 'Solo la supervisora o la gerencia revisan alertas.');
        }
        $a = self::base($u)->where('a.id', $id)->first(['a.*']) ?? abort(404);
        if (in_array($a->status, ['DISMISSED', 'CONFIRMED'], true)) {
            RuleError::fail('RN-CRM-17', 'La alerta ya está cerrada: las alertas no se reabren ni se borran.');
        }
        if ($a->user_id === $u->id) {
            RuleError::fail('RN-CRM-17', 'Nadie revisa una alerta sobre sí misma.');
        }
        $nota = trim((string) $nota);
        if ($estado === 'UNDER_REVIEW' && $a->status !== 'OPEN') {
            RuleError::fail('RN-CRM-17', 'La alerta ya está en revisión.');
        }
        if (in_array($estado, ['DISMISSED', 'CONFIRMED'], true) && mb_strlen($nota) < 5) {
            RuleError::fail('RN-CRM-17', 'Cerrar una alerta exige una nota de la revisión (al menos 5 caracteres).');
        }
        DB::table('control_alerts')->where('id', $id)->update(['status' => $estado, 'reviewed_by' => $u->id, 'reviewed_at' => now(),
            'resolution_note' => $nota !== '' ? mb_substr($nota, 0, 2000) : null, 'updated_at' => now()]);
        Events::emit('control_alert.reviewed', 'control_alerts', $id, ['status' => $estado, 'by' => $u->id]);
        if ($estado === 'CONFIRMED') {
            $nombre = DB::table('users')->where('id', $a->user_id)->value('name') ?? 'Vendedora';
            DB::table('notifications')->insert(['role' => 'GERENTE', 'module' => 'CRM', 'tone' => 'bad', 'severity' => 'CRITICAL', 'type' => 'SECURITY', 'at' => now(),
                'title' => 'Alerta de control confirmada', 'body' => mb_substr("{$nombre} · «{$a->matched_text}» · {$nota}", 0, 1000),
                'ref' => json_encode(['href' => "/m/crm/crm-12?id={$id}", 'brand_id' => $a->brand_id])]);
        }

        return self::alerta($id, $u);
    }

    /* ------------------------------------------------------------------ CRM-13 Reglas e identificadores */

    public static function reglas(array $f): array
    {
        $q = DB::table('control_alert_rules as r')
            ->when(! empty($f['tipo']), fn ($w) => $w->where('r.rule_type', $f['tipo']))->when(! empty($f['gravedad']), fn ($w) => $w->where('r.severity', $f['gravedad']))
            ->when(($f['activa'] ?? '') !== '', fn ($w) => $w->where('r.active', $f['activa'] === '1'));
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('r.code', 'ilike', $p)->orWhere('r.name', 'ilike', $p)->orWhere('r.pattern', 'ilike', $p));
        }
        $q->orderBy('r.code');
        Paginas::ordenar($q, ['codigo' => 'r.code', 'nombre' => 'r.name', 'tipo' => 'r.rule_type', 'gravedad' => "CASE r.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END",
            'alertas' => '(SELECT count(*) FROM control_alerts a WHERE a.rule_id = r.id)'], 'r.id', $f);
        $q->select(['r.*', DB::raw('(SELECT count(*) FROM control_alerts a WHERE a.rule_id = r.id) AS alertas'),
            DB::raw("(SELECT count(*) FROM control_alerts a WHERE a.rule_id = r.id AND a.status IN ('OPEN','UNDER_REVIEW')) AS abiertas")]);

        return Paginas::de($q, fn ($r) => [
            'id' => $r->id, 'code' => $r->code, 'name' => $r->name, 'rule_type' => $r->rule_type, 'tipo' => self::TIPOS[$r->rule_type] ?? $r->rule_type,
            'pattern' => $r->pattern, 'severity' => $r->severity, 'gravedad' => self::GRAVEDADES[$r->severity] ?? $r->severity, 'active' => (bool) $r->active,
            'alertas' => (int) $r->alertas, 'abiertas' => (int) $r->abiertas, 'sistema' => ! in_array($r->rule_type, self::TIPOS_EDITABLES, true),
            'en_catalogo' => $r->rule_type === 'OFF_CATALOG_TERM' ? self::enCatalogo($r->pattern) : null,
        ], $f) + ['opciones' => ['tipos' => self::opciones(self::TIPOS), 'editables' => self::opciones(array_intersect_key(self::TIPOS, array_flip(self::TIPOS_EDITABLES))),
            'gravedades' => self::opciones(self::GRAVEDADES)]];
    }

    public static function guardarRegla(?string $id, array $d, User $u): array
    {
        $antes = $id ? (DB::table('control_alert_rules')->where('id', $id)->first() ?? abort(404)) : null;
        $tipo = $antes->rule_type ?? $d['rule_type'];
        if (! $antes && ! in_array($tipo, self::TIPOS_EDITABLES, true)) {
            RuleError::fail('RN-CRM-16', 'Las señales del sistema (borrado en el celular, chat sin responder, encuesta) ya existen: solo se cambia su gravedad o se apagan.');
        }
        if ($antes && isset($d['rule_type']) && $d['rule_type'] !== $antes->rule_type) {
            RuleError::fail('RN-CRM-16', 'El tipo de una regla no cambia: crea otra y apaga esta.');
        }
        $codigo = mb_strtoupper(trim((string) ($d['code'] ?? $antes?->code)));
        if (! preg_match('/^[A-Z0-9\-]{3,20}$/', $codigo)) {
            RuleError::fail('RN-CRM-16', 'El código va en mayúsculas, números y guiones (de 3 a 20).');
        }
        if (DB::table('control_alert_rules')->where('code', $codigo)->when($id, fn ($q) => $q->where('id', '<>', $id))->exists()) {
            RuleError::fail('RN-CRM-16', "Ya existe una regla con el código {$codigo}.");
        }
        $patron = trim((string) ($d['pattern'] ?? $antes?->pattern));
        $editable = in_array($tipo, self::TIPOS_EDITABLES, true);
        if (in_array($tipo, ['KEYWORD', 'OFF_CATALOG_TERM'], true) && mb_strlen($patron) < 3) {
            RuleError::fail('RN-CRM-16', 'La frase o el término lleva al menos 3 letras.');
        }
        $fila = ['code' => $codigo, 'name' => mb_substr(trim((string) ($d['name'] ?? $antes?->name)), 0, 120), 'severity' => $d['severity'] ?? $antes?->severity,
            'active' => (bool) ($d['active'] ?? $antes?->active ?? true), 'updated_at' => now()];
        if ($editable) {
            $fila['pattern'] = mb_substr($patron, 0, 255);
        }
        if ($antes) {
            DB::table('control_alert_rules')->where('id', $id)->update($fila);
        } else {
            $id = DB::table('control_alert_rules')->insertGetId($fila + ['rule_type' => $tipo, 'applies_to' => json_encode(['CHAT', 'CALL']), 'created_at' => now()], 'id');
        }
        Events::emit($antes ? 'control_rule.updated' : 'control_rule.created', 'control_alert_rules', $id, ['by' => $u->id, 'active' => $fila['active']]);

        return (array) DB::table('control_alert_rules')->where('id', $id)->first();
    }

    public static function identificadores(array $f, User $u): array
    {
        $q = DB::table('official_identifiers as o')->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')
            ->when(! empty($f['tipo']), fn ($w) => $w->where('o.identifier_type', $f['tipo']))->when(! empty($f['estado']), fn ($w) => $w->where('o.status', $f['estado']))
            ->when(! empty($f['marca']), fn ($w) => $w->where('o.brand_id', $f['marca']));
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('o.value', 'ilike', $p)->orWhere('o.label', 'ilike', $p));
        }
        $q->orderBy('o.identifier_type')->orderBy('o.label');
        Paginas::ordenar($q, ['tipo' => 'o.identifier_type', 'valor' => 'o.value', 'descripcion' => 'o.label', 'marca' => 'b.name', 'estado' => 'o.status'], 'o.id', $f);
        $q->select(['o.*', 'b.name as marca']);
        $marcas = Access::for($u)['brands'];

        return Paginas::de($q, fn ($o) => ['id' => $o->id, 'identifier_type' => $o->identifier_type, 'tipo' => self::IDENTIFICADORES[$o->identifier_type] ?? $o->identifier_type,
            'value' => $o->value, 'label' => $o->label, 'brand_id' => $o->brand_id, 'marca' => $o->marca ?? 'Todas las marcas', 'status' => $o->status], $f)
            + ['opciones' => ['tipos' => self::opciones(self::IDENTIFICADORES),
                'marcas' => DB::table('brands')->when($marcas, fn ($w) => $w->whereIn('id', $marcas))->where('status', 'ACTIVE')->orderBy('name')
                    ->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all()]];
    }

    public static function guardarIdentificador(?string $id, array $d, User $u): array
    {
        $antes = $id ? (DB::table('official_identifiers')->where('id', $id)->first() ?? abort(404)) : null;
        $tipo = $d['identifier_type'];
        $valor = trim($d['value']);
        $digitos = self::digitos($valor);
        $valor = match ($tipo) {
            'PHONE', 'YAPE', 'PLIN' => strlen($digitos) === 9 ? '+51'.$digitos : (str_starts_with($valor, '+') ? '+'.$digitos : $digitos),
            'CCI' => $digitos,
            'EMAIL' => mb_strtolower($valor),
            default => $valor,
        };
        $ok = match ($tipo) {
            'PHONE', 'YAPE', 'PLIN' => strlen($digitos) >= 7 && strlen($digitos) <= 15,
            'BANK_ACCOUNT' => strlen($digitos) >= 10 && strlen($digitos) <= 20 && preg_match('/^[\d\- ]+$/', $valor),
            'CCI' => strlen($digitos) === 20,
            'EMAIL' => (bool) filter_var($valor, FILTER_VALIDATE_EMAIL),
            'URL' => (bool) filter_var($valor, FILTER_VALIDATE_URL) && preg_match('#^https?://#i', $valor),
            default => false,
        };
        if (! $ok) {
            RuleError::fail('RN-CRM-15', match ($tipo) {
                'PHONE', 'YAPE', 'PLIN' => 'El número va con 9 dígitos o con su código de país.',
                'BANK_ACCOUNT' => 'La cuenta lleva de 10 a 20 dígitos (puede llevar guiones).',
                'CCI' => 'El CCI lleva 20 dígitos.',
                'EMAIL' => 'Escribe un correo válido.',
                default => 'Escribe la dirección completa, con http:// o https://.',
            });
        }
        $marca = $d['brand_id'] ?? null;
        $permitidas = Access::for($u)['brands'];
        if ($marca && $permitidas && ! in_array($marca, $permitidas, true)) {
            RuleError::fail('RN-CRM-15', 'Esa marca no es tuya.');
        }
        if (DB::table('official_identifiers')->where('identifier_type', $tipo)->where('value', $valor)->when($id, fn ($q) => $q->where('id', '<>', $id))->exists()) {
            RuleError::fail('RN-CRM-15', 'Ese identificador ya está en la lista.');
        }
        $fila = ['identifier_type' => $tipo, 'value' => mb_substr($valor, 0, 120), 'label' => mb_substr(trim($d['label']), 0, 120), 'brand_id' => $marca, 'status' => $d['status'], 'updated_at' => now()];
        if ($antes) {
            DB::table('official_identifiers')->where('id', $id)->update($fila);
        } else {
            $id = DB::table('official_identifiers')->insertGetId($fila + ['created_at' => now()], 'id');
        }
        Events::emit($antes ? 'official_identifier.updated' : 'official_identifier.created', 'official_identifiers', $id, ['by' => $u->id, 'type' => $tipo, 'status' => $d['status']]);

        return (array) DB::table('official_identifiers')->where('id', $id)->first();
    }

    /** «Probar un texto»: qué alertas daría, sin crear ninguna. */
    public static function probar(string $texto): array
    {
        return array_map(fn ($h) => ['code' => $h['regla']->code, 'name' => $h['regla']->name, 'tipo' => self::TIPOS[$h['regla']->rule_type] ?? $h['regla']->rule_type,
            'severity' => $h['regla']->severity, 'gravedad' => self::GRAVEDADES[$h['regla']->severity] ?? $h['regla']->severity, 'coincidencia' => $h['coincidencia']], self::revisar($texto));
    }

    private static function opciones(array $xs): array
    {
        return collect($xs)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all();
    }
}
