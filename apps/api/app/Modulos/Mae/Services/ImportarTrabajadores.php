<?php

namespace App\Modulos\Mae\Services;

use App\Models\User;
use App\Modulos\Cli\Services\Celulares;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * MAE-10: carga de trabajadores desde un CSV pegado o subido, con validación fila por fila y vista previa.
 * Columnas: tipo_doc; numero; nombre; cargo; local; centro_costo; ingreso; celular; correo. Acepta «;» o «,».
 * Solo se graban las filas válidas; cada una con las mismas reglas del alta (Trabajadores::crear).
 */
final class ImportarTrabajadores
{
    public const MAX_FILAS = 500;

    /** Columnas del CSV y de la plantilla Excel (App\Support\Importar). */
    public const COLUMNAS = [
        ['clave' => 'tipo_doc', 'titulo' => 'Tipo de documento', 'ancho' => 20, 'otros' => ['tipo']],
        ['clave' => 'numero', 'titulo' => 'Número de documento', 'ancho' => 23, 'otros' => ['documento', 'nro_documento', 'dni']],
        ['clave' => 'nombre', 'titulo' => 'Nombre completo', 'ancho' => 32, 'otros' => ['nombres', 'trabajador']],
        ['clave' => 'cargo', 'titulo' => 'Cargo', 'ancho' => 24, 'otros' => ['puesto']],
        ['clave' => 'local', 'titulo' => 'Local', 'ancho' => 10, 'otros' => ['codigo_local']],
        ['clave' => 'centro_costo', 'titulo' => 'Centro de costo', 'ancho' => 16, 'otros' => ['centro_de_costo', 'cc']],
        ['clave' => 'ingreso', 'titulo' => 'Fecha de ingreso', 'ancho' => 16, 'fecha' => true, 'otros' => ['fecha_ingreso']],
        ['clave' => 'celular', 'titulo' => 'Celular', 'ancho' => 16, 'otros' => ['telefono']],
        ['clave' => 'correo', 'titulo' => 'Correo', 'ancho' => 28, 'otros' => ['email']],
    ];

    /** Columnas con sus listas desplegables de la empresa (tipos de documento, locales y centros de costo activos). */
    public static function columnasConListas(): array
    {
        $listas = [
            'tipo_doc' => ['DNI', 'CE', 'PASAPORTE'],
            'local' => DB::table('establishments')->where('status', 'ACTIVE')->orderBy('code')->pluck('code')->all(),
            'centro_costo' => DB::table('cost_centers')->where('status', 'ACTIVE')->orderBy('code')->pluck('code')->all(),
        ];

        return array_map(fn ($c) => isset($listas[$c['clave']]) ? $c + ['lista' => $listas[$c['clave']]] : $c, self::COLUMNAS);
    }

    /** @return array<int, array{n: int, datos: array, errores: string[]}> */
    public static function revisar(string $texto): array
    {
        $lineas = array_values(array_filter(preg_split('/\r\n|\r|\n/', $texto), fn ($l) => trim($l) !== ''));
        if ($lineas && preg_match('/^\s*"?tipo_doc/i', $lineas[0])) {
            array_shift($lineas);
        }
        if (count($lineas) > self::MAX_FILAS) {
            RuleError::fail('RN-MAE-01', 'El archivo tiene más de '.self::MAX_FILAS.' filas: divídelo en partes.');
        }
        $locales = DB::table('establishments')->pluck('id', 'code');
        $centros = DB::table('cost_centers')->where('status', 'ACTIVE')->pluck('id', 'code');
        $sep = $lineas && str_contains($lineas[0], ';') ? ';' : ',';
        $vistos = [];
        $filas = [];
        foreach ($lineas as $k => $linea) {
            $c = array_map(fn ($s) => trim($s, " \t\"'"), explode($sep, $linea));
            [$tipo, $numero, $nombre, $cargo, $local, $cc, $ingreso, $celular, $correo] = array_pad($c, 9, '');
            $tipo = strtoupper($tipo) === 'PASAPORTE' ? 'PASSPORT' : strtoupper($tipo);
            $errores = [];
            try {
                $numero = Trabajadores::documento($tipo, $numero);
            } catch (RuleError $e) {
                $errores[] = $e->getMessage();
            }
            if (! $errores && DB::table('employees')->where(['doc_type' => $tipo, 'doc_number' => $numero])->exists()) {
                $errores[] = "Ya existe un trabajador con {$tipo} {$numero}.";
            }
            if (isset($vistos[$tipo.$numero])) {
                $errores[] = "El documento se repite en el archivo (fila {$vistos[$tipo.$numero]}).";
            }
            $vistos[$tipo.$numero] ??= $k + 1;
            if ($nombre === '') {
                $errores[] = 'Falta el nombre.';
            }
            if ($cargo === '') {
                $errores[] = 'Falta el cargo.';
            }
            if (! isset($locales[$local])) {
                $errores[] = "El local «{$local}» no existe (usa su código, por ejemplo L1).";
            }
            if (! isset($centros[$cc])) {
                $errores[] = "El centro de costo «{$cc}» no existe o está inactivo.";
            }
            $fecha = preg_match('#^(\d{2})/(\d{2})/(\d{4})$#', $ingreso, $m) ? "{$m[3]}-{$m[2]}-{$m[1]}" : $ingreso;
            if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha) || ! checkdate((int) substr($fecha, 5, 2), (int) substr($fecha, 8, 2), (int) substr($fecha, 0, 4))) {
                $errores[] = 'Fecha de ingreso no válida (AAAA-MM-DD o DD/MM/AAAA).';
            }
            $e164 = Celulares::normalizar($celular);
            if ($e164 && ! Celulares::valido($e164)) {
                $errores[] = 'El celular no es válido (por ejemplo +51987654321).';
            }
            if ($correo !== '' && ! filter_var($correo, FILTER_VALIDATE_EMAIL)) {
                $errores[] = 'El correo no es válido.';
            }
            $filas[] = ['n' => $k + 1, 'errores' => $errores, 'datos' => [
                'doc_type' => $tipo, 'doc_number' => $numero, 'full_name' => mb_substr($nombre, 0, 120), 'position' => mb_substr($cargo, 0, 80),
                'establishment_id' => $locales[$local] ?? null, 'local' => $local, 'cost_center_id' => $centros[$cc] ?? null, 'centro_costo' => $cc,
                'hire_date' => $fecha, 'phone' => $e164, 'email' => $correo === '' ? null : mb_substr($correo, 0, 80),
            ]];
        }

        return $filas;
    }

    /** @return array{grabados: int, omitidos: int} */
    public static function importar(string $texto, User $quien): array
    {
        $filas = self::revisar($texto);
        $validas = array_filter($filas, fn ($f) => ! $f['errores']);
        if (! $validas) {
            RuleError::fail('RN-MAE-01', 'No hay filas válidas para grabar: revisa los errores de la vista previa.');
        }
        DB::transaction(function () use ($validas, $quien) {
            foreach ($validas as $f) {
                Trabajadores::crear($f['datos'], $quien);
            }
        });

        return ['grabados' => count($validas), 'omitidos' => count($filas) - count($validas)];
    }
}
