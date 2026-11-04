# NOTAS-API

- Dependencias con respaldo: SUS (plan y API_CALLS_DAY de `saas_plans`/`saas_plan_limits`/`subscription_addons`; sin SUS: Piloto 5000/día con API, Inicia/Crecer sin API, Escala 10000), INT (`G.int.sha256/hmac/idempotent/adapterFor`; sin INT: SHA-256/HMAC propios, idempotencia propia sobre `idempotency_keys` y OSE FAKE propio).
- Los webhooks salientes son `api_webhook_deliveries` (outbox propio de API); no pasan por `outbox_messages` de INT.
- Los secretos de claves solo viven en memoria de la sesión (`G.api.vault`): los de la semilla se regeneran deterministas al sembrar; nunca se guardan en la base.
- `sales_orders.api_key_id` y `origin_ref = 'API ak_…'` se ponen al crear pedidos por API.
- `stock.low` usa `min_stock_qty` de la variante si ALM lo publica; si no, `api_stock_low_default_qty` (D-API-04).
