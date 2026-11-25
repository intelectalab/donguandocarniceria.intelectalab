<?php

use App\Modulos\Crm\Http\Controllers\CanalController;
use App\Modulos\Crm\Http\Controllers\ClienteController;
use App\Modulos\Crm\Http\Controllers\ControlController;
use App\Modulos\Crm\Http\Controllers\ConversacionController;
use App\Modulos\Crm\Http\Controllers\PlantillaController;
use App\Modulos\Crm\Http\Controllers\PosventaController;
use App\Modulos\Crm\Http\Controllers\SupervisionController;
use Illuminate\Support\Facades\Route;

// CRM · Bandeja omnicanal, leads y control de vendedoras: bandeja, conversación, pedido desde el chat, ficha 360, leads, supervisión, números, equipos, plantillas, costos, tareas y consentimientos.
Route::prefix('crm')->group(function () {
    // Cada límite por minuto lleva su propia cuenta (tercer parámetro): sin él, Laravel suma todas las rutas de la persona
    // y una vendedora activa en la bandeja (que se actualiza sola) podría chocar con el límite de otra acción.
    // Ven los números y equipos quien los administra y la supervisión (con la auditoría); los cambia solo crm.channel.manage (RN-CRM-01).
    $ver = 'permiso:crm.channel.manage|crm.conversation.view_all';
    $gestionar = 'permiso:crm.channel.manage';

    // CRM-07 Números y cuentas
    Route::get('/canales', [CanalController::class, 'index'])->middleware(['modulo:CRM', $ver, 'throttle:60,1,crmget-canales']);
    Route::get('/canales/{id}', [CanalController::class, 'show'])->middleware(['modulo:CRM', $ver])->whereUuid('id');
    Route::post('/canales', [CanalController::class, 'store'])->middleware(['modulo:CRM', $gestionar, 'throttle:20,1,crmpost-canales']);
    Route::put('/canales/{id}', [CanalController::class, 'update'])->middleware(['modulo:CRM', $gestionar, 'throttle:30,1,crmput-canales-id'])->whereUuid('id');
    Route::post('/canales/{id}/probar', [CanalController::class, 'probar'])->middleware(['modulo:CRM', $gestionar, 'throttle:20,1,crmpost-canales-id-probar'])->whereUuid('id');

    // CRM-08 Equipos y turnos
    Route::get('/equipos', [CanalController::class, 'equipos'])->middleware(['modulo:CRM', $ver, 'throttle:60,1,crmget-equipos']);
    Route::post('/canales/{id}/miembros', [CanalController::class, 'agregarMiembro'])->middleware(['modulo:CRM', $gestionar, 'throttle:30,1,crmpost-canales-id-miembros'])->whereUuid('id');
    Route::put('/canales/{id}/asignacion', [CanalController::class, 'asignacion'])->middleware(['modulo:CRM', $gestionar])->whereUuid('id');
    Route::put('/miembros/{id}', [CanalController::class, 'cambiarMiembro'])->middleware(['modulo:CRM', $gestionar, 'throttle:60,1,crmput-miembros-id'])->whereUuid('id');
    Route::put('/miembros/{id}/turnos', [CanalController::class, 'turnos'])->middleware(['modulo:CRM', $gestionar, 'throttle:60,1,crmput-miembros-id-turnos'])->whereUuid('id');

    // CRM-01 Bandeja y CRM-02 Conversación: la vendedora ve los números donde atiende; la supervisión, los de sus marcas (RN-CRM-03).
    $verChats = 'permiso:crm.conversation.view_own|crm.conversation.view_all';
    Route::get('/conversaciones', [ConversacionController::class, 'index'])->middleware(['modulo:CRM', $verChats, 'throttle:120,1,crmget-conversaciones']);
    Route::get('/conversaciones/{id}', [ConversacionController::class, 'show'])->middleware(['modulo:CRM', $verChats, 'throttle:240,1,crmget-conversaciones-id'])->whereUuid('id');
    Route::post('/conversaciones/{id}/mensajes', [ConversacionController::class, 'responder'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1,crmpost-conversaciones-id-mensajes'])->whereUuid('id');
    // RN-CRM-04: editar o borrar un mensaje no existe, tampoco por la API.
    Route::match(['put', 'patch', 'delete'], '/conversaciones/{id}/mensajes/{mensaje}', [ConversacionController::class, 'inmutable'])->middleware(['modulo:CRM', $verChats])->whereUuid('id');
    Route::post('/conversaciones/{id}/asignar', [ConversacionController::class, 'reasignar'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reassign', 'throttle:60,1,crmpost-conversaciones-id-asignar'])->whereUuid('id');
    Route::post('/conversaciones/{id}/cerrar', [ConversacionController::class, 'cerrar'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1,crmpost-conversaciones-id-cerrar'])->whereUuid('id');
    Route::post('/conversaciones/{id}/reabrir', [ConversacionController::class, 'reabrir'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1,crmpost-conversaciones-id-reabrir'])->whereUuid('id');
    Route::post('/conversaciones/{id}/notas', [ConversacionController::class, 'nota'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1,crmpost-conversaciones-id-notas'])->whereUuid('id');
    Route::put('/conversaciones/{id}/etiquetas', [ConversacionController::class, 'etiquetas'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1,crmput-conversaciones-id-etiquetas'])->whereUuid('id');
    // Solo fuera de producción (como el simulador de INT): mensajes de prueba del cliente.
    Route::post('/conversaciones/{id}/simular', [ConversacionController::class, 'simular'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1,crmpost-conversaciones-id-simular'])->whereUuid('id');
    Route::post('/simular', [ConversacionController::class, 'simularNuevo'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1,crmpost-simular']);

    // CRM-09 Plantillas: las crean el administrador y marketing; la supervisión las consulta (RN-CRM-07).
    $verPlantillas = 'permiso:crm.template.manage|crm.conversation.view_all|crm.template.send_marketing';
    Route::get('/plantillas', [PlantillaController::class, 'plantillas'])->middleware(['modulo:CRM', $verPlantillas, 'throttle:60,1,crmget-plantillas']);
    Route::get('/plantillas/{id}', [PlantillaController::class, 'plantilla'])->middleware(['modulo:CRM', $verPlantillas])->whereUuid('id');
    Route::post('/plantillas', [PlantillaController::class, 'guardarPlantilla'])->middleware(['modulo:CRM', 'permiso:crm.template.manage', 'throttle:30,1,crmpost-plantillas']);
    Route::put('/plantillas/{id}', [PlantillaController::class, 'guardarPlantilla'])->middleware(['modulo:CRM', 'permiso:crm.template.manage', 'throttle:30,1,crmput-plantillas-id'])->whereUuid('id');
    Route::post('/plantillas/{id}/revision', [PlantillaController::class, 'enviarARevision'])->middleware(['modulo:CRM', 'permiso:crm.template.manage', 'throttle:30,1,crmpost-plantillas-id-revision'])->whereUuid('id');
    Route::post('/plantillas/{id}/respuesta', [PlantillaController::class, 'respuestaDeMeta'])->middleware(['modulo:CRM', 'permiso:crm.template.manage', 'throttle:30,1,crmpost-plantillas-id-respuesta'])->whereUuid('id');
    // Desde la conversación: plantillas (RN-CRM-07, 08), consentimiento de marketing y producto del catálogo.
    Route::get('/conversaciones/{id}/plantillas', [PlantillaController::class, 'plantillasDeConversacion'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply'])->whereUuid('id');
    Route::post('/conversaciones/{id}/plantillas', [PlantillaController::class, 'enviarPlantilla'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1,crmpost-conversaciones-id-plantillas'])->whereUuid('id');
    Route::post('/conversaciones/{id}/consentimiento', [PlantillaController::class, 'consentimiento'])->middleware(['modulo:CRM', 'permiso:crm.consent.manage', 'throttle:30,1,crmpost-conversaciones-id-consentimiento'])->whereUuid('id');
    Route::get('/conversaciones/{id}/catalogo', [PlantillaController::class, 'catalogoDeConversacion'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply'])->whereUuid('id');
    Route::post('/conversaciones/{id}/producto', [PlantillaController::class, 'enviarProducto'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:60,1,crmpost-conversaciones-id-producto'])->whereUuid('id');

    // CRM-10 Respuestas rápidas (cada quien las suyas; las de la marca, la supervisión) y catálogo de WhatsApp.
    Route::get('/respuestas', [PlantillaController::class, 'respuestas'])->middleware(['modulo:CRM', $verChats, 'throttle:60,1,crmget-respuestas']);
    Route::post('/respuestas', [PlantillaController::class, 'guardarRespuesta'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:30,1,crmpost-respuestas']);
    Route::put('/respuestas/{id}', [PlantillaController::class, 'guardarRespuesta'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reply', 'throttle:30,1,crmput-respuestas-id'])->whereUuid('id');
    Route::get('/catalogo', [PlantillaController::class, 'catalogo'])->middleware(['modulo:CRM', $verChats, 'throttle:60,1,crmget-catalogo']);
    Route::post('/catalogo/sincronizar', [PlantillaController::class, 'sincronizar'])->middleware(['modulo:CRM', 'permiso:crm.channel.manage|crm.template.manage', 'throttle:10,1,crmpost-catalogo-sincronizar']);

    // CRM-11 Costo de WhatsApp (RN-CRM-13).
    Route::get('/costos', [PlantillaController::class, 'costos'])->middleware(['modulo:CRM', 'permiso:crm.cost.view', 'throttle:60,1,crmget-costos']);
    Route::get('/costos/simular', [PlantillaController::class, 'simular'])->middleware(['modulo:CRM', 'permiso:crm.cost.view', 'throttle:60,1,crmget-costos-simular']);

    // CRM-03 Crear pedido desde el chat (RN-CRM-09, 22): la vendedora asignada o la supervisora.
    Route::get('/conversaciones/{id}/pedido', [ClienteController::class, 'prepararPedido'])->middleware(['modulo:CRM', 'permiso:crm.conversation.create_order'])->whereUuid('id');
    Route::post('/conversaciones/{id}/pedido', [ClienteController::class, 'crearPedido'])->middleware(['modulo:CRM', 'modulo:PED', 'permiso:crm.conversation.create_order', 'throttle:20,1,crmpost-pedido'])->whereUuid('id');
    Route::post('/conversaciones/{id}/resumen', [ClienteController::class, 'enviarResumen'])->middleware(['modulo:CRM', 'permiso:crm.conversation.create_order', 'throttle:30,1,crmpost-resumen'])->whereUuid('id');

    // CRM-04 Ficha 360 del cliente.
    Route::get('/clientes', [ClienteController::class, 'clientes'])->middleware(['modulo:CRM', 'permiso:crm.customer.view_full', 'throttle:60,1,crmget-clientes']);
    Route::get('/clientes/{id}', [ClienteController::class, 'cliente'])->middleware(['modulo:CRM', 'permiso:crm.customer.view_full', 'throttle:120,1,crmget-cliente'])->whereUuid('id');

    // CRM-05 Leads: se ven con la bandeja; los gestiona crm.lead.manage.
    Route::get('/leads', [ClienteController::class, 'leads'])->middleware(['modulo:CRM', $verChats, 'throttle:60,1,crmget-leads']);
    Route::get('/leads/{id}', [ClienteController::class, 'lead'])->middleware(['modulo:CRM', $verChats])->whereUuid('id');
    Route::post('/leads', [ClienteController::class, 'crearLead'])->middleware(['modulo:CRM', 'permiso:crm.lead.manage', 'throttle:30,1,crmpost-leads']);
    Route::post('/leads/{id}/estado', [ClienteController::class, 'estadoLead'])->middleware(['modulo:CRM', 'permiso:crm.lead.manage', 'throttle:60,1,crmpost-leads-estado'])->whereUuid('id');

    // CRM-06 Supervisión en vivo: la supervisión, la gerencia y la auditoría (RN-CRM-02, 03 y 14). Reasignar o tomar usa la ruta de la conversación.
    $verSupervision = 'permiso:crm.conversation.view_all';
    Route::get('/supervision', [SupervisionController::class, 'panel'])->middleware(['modulo:CRM', $verSupervision, 'throttle:120,1,crmget-supervision']);
    Route::get('/supervision/vendedoras', [SupervisionController::class, 'vendedoras'])->middleware(['modulo:CRM', $verSupervision, 'throttle:120,1,crmget-supervision-vendedoras']);
    Route::get('/supervision/{tipo}', [SupervisionController::class, 'chats'])->middleware(['modulo:CRM', $verSupervision, 'throttle:120,1,crmget-supervision-chats'])->whereIn('tipo', ['cola', 'sin-responder']);
    Route::post('/vendedoras/{id}/estado', [SupervisionController::class, 'estadoVendedora'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reassign|crm.channel.manage', 'throttle:60,1,crmpost-vendedoras-estado'])->whereUuid('id');

    // CRM-17 Mis tareas: la vendedora las suyas; la supervisión también las del equipo.
    Route::get('/tareas', [SupervisionController::class, 'tareas'])->middleware(['modulo:CRM', $verChats, 'throttle:120,1,crmget-tareas']);
    Route::post('/tareas/{id}/hecha', [SupervisionController::class, 'completarTarea'])->middleware(['modulo:CRM', $verChats, 'throttle:60,1,crmpost-tareas-hecha'])->whereUuid('id');

    // CRM-18 Consentimientos y avisos (Ley 29733): los registra crm.consent.manage, siempre con evidencia; solo se agregan.
    $verConsent = 'permiso:crm.consent.manage|crm.conversation.view_all|crm.customer.view_full';
    Route::get('/consentimientos', [SupervisionController::class, 'consentimientos'])->middleware(['modulo:CRM', $verConsent, 'throttle:60,1,crmget-consentimientos']);
    Route::get('/consentimientos/clientes', [SupervisionController::class, 'clientesConsentimiento'])->middleware(['modulo:CRM', 'permiso:crm.consent.manage', 'throttle:60,1,crmget-consentimientos-clientes']);
    Route::post('/consentimientos', [SupervisionController::class, 'registrarConsentimiento'])->middleware(['modulo:CRM', 'permiso:crm.consent.manage', 'throttle:30,1,crmpost-consentimientos']);
    Route::get('/consentimientos/avisos', [SupervisionController::class, 'avisos'])->middleware(['modulo:CRM', $verConsent, 'throttle:60,1,crmget-consentimientos-avisos']);

    // CRM-12 Alertas de control: las revisa la supervisora o la gerencia; la vendedora no ve las suyas (RN-CRM-17).
    Route::get('/alertas', [ControlController::class, 'alertas'])->middleware(['modulo:CRM', 'permiso:crm.alert.review', 'throttle:60,1,crmget-alertas']);
    Route::get('/alertas/{id}', [ControlController::class, 'alerta'])->middleware(['modulo:CRM', 'permiso:crm.alert.review', 'throttle:120,1,crmget-alerta'])->whereUuid('id');
    Route::post('/alertas/{id}/revision', [ControlController::class, 'revisarAlerta'])->middleware(['modulo:CRM', 'permiso:crm.alert.review', 'throttle:60,1,crmpost-alertas-revision'])->whereUuid('id');

    // CRM-13 Reglas e identificadores oficiales: los cambia crm.alert_rule.manage; la supervisión los consulta y prueba textos.
    $verReglas = 'permiso:crm.alert_rule.manage|crm.alert.review';
    Route::get('/reglas', [ControlController::class, 'reglas'])->middleware(['modulo:CRM', $verReglas, 'throttle:60,1,crmget-reglas']);
    Route::post('/reglas', [ControlController::class, 'guardarRegla'])->middleware(['modulo:CRM', 'permiso:crm.alert_rule.manage', 'throttle:30,1,crmpost-reglas']);
    Route::put('/reglas/{id}', [ControlController::class, 'guardarRegla'])->middleware(['modulo:CRM', 'permiso:crm.alert_rule.manage', 'throttle:30,1,crmput-reglas'])->whereUuid('id');
    Route::post('/reglas/probar', [ControlController::class, 'probar'])->middleware(['modulo:CRM', $verReglas, 'throttle:30,1,crmpost-reglas-probar']);
    Route::get('/identificadores', [ControlController::class, 'identificadores'])->middleware(['modulo:CRM', $verReglas, 'throttle:60,1,crmget-identificadores']);
    Route::post('/identificadores', [ControlController::class, 'guardarIdentificador'])->middleware(['modulo:CRM', 'permiso:crm.alert_rule.manage', 'throttle:30,1,crmpost-identificadores']);
    Route::put('/identificadores/{id}', [ControlController::class, 'guardarIdentificador'])->middleware(['modulo:CRM', 'permiso:crm.alert_rule.manage', 'throttle:30,1,crmput-identificadores'])->whereUuid('id');

    // CRM-14 Revisión por muestreo (RN-CRM-18): la hace la supervisora; la gerencia la consulta.
    Route::get('/muestreo', [ControlController::class, 'muestreo'])->middleware(['modulo:CRM', 'permiso:crm.review.perform|crm.alert.review', 'throttle:60,1,crmget-muestreo']);
    Route::post('/muestreo/{id}', [ControlController::class, 'revisarMuestra'])->middleware(['modulo:CRM', 'permiso:crm.review.perform', 'throttle:60,1,crmpost-muestreo'])->whereUuid('id');

    // CRM-15 Recompra (RN-CRM-19): se ve con la bandeja; recalcula la supervisión; la plantilla exige consentimiento de marketing.
    Route::get('/recompra', [PosventaController::class, 'recompra'])->middleware(['modulo:CRM', $verChats, 'throttle:60,1,crmget-recompra']);
    Route::post('/recompra/recalcular', [PosventaController::class, 'recalcular'])->middleware(['modulo:CRM', 'permiso:crm.conversation.reassign|crm.channel.manage', 'throttle:5,1,crmpost-recompra-recalcular']);
    Route::post('/recompra/{id}/plantilla', [PosventaController::class, 'plantillaRecompra'])->middleware(['modulo:CRM', 'permiso:crm.template.send_marketing', 'throttle:30,1,crmpost-recompra-plantilla'])->whereUuid('id');

    // CRM-16 Encuesta posentrega (RN-CRM-20).
    Route::get('/encuestas', [PosventaController::class, 'encuestas'])->middleware(['modulo:CRM', 'permiso:crm.survey.view', 'throttle:60,1,crmget-encuestas']);
    Route::post('/encuestas/{id}/respuesta', [PosventaController::class, 'responderEncuesta'])->middleware(['modulo:CRM', 'permiso:crm.survey.view', 'throttle:30,1,crmpost-encuestas-respuesta'])->whereUuid('id');

    // El estado propio de quien atiende chats (para el reparto, RN-CRM-02).
    Route::get('/mi-estado', [CanalController::class, 'miEstado'])->middleware(['modulo:CRM', 'permiso:crm.conversation.view_own|crm.conversation.view_all']);
    Route::post('/mi-estado', [CanalController::class, 'marcarEstado'])->middleware(['modulo:CRM', 'permiso:crm.conversation.view_own', 'throttle:30,1,crmpost-mi-estado']);
});
