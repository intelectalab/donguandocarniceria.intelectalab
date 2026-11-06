<?php

use App\Support\RuleError;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'tenant' => \App\Http\Middleware\ResolveTenant::class,
            'usuario' => \App\Http\Middleware\SetUserContext::class,
            'modulo' => \App\Http\Middleware\CheckModuleAccess::class,
            'permiso' => \App\Http\Middleware\CheckPermission::class,
        ]);
        // Laravel ordena la autenticación antes que el resto: la empresa debe ir antes, porque el
        // token y el usuario solo se encuentran con app.tenant_id fijado (RLS).
        $middleware->prependToPriorityList(
            \Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests::class,
            \App\Http\Middleware\ResolveTenant::class,
        );
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => $request->is('api/*') || $request->expectsJson());

        // Una regla de negocio que bloquea: RuleError::fail('RN-PED-01', 'Faltan datos: …').
        $exceptions->render(fn (RuleError $e) => response()->json(['message' => $e->getMessage(), 'code' => $e->rule], 422));

        // Un id que no tiene forma de uuid no existe.
        $exceptions->render(function (QueryException $e, Request $request) {
            if ($e->getCode() === '22P02' && $request->is('api/*')) {
                return response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404);
            }
            // RLS rechazó la fila: se intentó escribir datos de otra empresa.
            if ($e->getCode() === '42501' && $request->is('api/*')) {
                return response()->json(['message' => 'No puedes modificar datos de otra empresa.', 'code' => 'FORBIDDEN_TENANT'], 403);
            }
        });

        // Dos envíos a la vez del mismo registro: la base deja pasar uno.
        $exceptions->render(fn (UniqueConstraintViolationException $e, Request $request) => $request->is('api/*')
            ? response()->json(['message' => 'Este registro ya existe. Actualiza la página.', 'code' => 'DUPLICATE_RESOURCE'], 409)
            : null);
    })->create();
