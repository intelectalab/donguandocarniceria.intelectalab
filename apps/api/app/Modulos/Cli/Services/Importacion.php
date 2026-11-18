<?php

namespace App\Modulos\Cli\Services;

use App\Models\User;
use App\Modulos\Cli\Models\Customer;
use Illuminate\Support\Facades\DB;

/**
 * CLI-12: importar clientes desde CSV o Excel pegado (agenda de WhatsApp, base de la web).
 * Columnas: nombre; celular; correo; documento; distrito. Separador «;», tabulación o «,».
 * Primero se revisa (celular a E.164, documento, duplicados en la base y dentro del archivo) y
 * después se confirma fila por fila: crear, crear y marcar duplicado, u omitir.
 * Las direcciones no se importan: sin pin no se guardan (RN-CLI-02); se piden con el enlace.
 */
final class Importacion
{
    public const MAX_FILAS = 2000;

    public const ORIGENES = ['WHATSAPP', 'WEB', 'OTHER'];

    /** Columnas del CSV y de la plantilla Excel (App\Support\Importar). */
    public const COLUMNAS = [
        ['clave' => 'nombre', 'titulo' => 'Nombre', 'ancho' => 32, 'otros' => ['nombre_completo', 'cliente', 'razon_social']],
        ['clave' => 'celular', 'titulo' => 'Celular', 'ancho' => 18, 'otros' => ['telefono', 'whatsapp']],
        ['clave' => 'correo', 'titulo' => 'Correo', 'ancho' => 28, 'otros' => ['email']],
        ['clave' => 'documento', 'titulo' => 'Documento (DNI o RUC)', 'ancho' => 22, 'otros' => ['dni', 'ruc', 'nro_documento']],
        ['clave' => 'distrito', 'titulo' => 'Distrito', 'ancho' => 22],
    ];

    /** @return array<int, array> */
    public static function revisar(string $texto): array
    {
        $lineas = array_values(array_filter(array_map('trim', preg_split('/\r\n|\r|\n/', $texto)), fn ($l) => $l !== ''));
        if (! $lineas) {
            return [];
        }
        $sep = str_contains($lineas[0], ';') ? ';' : (str_contains($lineas[0], "\t") ? "\t" : ',');
        $filas = [];
        $vistos = [];
        foreach (array_slice($lineas, 0, self::MAX_FILAS + 1) as $i => $l) {
            if ($i === 0 && preg_match('/nombre/i', $l)) {
                continue;
            }
            $c = array_map('trim', str_getcsv($l, $sep, '"', ''));
            [$nombre, $cel, $correo, $doc, $distrito] = array_pad($c, 5, '');
            $phone = Celulares::normalizar($cel);
            $doc = Documentos::limpiar($doc);
            $tipo = $doc ? (preg_match('/^\d{11}$/', $doc) ? 'RUC' : (preg_match('/^\d{8}$/', $doc) ? 'DNI' : 'CE')) : 'NONE';
            $f = ['fila' => $i + 1, 'full_name' => $nombre, 'phone_raw' => $cel, 'phone' => $phone, 'email' => $correo !== '' ? mb_strtolower($correo) : null,
                'doc_type' => $tipo, 'doc_number' => $doc, 'district' => $distrito ?: null, 'error' => null, 'existe' => null, 'motivo' => null,
                'repetida_en' => null, 'accion' => 'CREATE'];
            if ($nombre === '') {
                $f['error'] = 'Falta el nombre.';
            } elseif (! Celulares::valido($phone)) {
                $f['error'] = "Celular «{$cel}» no válido (RN-CLI-01).";
            } elseif ($e = Documentos::problema($tipo, $doc)) {
                $f['error'] = $e;
            }
            if (! $f['error']) {
                $ex = Clientes::buscarPorCelular($phone);
                $motivo = 'SAME_PHONE';
                if (! $ex && $doc && ($ex = Clientes::buscarPorDocumento($tipo, $doc))) {
                    $motivo = 'SAME_DOC';
                }
                if (! $ex && $f['email'] && ($ex = Customer::whereNull('merged_into_id')->whereRaw('lower(email) = ?', [$f['email']])->first())) {
                    $motivo = 'SAME_EMAIL';
                }
                if ($ex) {
                    [$f['existe'], $f['motivo'], $f['accion']] = [['id' => $ex->id, 'nombre' => $ex->nombre(), 'phone' => $ex->phone], $motivo, 'SKIP'];
                } elseif (isset($vistos[$phone])) {
                    [$f['repetida_en'], $f['accion']] = [$vistos[$phone], 'SKIP'];
                }
                $vistos[$phone] ??= $f['fila'];
            }
            $filas[] = $f;
        }

        return $filas;
    }

    /**
     * Confirma: $acciones = [fila => CREATE|SKIP]. Una fila con error o con el mismo documento de
     * otro cliente se omite siempre (RN-CLI-11).
     *
     * @return array{creados: int, omitidos: int, marcados: int}
     */
    public static function importar(string $texto, array $acciones, string $origen, User $quien): array
    {
        $r = ['creados' => 0, 'omitidos' => 0, 'marcados' => 0];
        DB::transaction(function () use ($texto, $acciones, $origen, $quien, &$r) {
            foreach (self::revisar($texto) as $f) {
                $accion = $acciones[$f['fila']] ?? $f['accion'];
                if ($f['error'] || $accion !== 'CREATE' || $f['motivo'] === 'SAME_DOC') {
                    $r['omitidos']++;

                    continue;
                }
                $out = Clientes::crear([
                    'full_name' => $f['full_name'], 'phone' => $f['phone'], 'email' => $f['email'], 'doc_type' => $f['doc_type'], 'doc_number' => $f['doc_number'],
                    'customer_type' => $f['doc_type'] === 'RUC' ? 'BUSINESS' : 'PERSON', 'source_channel' => 'IMPORT', 'marketing_opt_in' => false, 'seller_user_id' => null,
                ], $quien);
                $out['customer']->update(['consent_source' => 'IMPORT', 'notes' => $f['district'] ? "Importado ({$origen}) · distrito {$f['district']}" : "Importado ({$origen})"]);
                $r['creados']++;
                if ($out['duplicados']) {
                    $r['marcados']++;
                }
            }
        });

        return $r;
    }
}
