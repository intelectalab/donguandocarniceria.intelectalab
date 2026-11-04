# DELX · ampliación de Delivery (v1.1)
Pantallas DEL-17 a DEL-22 (registradas dentro del módulo DEL desde `src/modules/DELX.js`).
- DEL-17 App: gastos de la ruta (combustible, alimentación, peajes, otros). Los pagados del efectivo de ruta bajan el efectivo a entregar (DEL-06 y CAJ-07).
- DEL-18 Ticket de entrega: pedido vs pesado, diferencia en soles, total y a cobrar.
- DEL-19 Calidad de direcciones: puntaje, confirmación, zona sin señal de llamada.
- DEL-20 Apoyo y derivaciones: riesgo de tiempo, pedidos de apoyo, derivación a motorizado externo con fotos, placa y costo.
- DEL-21 App: mensajes a control (texto, audio, captura de pago).
- DEL-22 Mensajes del reparto: bandeja de control y confirmación de cobranza.
Tablas nuevas: driver_expenses, driver_messages, support_requests, external_handoffs. Reglas RN-DEL-14 a RN-DEL-19. Pruebas CA-DEL-17 a CA-DEL-26.
Cambios en DEL.js: estado de parada HANDED_OFF, ganchos D.stopExtras y D.ext, expectedCash con gastos. Cambios en CAJ.js: driverExpected resta los gastos de ruta.

# CRMX · CRM de la vendedora (v1.2)
`src/modules/CRMX.js` envuelve CRM-01 (pestañas por red con conteo), CRM-05 (leads en kanban con arrastre o lista) y CRM-17 (tareas en kanban, agenda o lista, con «Encargar actividad»). Agrega datos de demostración de Instagram, TikTok y Messenger para la vendedora Ana Torres y cuatro actividades encargadas por la supervisora.
