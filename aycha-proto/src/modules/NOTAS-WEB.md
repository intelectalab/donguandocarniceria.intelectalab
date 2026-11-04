# NOTAS-WEB

- Webhooks: entran por `G.int.receiveWebhook` (firma, crudo, deduplicación). El procesador WOOCOMMERCE de INT llama a `G.web.importWooOrder`; la tienda receptora se pasa en una variable local mientras dura la llamada. Las notificaciones de Mercado Pago se envían sin `status` (como la real: solo el id) para que el procesador de INT no registre el cobro; WEB lo consulta a la API falsa (`mpRemote`/`mpGet`) y escribe el `result` del evento en `webhook_events`.
- Sin INT: respaldo local con la misma tabla `webhook_events` y firma simple.
- Dirección sin pin (D-WEB-02): se inserta en `customer_addresses` con los mismos campos (CLI exige pin); la vendedora la completa en WEB-05 o con `G.cli.createLink`. En la siembra el enlace se escribe en `customer_location_links` con token determinista.
- `payments.gateway_transaction_id` = id de `gateway_transactions`; el seed de CAJ (orden 31) lo reemplaza por la referencia en los cobros sembrados, por eso WEB enlaza por `gateway_transactions.payment_id`.
- Último stock enviado de los mapeos sembrados se fija al primer uso (`finalize`), porque los saldos terminan de sembrarse después del orden 22.
- Contracargo/reembolso: usa `G.caj.reverse` si existe; si no, marca el cobro REVERSED. La nota de crédito queda preparada y se emite con `G.docs.issue`.
- Liberación de fondos (D-WEB-03): 14 días con tarjeta de crédito y 2 con débito/Yape (valor de demostración).
