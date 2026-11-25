<?php

use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\Auth\PasswordResetController;
use App\Http\Controllers\MeController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\PublicoController;
use App\Http\Controllers\TenantController;
use App\Modulos\Aud\Http\Controllers\AuditoriaController;
use App\Modulos\Cli\Http\Controllers\EnlaceController;
use App\Modulos\Int\Http\Controllers\AvisoArchivoController;
use App\Modulos\Int\Http\Controllers\WebhookController;
use App\Modulos\Onb\Http\Controllers\RegistroController;
use App\Modulos\Ops\Http\Controllers\AccesoConsolaController;
use App\Modulos\Ops\Http\Controllers\BandejaController;
use App\Modulos\Ops\Http\Controllers\ConsolaController;
use App\Modulos\Ops\Http\Controllers\EmpresaController;
use App\Modulos\Ops\Http\Controllers\MetricaController;
use App\Modulos\Ops\Http\Controllers\OperacionController;
use App\Modulos\Ops\Http\Controllers\PlanController;
use App\Modulos\Ops\Http\Controllers\PlataformaController;
use App\Modulos\Sus\Http\Controllers\CobroController;
use App\Modulos\Sus\Http\Controllers\ComplementoController;
use App\Modulos\Sus\Http\Controllers\PasarelaController;
use Illuminate\Support\Facades\Route;

/*
| API v1. Toda ruta de empresa pasa por:
|   tenant      → resuelve la empresa (por el correo al ingresar, luego por el token) y fija app.tenant_id (RLS)
|   auth:sanctum → token de esa empresa
|   usuario     → fija app.user_id (bitácora) y corta usuarios inactivos
| Cada módulo agrega sus rutas en routes/modulos/<codigo>.php (se cargan solas, abajo; ver _ejemplo.php)
| y protege cada una con 'modulo:PED,C' o 'permiso:ped.discount.approve'.
*/

// Página pública de GestionCarnica (landing): sin empresa ni sesión. Solo el catálogo de planes y pedidos de demo,
// con límite por IP (los pedidos, además, con trampa contra robots y solo inserción en la base).
Route::prefix('v1/publico')->group(function () {
    Route::get('/planes', [PublicoController::class, 'planes'])->middleware('throttle:60,1');
    Route::post('/demo', [PublicoController::class, 'demo'])->middleware('throttle:5,1');
    // ONB-01: registro de una empresa desde la página (código al correo y alta en prueba al verificarlo).
    Route::post('/registro', [RegistroController::class, 'registrar'])->middleware('throttle:5,1');
    Route::post('/registro/verificar', [RegistroController::class, 'verificar'])->middleware('throttle:10,1');
    // CLI-07: el cliente abre su enlace de ubicación (de un solo uso) y marca su pin. La empresa sale del enlace.
    Route::get('/ubicacion/{token}', [EnlaceController::class, 'publico'])->middleware('throttle:30,1')->where('token', '[A-Za-z0-9]{32}');
    Route::post('/ubicacion/{token}', [EnlaceController::class, 'completar'])->middleware('throttle:10,1')->where('token', '[A-Za-z0-9]{32}');
    // SUS · aviso firmado de la pasarela de cobro (RN-SUS-20): sin firma válida no tiene efecto.
    Route::post('/pasarela/{gateway}', PasarelaController::class)->middleware('throttle:120,1')->where('gateway', '[a-z]{3,12}');
});

// API · la API pública v1 para los sistemas de los clientes (/api/publica/v1), con su clave de API y sin sesión.
require __DIR__.'/publica.php';

// INT-04 · webhooks de entrada de los proveedores: públicos, sin sesión. La empresa sale del token de la URL y sin firma
// válida no se procesan (RN-INT-04). Responden 200 a todo evento firmado, también a uno repetido (RN-INT-05).
Route::post('/hooks/{token}', [WebhookController::class, 'recibir'])->middleware('throttle:120,1')->where('token', '[A-Za-z0-9]{16,80}');

// AUD-05 · descarga de una exportación con su enlace firmado (vence a las 24 horas, RN-AUD-05): sin sesión; la firma
// lleva la exportación, la empresa, quién la pidió y el vencimiento.
Route::get('/v1/exportaciones/{id}', [AuditoriaController::class, 'descargarExportacion'])->name('aud.exportacion')
    ->middleware(['signed:relative', 'throttle:30,1'])->whereUuid('id');

// INT-11 · descarga de un archivo adjunto con su enlace firmado y temporal (RN-INT-17): sin sesión; la firma lleva el
// archivo, la empresa y el vencimiento. Se firma la ruta relativa para que valga detrás del proxy.
Route::get('/v1/archivos/{id}', [AvisoArchivoController::class, 'descargar'])->name('int.archivo')
    ->middleware(['signed:relative', 'throttle:60,1'])->whereUuid('id');

// OPS · Consola de Intelectalab: sin empresa (no pasa por «tenant» ni por Sanctum). Usuarios de plataforma con
// su propio ingreso, segundo factor obligatorio y sesión «gcc_…» (middleware «consola»). Ver docs/cambios.
Route::prefix('v1/consola')->group(function () {
    Route::post('/ingreso', [ConsolaController::class, 'ingresar'])->middleware('throttle:10,1');
    Route::post('/activar/preparar', [ConsolaController::class, 'prepararActivacion'])->middleware('throttle:10,1');
    Route::post('/activar', [ConsolaController::class, 'activar'])->middleware('throttle:10,1');

    Route::middleware(['consola', 'throttle:120,1'])->group(function () {
        Route::get('/yo', [ConsolaController::class, 'yo']);
        Route::post('/salir', [ConsolaController::class, 'salir']);
        // OPS-12 Usuarios de plataforma (solo PLATFORM_ADMIN cambia; lo valida el servicio, RN-OPS-10)
        Route::get('/usuarios', [ConsolaController::class, 'usuarios']);
        Route::post('/usuarios', [ConsolaController::class, 'crearUsuario'])->middleware('throttle:20,1');
        Route::put('/usuarios/{id}', [ConsolaController::class, 'editarUsuario'])->whereUuid('id');
        Route::post('/usuarios/{id}/estado', [ConsolaController::class, 'estadoUsuario'])->whereUuid('id');
        Route::post('/usuarios/{id}/reiniciar-2fa', [ConsolaController::class, 'reiniciarSegundoFactor'])->whereUuid('id');
        Route::post('/usuarios/{id}/reenviar', [ConsolaController::class, 'reenviarInvitacion'])->middleware('throttle:10,1')->whereUuid('id');
        // OPS-02 Empresas, OPS-03 Ficha y alta de empresa (solo PLATFORM_ADMIN da de alta; lo valida el servicio)
        Route::get('/empresas', [EmpresaController::class, 'index']);
        Route::post('/empresas/salud', [EmpresaController::class, 'recalcularSalud'])->middleware('throttle:5,1');
        Route::get('/empresas/opciones', [EmpresaController::class, 'opciones']);
        Route::get('/empresas/{id}', [EmpresaController::class, 'show'])->whereUuid('id');
        Route::post('/empresas', [EmpresaController::class, 'store'])->middleware('throttle:10,1');
        // SUS-09 Catálogo de planes, SUS-11 Suscripciones y OPS-04 Suspender o reactivar (roles: lo valida el servicio)
        Route::get('/planes', [PlanController::class, 'catalogo']);
        Route::post('/planes/borradores', [PlanController::class, 'nuevoBorrador']);
        Route::put('/planes/borradores/{id}', [PlanController::class, 'editarBorrador'])->whereUuid('id');
        Route::delete('/planes/borradores/{id}', [PlanController::class, 'borrarBorrador'])->whereUuid('id');
        Route::post('/planes/borradores/{id}/publicar', [PlanController::class, 'publicar'])->whereUuid('id');
        Route::post('/planes/{codigo}/retirar', [PlanController::class, 'retirar'])->where('codigo', '[A-Z][A-Z0-9_]{1,19}');
        Route::get('/suscripciones', [PlanController::class, 'suscripciones']);
        Route::get('/suscripciones/{id}', [PlanController::class, 'suscripcion'])->whereUuid('id');
        Route::post('/suscripciones/{id}/estado', [PlanController::class, 'estado'])->whereUuid('id');
        Route::post('/suscripciones/{id}/extender', [PlanController::class, 'extender'])->whereUuid('id');
        Route::post('/suscripciones/{id}/descuento', [PlanController::class, 'descuento'])->whereUuid('id');
        // OPS-13 Bitácora, OPS-16 Parámetros de plataforma y catálogos globales (RN-MAE-11)
        Route::get('/bitacora', [PlataformaController::class, 'bitacora']);
        Route::get('/parametros', [PlataformaController::class, 'parametros']);
        Route::put('/parametros/{key}', [PlataformaController::class, 'cambiarParametro'])->where('key', '[a-z0-9_]{3,60}');
        Route::post('/catalogos/revisar', [PlataformaController::class, 'revisarCatalogo'])->middleware('throttle:20,1');
        Route::post('/catalogos/importar', [PlataformaController::class, 'importarCatalogo'])->middleware('throttle:10,1');
        // ONB-16 Registros y altas, y pedidos de demo de la página
        Route::get('/registros', [RegistroController::class, 'lista']);
        Route::post('/registros/{id}/rechazar', [RegistroController::class, 'rechazar'])->whereUuid('id');
        Route::get('/demos', [RegistroController::class, 'demos']);
        Route::post('/demos/{id}/atender', [RegistroController::class, 'atenderDemo'])->whereUuid('id');
        // OPS-09 Bandeja de tickets de todas las empresas (responder y asignar: rol de soporte; lo valida el servicio)
        Route::get('/tickets', [BandejaController::class, 'index']);
        Route::get('/tickets/{id}', [BandejaController::class, 'show'])->whereUuid('id');
        Route::post('/tickets/{id}/responder', [BandejaController::class, 'responder'])->whereUuid('id');
        Route::post('/tickets/{id}/asignar', [BandejaController::class, 'asignar'])->whereUuid('id');
        // OPS-05 y OPS-06 Accesos de soporte: pedir (según el rol y el nivel), cancelar, terminar y entrar (solo la persona del acceso)
        Route::get('/accesos', [AccesoConsolaController::class, 'index']);
        Route::get('/accesos/opciones', [AccesoConsolaController::class, 'opciones']);
        Route::get('/accesos/{id}', [AccesoConsolaController::class, 'show'])->whereUuid('id');
        Route::post('/accesos', [AccesoConsolaController::class, 'store'])->middleware('throttle:20,1');
        Route::post('/accesos/{id}/cancelar', [AccesoConsolaController::class, 'cancelar'])->whereUuid('id');
        Route::post('/accesos/{id}/terminar', [AccesoConsolaController::class, 'terminar'])->whereUuid('id');
        Route::post('/accesos/{id}/entrar', [AccesoConsolaController::class, 'entrar'])->middleware('throttle:10,1')->whereUuid('id');
        // OPS-07 Salud, OPS-08 Incidentes y OPS-11 Anuncios (registrar y gestionar: ingeniería y administración; lo valida el servicio)
        Route::get('/salud', [OperacionController::class, 'salud']);
        Route::get('/salud/{codigo}', [OperacionController::class, 'componente'])->where('codigo', '[A-Z]{2,20}');
        Route::post('/salud/{codigo}/lecturas', [OperacionController::class, 'registrarLectura'])->where('codigo', '[A-Z]{2,20}');
        Route::get('/incidentes', [OperacionController::class, 'incidentes']);
        Route::get('/incidentes/para-vincular', [OperacionController::class, 'incidentesParaVincular']);
        Route::get('/incidentes/{id}', [OperacionController::class, 'incidente'])->whereUuid('id');
        Route::post('/incidentes', [OperacionController::class, 'crearIncidente']);
        Route::put('/incidentes/{id}', [OperacionController::class, 'editarIncidente'])->whereUuid('id');
        Route::post('/incidentes/{id}/actualizaciones', [OperacionController::class, 'actualizarIncidente'])->whereUuid('id');
        Route::post('/incidentes/{id}/resolver', [OperacionController::class, 'resolverIncidente'])->whereUuid('id');
        Route::put('/incidentes/{id}/postmortem', [OperacionController::class, 'postmortem'])->whereUuid('id');
        Route::post('/tickets/{ticket}/incidente', [OperacionController::class, 'vincularTicket'])->whereUuid('ticket');
        Route::get('/anuncios', [OperacionController::class, 'anuncios']);
        Route::post('/anuncios', [OperacionController::class, 'guardarAnuncio']);
        Route::put('/anuncios/{id}', [OperacionController::class, 'guardarAnuncio'])->whereUuid('id');
        Route::post('/anuncios/{id}/publicar', [OperacionController::class, 'publicarAnuncio'])->whereUuid('id');
        Route::post('/anuncios/{id}/cancelar', [OperacionController::class, 'cancelarAnuncio'])->whereUuid('id');
        // SUS-12 Facturación, SUS-13 Cobros y SUS-14 Mora (cambiar: cobranza y administración; lo valida el servicio)
        Route::get('/facturacion', [CobroController::class, 'facturacion']);
        Route::get('/facturacion/{id}', [CobroController::class, 'comprobante'])->whereUuid('id');
        Route::post('/facturacion/corridas', [CobroController::class, 'corrida'])->middleware('throttle:10,1');
        Route::get('/facturacion/vista-previa', [CobroController::class, 'vistaPrevia']);
        Route::post('/facturacion/{id}/emitir', [CobroController::class, 'emitir'])->whereUuid('id');
        Route::delete('/facturacion/{id}', [CobroController::class, 'borrar'])->whereUuid('id');
        Route::post('/facturacion/{id}/nota-credito', [CobroController::class, 'notaCredito'])->whereUuid('id');
        Route::post('/facturacion/{id}/cobrar', [CobroController::class, 'cobrar'])->middleware('throttle:20,1')->whereUuid('id');
        Route::get('/cobros', [CobroController::class, 'cobros']);
        Route::post('/cobros/conciliar', [CobroController::class, 'conciliar']);
        Route::get('/cobros/eventos', [CobroController::class, 'eventos']);
        Route::get('/cobros/abonos', [CobroController::class, 'abonos']);
        Route::get('/mora', [CobroController::class, 'mora']);
        // OPS-10 Métricas del negocio (congelar un mes: administración y cobranza; lo valida el servicio)
        Route::get('/metricas', [MetricaController::class, 'index']);
        Route::post('/metricas/congelar', [MetricaController::class, 'congelar'])->middleware('throttle:10,1');
        // SUS-10 Complementos (cambiar: administración y cobranza; lo valida el servicio)
        Route::get('/complementos', [ComplementoController::class, 'index']);
        Route::post('/complementos', [ComplementoController::class, 'guardar']);
        Route::put('/complementos/{code}', [ComplementoController::class, 'guardar'])->where('code', '[A-Z0-9_]{2,20}');
        Route::post('/complementos/{code}/publicar', [ComplementoController::class, 'publicar'])->where('code', '[A-Z0-9_]{2,20}');
        Route::post('/complementos/{code}/retirar', [ComplementoController::class, 'retirar'])->where('code', '[A-Z0-9_]{2,20}');
        Route::post('/mora/proceso', [CobroController::class, 'procesar'])->middleware('throttle:5,1');
        Route::post('/mora/{sub}/recordatorio', [CobroController::class, 'recordatorio'])->middleware('throttle:20,1')->whereUuid('sub');
        Route::post('/mora/{sub}/prorroga', [CobroController::class, 'prorroga'])->whereUuid('sub');
        Route::post('/mora/{sub}/cobrar', [CobroController::class, 'cobrarAhora'])->middleware('throttle:20,1')->whereUuid('sub');
    });
});

Route::prefix('v1')->middleware('tenant')->group(function () {
    Route::get('/tenant', TenantController::class);
    Route::get('/tenant/logo', [TenantController::class, 'logo'])->middleware('throttle:60,1');
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
    // SEG-02 y SEG-03: el paso del segundo factor, con el desafío que entregó el ingreso (sin sesión todavía).
    Route::post('/auth/mfa/verificar', [AuthController::class, 'verificarSegundoFactor'])->middleware('throttle:10,1');
    Route::post('/auth/mfa/preparar', [AuthController::class, 'prepararSegundoFactor'])->middleware('throttle:10,1');
    Route::post('/auth/mfa/activar', [AuthController::class, 'activarSegundoFactor'])->middleware('throttle:10,1');
    Route::post('/auth/forgot', [PasswordResetController::class, 'forgot'])->middleware('throttle:5,1');
    Route::post('/auth/reset', [PasswordResetController::class, 'reset'])->middleware('throttle:10,1');
    Route::get('/auth/password-rule', [ProfileController::class, 'passwordRule']);

    // suscripcion: en solo lectura o cancelada, la empresa no registra nada (RN-SUS-07).
    // soporte: la sesión del soporte de GestionCarnica, dentro de su acceso aprobado (RN-OPS-04).
    Route::middleware(['auth:sanctum', 'usuario', 'soporte', 'suscripcion'])->group(function () {
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/me', MeController::class);
        Route::post('/me/password', [ProfileController::class, 'password'])->middleware('throttle:10,1');

        Route::get('/me/notifications/summary', [NotificationController::class, 'summary']);
        Route::get('/me/notifications', [NotificationController::class, 'index']);
        Route::post('/me/notifications/read-all', [NotificationController::class, 'readAll']);
        Route::post('/me/notifications/{id}/read', [NotificationController::class, 'read'])->whereUuid('id');

        foreach (glob(__DIR__.'/modulos/*.php') as $archivo) {
            if (! str_starts_with(basename($archivo), '_')) {   // _ejemplo.php no se carga
                require $archivo;
            }
        }
    });
});
