<?php

namespace App\Modulos\Tab\Calculadores;

/**
 * Calculadores del motor de TAB, por código de indicador (RN-TAB-08). kpi_definitions.calculator guarda el nombre
 * (kpi_<mod>_nn); aquí está la función que lo calcula. Un módulo nuevo agrega los suyos con Registro::agregar() desde su
 * proveedor; los indicadores sin calculador se ven en el catálogo como «sin cálculo» y no se congelan.
 */
final class Registro
{
    /** @var array<string, callable(Periodo): array>|null */
    private static ?array $calc = null;

    private static array $extra = [];

    /** @return array<string, callable(Periodo): array> */
    public static function todos(): array
    {
        return self::$calc ??= array_merge(Ventas::todos(), Reparto::todos(), Almacen::todos(), Finanzas::todos(), Tablero::todos(), self::$extra);
    }

    public static function de(string $codigo): ?callable
    {
        return self::todos()[$codigo] ?? null;
    }

    public static function tiene(string $codigo): bool
    {
        return isset(self::todos()[$codigo]);
    }

    /** Para que otro módulo registre su calculador: Registro::agregar('KPI-CRM-02', fn (Periodo $p) => [...]). */
    public static function agregar(string $codigo, callable $f): void
    {
        self::$extra[$codigo] = $f;
        self::$calc = null;
    }
}
