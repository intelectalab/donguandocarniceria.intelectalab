### AUD
- Base (generador): `audit.change_log` y su trigger de inmutabilidad.
- Propias: `access_log` (solo inserción), `data_exports`, `audit_retention_policies`, `audit_purge_runs` (solo inserción), `access_reviews`.
- En `audit.change_log` se agregan, en `f0_plataforma.sql`, el trigger de enmascarado `audit.mask_sensitive` (RN-AUD-07) y los índices por fecha y por usuario.
- Funciones: `aud_inactive_users`.
### INT
- Propias: `integration_connectors`, `integration_credentials`, `webhook_endpoints`, `webhook_events`, `outbox_messages`, `idempotency_keys`, `integration_runs`, `notifications`, `notification_preferences`, `file_attachments`.
- Columnas agregadas con `A()` en otras tablas de la fase 0: `payment_methods.connector_id` (MAE).
- Funciones: `int_receive_webhook`, `int_outbox_enqueue`, `int_outbox_claim`, `int_outbox_mark_sent`, `int_outbox_mark_failed`, `int_outbox_retry_dead`, `int_idempotency_begin`, `int_idempotency_complete`, `int_notify`, `int_connector_report`, `int_credentials_expiring`, `kpi_int_outbox_success_pct`, `kpi_int_webhook_duplicate_pct`.
### MAE
- Núcleo (f0_nucleo.py): `employees`, `payment_methods`, `exchange_rates`, `units_of_measure`, `sunat_catalog_items` (global), `ubigeo` (global).
- Propias: `payment_method_fees`, `unit_conversions`, `financial_institutions` (global).
- Columnas agregadas con `A()`: `employees.email`, `cost_center_id`, `terminated_on`, `termination_reason`; `payment_methods.is_system`, `institution_code`, `connector_id`, `settlement_days`, `allowed_channels`, `sort_order`; `exchange_rates.published_on`, `loaded_via`, `edit_reason`; `units_of_measure.uom_type`, `decimals`, `is_system`.
- Funciones: `payment_method_fee`, `get_exchange_rate`, `convert_qty`, `assert_qty_decimals`, `sunat_code_valid`.
### PLT
- Núcleo (f0_nucleo.py): `companies`, `establishments`, `brands`, `cost_centers`, `document_series`, `accounting_periods`, `parameters`, `parameter_history`, `tenant_modules`.
- Propias: `platform_modules` (global), `parameter_definitions` (global), `tenant_hostnames` (global), `ui_themes`, `accounting_period_events` (solo inserción), `search_entries`.
- Columnas agregadas con `A()`: `parameters.reason`; `tenant_modules.enabled_by`, `disabled_reason`; `brands.sort_order`, `whatsapp_display_name`; `companies.default_currency`, `timezone`, `logo_url`.
- Funciones: `plt_rls_gaps`, `ruc_is_valid`, `get_parameter`, `get_parameter_num`, `module_enabled`, `assert_module_enabled`, `assert_brand_active`, `color_contrast_ratio`, `ui_theme_for`, `plt_close_period`, `plt_reopen_period`, `resolve_tenant_by_host`, `search_global`.
### SEG
- Núcleo (f0_nucleo.py): `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_scopes`.
- Propias: `user_devices`, `user_sessions`, `password_history` (solo inserción), `password_reset_tokens`, `mfa_recovery_codes`.
- Columnas agregadas con `A()`: `users.password_changed_at`, `must_change_password`, `locked_until`, `last_failed_login_at`, `mfa_enrolled_at`, `totp_last_step`, `default_brand_id`, `ui_theme_mode`, `locale`; `roles.description`, `requires_mfa`, `scope_mode`, `phase`, `status`.
- Funciones: `user_has_permission`, `user_can_access`, `user_requires_mfa`, `seg_check_login_allowed`, `seg_register_login_failure`, `seg_register_login_success`, `seg_unlock_user`, `seg_accept_totp_step`, `seg_use_recovery_code`, `seg_consume_reset_token`, `seg_touch_session`, `assert_not_self_approval`.
### ADS
Propias: `ad_accounts`, `ad_campaigns`, `ad_ads`, `ad_import_runs`, `ad_spend_daily`, `ad_attributions`, `ad_platform_invoices`. Vista `v_ads_monthly_results`. Función `ads_reconcile_invoice`. Usa `expenses.ad_campaign_id` (GAS) para creadores de contenido y `suppliers` para las plataformas como proveedores.
### ALM
- Núcleo usadas: `warehouses`, `lots`, `stock_movements`, `stock_balances`.
- Propias: `waste_reasons`, `stock_receipts`, `stock_receipt_lines`, `lot_status_changes` (solo inserción), `stock_transfers`, `stock_transfer_lines`, `stock_counts`, `stock_count_lines`, `stock_waste_records`, `stock_reservations`.
- Agregadas con `A()`: `warehouses` (`parent_id`, `vehicle_id`, `allows_sale`, `pick_priority`); `lots` (`received_weight_kg`, `released_at`, `released_by`, `block_reason`).
- Restricción agregada en SQL: `stock_balances` no negativo y reservado ≤ saldo.
- Funciones: `alm_inventory_move`, `alm_fefo_candidates`, `alm_reserve_line`, `alm_release_order_reservations`, `alm_confirm_receipt`, `alm_dispatch_transfer`, `alm_receive_transfer`, `alm_approve_count`, `alm_approve_waste`; vistas `v_expiry_alerts`, `v_stock_in_transit`.
### CAJ
- Núcleo usadas: `cash_accounts`, `payments`, `payment_allocations`.
- Propias: `customer_balance_movements` (solo inserción), `driver_settlements`, `settlement_batches`, `settlement_batch_items` (un cobro una sola vez), `cash_transfers`.
- Agregadas con `A()`: `cash_accounts` (`brand_id`, `holder_employee_id`, `fee_pct`, `fee_fixed`, `settlement_days`, `max_balance`); `payments` (`brand_id`, `establishment_id`, `pos_shift_id`, `card_brand`, `card_last4`, `gateway_transaction_id`, `collected_by_employee_id`, `fee_amount`, `reconciliation_status`, `settlement_batch_id`, `driver_settlement_id`, `reversal_reason`).
- Funciones: `caj_driver_expected`, `caj_settle_driver`, `caj_close_batch`; vistas `v_customer_balances`, `v_receivables`, `v_unreconciled_payments`; índice único parcial de número de operación vigente.
### CAT
- Propias: `cut_types`, `price_lists`, `price_list_items` (exclusión de vigencias superpuestas), `combo_components`.
- Núcleo usadas: `product_categories`, `products`, `product_variants`.
- Agregadas con `A()`: `products` (`web_publishable`, `web_title`, `web_description`, `image_url`, `allow_discount`, `sanitary_alert_days`); `product_variants` (`cut_type_id`, `min_weight_kg`, `max_weight_kg`, `scale_plu`, `web_publishable`, `min_order_qty`, `qty_step`).
- Funciones: `cat_price_for`, `cat_parse_scale_barcode`, `cat_ean13_check_ok`; vista `v_sanitary_registry_alerts`.
### CLI
- Núcleo usadas: `customers`, `customer_addresses`, `delivery_zones`.
- Propias: `customer_duplicate_candidates`, `customer_merges` (solo inserción).
- Agregadas con `A()`: `customers` (`doc_validated_at`, `doc_validation_source`, `phone_alt`, `merged_into_id`, `blocked_reason`, `first_order_at`, `last_order_at`); `customer_addresses` (`pin_source`, `geocode_confidence`, `last_used_at`); `delivery_zones` (`priority`, `min_order_amount`, `free_from_kg`, `province`).
- Funciones: `cli_ruc_is_valid`, `cli_point_in_polygon`, `cli_zone_for`; índice único parcial de dirección predeterminada.
### CRM
Propias: `messaging_channels`, `channel_members`, `channel_member_shifts`, `crm_agent_status`, `leads`, `channel_contacts`, `conversations`, `conversation_assignments` (solo inserción), `message_templates`, `quick_replies`, `conversation_messages` (solo inserción), `message_status_events` (solo inserción), `message_charges` (solo inserción), `message_transcripts`, `conversation_orders`, `contact_consents` (solo inserción), `official_identifiers`, `control_alert_rules`, `control_alerts`, `conversation_reviews`, `crm_tasks`, `customer_rebuy_profiles`, `delivery_surveys`. Vista `v_crm_whatsapp_cost`. Funciones `crm_auto_assign`, `crm_pick_agent`, `crm_link_order`, `crm_scan_text`, `crm_rebuy_schedule`.
No agrega columnas a tablas de otros módulos: el origen del pedido usa las columnas de PED (`origin_wa_number`, `origin_ad_code`, `origin_utm`) y el vínculo queda en `conversation_orders`.
### DEL
Propias: `delivery_routes`, `delivery_stops`, `delivery_events` (solo inserción), `tracking_links`, `carrier_rates`, `carrier_invoices`, `carrier_invoice_lines`, `province_shipments`, `delivery_costs`, `delivery_cost_allocations` (solo inserción). Vista `v_delivery_cost_summary`. Funciones `del_allocate_costs`, `del_reconcile_carrier_invoice`.
Agregadas con `A()` a `vehicles` (núcleo): `fuel_type`, `soat_policy_no`, `soat_expires_on`, `tech_inspection_expires_on`, `odometer_km`, `rental_daily_rate`. Usa `driver_settlements` (CAJ) por `route_ref` y `dispatch_guides` (FAC).
### FAC
- Núcleo usadas: `sales_documents`, `sales_document_lines`, `document_series`.
- Propias: `einvoice_submissions` (solo inserción), `sunat_daily_summaries`, `sunat_daily_summary_lines`, `dispatch_guides`, `dispatch_guide_lines`.
- Agregadas con `A()`: `sales_documents` (adquirente congelado, logo de la marca, condición de pago y vencimiento, motivo de nota, respuesta SUNAT, hash, CDR, PDF, intentos, próximo reintento, anulación, vendedora, turno de caja).
- Funciones: `fac_split_igv`, `fac_assert_ready`, `fac_register_attempt`.
### GAS
Propias: `expense_categories`, `expense_approval_rules`, `petty_cash_funds`, `petty_cash_reports`, `expenses`, `expense_allocations`, `expense_approvals` (solo inserción). Funciones y triggers: `gas_expenses_before`, `gas_expenses_after` (copia a `delivery_costs`), `gas_approvals_before`, `gas_required_level`. Usa `suppliers` (núcleo de COM), `cash_accounts` (CAJ) y `cost_centers` (PLT).
### PED
- Núcleo usadas: `sales_orders`, `sales_order_lines`.
- Propias: `order_time_slots`, `order_cancel_reasons`, `discount_limits`, `sales_order_status_history` (solo inserción), `order_reschedules` (solo inserción), `order_discount_approvals`, `order_weight_notices`.
- Agregadas con `A()`: `sales_orders` (contacto, cliente de facturación, local de recojo, zona, franja, descuentos, estado de diferencia de peso, modo de saldo, confirmación del cliente, cancelación, reprogramaciones, provincia, origen `origin_wa_number`, `origin_ad_code`, `origin_utm`, `origin_ref`, `external_ref`, turno de caja, entregado y cerrado); `sales_order_lines` (`price_list_id`, `list_price`, `discount_pct`, `tolerance_pct`, `est_amount`, `weight_source`, `scale_barcode`, `combo_parent_line_id`).
- Funciones: `ped_missing_fields`, `ped_transition_ok`, `ped_recalc_order`, `ped_delivery_fee`, `ped_reschedule`, `ped_whatsapp_summary`; vista `v_orders_incomplete`.
### POS
- Propias: `pos_terminals`, `pos_shifts` (índices únicos parciales: un turno abierto por caja y por cajera), `pos_shift_counts`, `pos_cash_movements` (solo inserción).
- Usa con `A()` de PED, FAC y CAJ: `sales_orders.pos_shift_id`, `sales_order_lines.weight_source` y `scale_barcode`, `sales_documents.pos_shift_id`, `payments.pos_shift_id`, `card_brand`, `card_last4`.
- Funciones: `pos_expected_cash`.
### PRE
Propias: `picking_waves`, `picking_tasks`, `picking_task_lines`, `shipment_parcels`, `picking_scans` (solo inserción), `packing_errors`. Funciones y triggers: `pre_scans_before` (clasifica y bloquea), `pre_scans_after`, `pre_tasks_before`, `pre_lines_before`, `pre_parcels_before`, `pre_parcel_caption`. Lee `stock_balances` y `lots` (ALM) sin escribirlos: la salida de stock la hace ALM con `InventoryService::move` al despachar.
### TAB
Núcleo (f1_nucleo): `kpi_definitions`, `kpi_targets`, `kpi_snapshots` (solo inserción). Agregadas con `A()`: en `kpi_definitions` `calculator`, `drilldown`, `decimals`, `visible_roles`, `requires_module`; en `kpi_snapshots` `snapshot_run_id`. Propias: `kpi_snapshot_runs`, `dashboards`, `dashboard_widgets`. Funciones `kpi_register`, `kpi_semaphore`, `tab_seed_dashboards`; vista `v_kpi_latest`; exclusión `kpi_targets_rn_tab_05_no_overlap`.
### TEL
Propias: `tel_settings`, `tel_activation_steps`, `tel_menus`, `tel_ring_groups`, `tel_ring_members`, `tel_numbers`, `tel_calls`, `tel_recordings`, `tel_transcripts`, `tel_recording_access_log` (solo inserción). Todas con el guardia `tel_guard` (RN-PLT-07). Funciones `tel_prepare_activation`, `tel_purge_recordings`. Usa `crm_tasks` y `control_alerts` de CRM.
### WEB
- Propias: `web_stores`, `web_product_mappings`, `web_order_inbox` (único por tienda y pedido externo), `web_sync_runs`, `gateway_transactions` (único por proveedor y pago externo).
- Usa con `A()` de CAJ: `payments.gateway_transaction_id`.
- Funciones: `web_register_order`; vista `v_web_stock`.
### CAL
Propias: `qc_checklists`, `qc_checklist_items`, `qc_schedules`, `qc_inspections`, `qc_inspection_answers`, `temperature_points`, `temperature_readings`, `temperature_excursions`, `lot_quality_decisions`, `nonconformities`, `corrective_actions`, `sanitary_registrations`, `quality_claims`.
Funciones: `cal_decide_lot(lote, decisión, usuario, motivo)`, `cal_finish_inspection(inspección)`, `assert_sanitary_valid(producto, fecha)`; disparadores de lecturas, excursiones, no conformidades, reclamos y protección de `lots.qc_status`.
Columnas agregadas con `A()`: ninguna.
### CNT
Propias: `gl_accounts`, `journal_rules`, `journal_rule_lines`, `journal_entries`, `journal_lines`, `accountant_inbox_items`, `sire_proposals`, `sire_proposal_lines`, `sire_submissions`, `cnt_fiscal_years`, `ledger_exports`, `bank_statement_lines`, `bank_reconciliations`, `period_close_tasks`, `payroll_journal_imports`, `fs_templates`, `fs_template_lines`.
Funciones: `cnt_build_entry(...)`, `cnt_close_period(...)`, `cnt_reopen_period(...)`, `cnt_match_sire_purchases(propuesta)`, `cnt_books_regime(empresa, año)`; vistas `v_trial_balance` y `v_documents_without_entry`; disparadores de cuadre, aprobación, inmutabilidad y período.
Columnas agregadas con `A()`: ninguna.
### COM
Propias: `supplier_catalog`, `purchase_orders`, `purchase_order_lines`, `purchase_receipts`, `purchase_receipt_lines`, `purchase_documents`, `purchase_document_lines`, `supplier_payments`, `supplier_payment_allocations`.
Columnas agregadas con `A()` a `suppliers` (núcleo, fase 1): `payment_terms_days`, `related_company_id`, `sunat_status`, `rating`, `default_cost_center_id`, `notes`.
Funciones: `com_approve_order(oc, usuario)`, `com_three_way_match(comprobante)`; vista `v_accounts_payable`.
### DES
Propias: `cutting_templates`, `cutting_template_lines`, `cut_reference_prices`.
Usa `production_orders` (tipo CUTTING) y `production_order_outputs` (con `reference_price_per_kg`, `nrv_cost_per_kg` y `allocated_cost`) de PRO.
Funciones: `des_activate_template(plantilla)`, `des_allocate_joint_cost(orden)`, `des_mass_balance(orden)`.
Columnas agregadas con `A()`: ninguna.
### EQU
Propias: `equipment`, `equipment_calibrations`, `maintenance_plans`, `maintenance_orders`.
Funciones: `assert_equipment_usable(equipo, fecha)`; disparadores de calibración y de orden correctiva.
Columnas agregadas con `A()`: ninguna.
### ETQ
Propias: `label_templates`, `label_prints`, `lot_qr_tokens`, `lot_recalls`, `lot_recall_lots`, `lot_recall_contacts`.
Vista `v_lot_genealogy` (consumos y producciones de PRO). Funciones: `etq_trace_backward(lote)`, `etq_trace_forward(lote)`, `etq_start_recall(retiro)`, `public_lot_page(token)`.
Columnas agregadas con `A()`: ninguna.
### GRJ
Propias: `farm_links`, `farm_product_mappings`, `farm_dispatches`, `farm_dispatch_lines`, `farm_reconciliations`.
Funciones: `grj_expected_doc_type(proveedor, fecha)`; restricción de exclusión de vigencias.
Columnas agregadas con `A()`: ninguna (usa `suppliers.related_company_id`, agregada por COM).
### PRO
Propias: `production_lines`, `production_orders`, `production_order_consumptions`, `production_order_outputs`, `production_order_labor`, `production_order_equipment`, `production_ccp_readings`.
Funciones: `pro_compute_cost(orden)`, `pro_close_order(orden, fecha)`; disparadores de lote liberado, FEFO, orden abierta y lote de producción en cuarentena (`lots`).
Columnas agregadas con `A()`: ninguna en tablas de otras fases.
### REC
Propias: `food_additives`, `recipes`, `recipe_versions`, `recipe_ingredients`, `recipe_steps`, `recipe_control_points`.
Funciones: `rec_approve_version(versión, usuario)`, `rec_scale(versión, kg)`, `rec_standard_cost(versión)`.
Columnas agregadas con `A()`: ninguna.
### B2B
- Propias: `customer_credit_profiles`, `credit_exceptions`, `customer_prices`, `recurring_orders`, `recurring_order_lines`, `recurring_order_runs`, `b2b_portal_accounts`, `b2b_claims`, `collection_reminders`, `payment_promises`.
- Usa de FAC (fase 1) `sales_documents.payment_terms` (`CASH`/`CREDIT`) y `sales_documents.due_date`; un trigger de B2B completa el vencimiento de los comprobantes a crédito (RN-B2B-08).
- Agregada con `A()`: `sales_orders.portal_account_id` (PED; pedido hecho desde el portal).
- Funciones `assert_credit_available`, `customer_overdue_days`; vista `b2b_receivables_v`; triggers de RN-B2B-01/05/06/08/12/17.
### CMP
- Propias: `customer_segments`, `customer_segment_members`, `campaigns`, `campaign_recipients`, `campaign_attributions`, `coupons`, `coupon_redemptions`, `loyalty_programs`, `loyalty_ledger` (solo inserción), `referrals`.
- Usa de la fase 1: `contact_consents` (CRM, solo inserción, propósito `MARKETING`) como registro único de consentimientos y bajas, con el permiso `crm.consent.manage`; `messaging_channels` y `message_templates` (CRM) para el número y la plantilla de cada campaña; `customer_rebuy_profiles` (CRM) para CMP-12.
- Agregadas con `A()`: `customers.referral_code` (CLI) y `contact_consents.brand_id` (CRM; nulo = todas las marcas).
- Función `customer_has_marketing_consent`; triggers de RN-CMP-02/03/07/08/09/12/14.
### CON
- Propias: `calendar_holidays`, `consignment_points`, `consignment_contracts`, `consignment_contract_products`, `consignment_margin_tiers`, `consignment_targets`, `consignment_equipment_loans`, `consignment_visits`, `consignment_deliveries`, `consignment_delivery_lines`, `consignment_register` (solo inserción), `consignment_visit_counts`, `consignment_visit_photos`, `consignment_settlements`, `consignment_settlement_lines`.
- Función `add_business_days(fecha, n)` y triggers de RN-CON-01/02/04/05/06/07/12/16/19/23; exclusión de RN-CON-03; vista `consignment_point_stock_v`.
- Enlaces a la fase 1: `consignment_deliveries.dispatch_guide_id` → `dispatch_guides` (FAC); la serie, el número y el motivo de traslado se copian de la guía al despachar.
- Sin columnas agregadas a tablas de otras fases.
### FLO
- Propias: `vehicle_profiles` (ficha técnica 1:1 con `vehicles` de DEL: marca, modelo, año, capacidad del tanque, rendimiento esperado, rango de temperatura, GPS y sensor), `vehicle_trips`, `vehicle_positions` (solo inserción), `vehicle_odometer_readings`, `fuel_loads`, `vehicle_maintenance_plans`, `vehicle_maintenances`, `vehicle_documents`, `traffic_fines`, `vehicle_costs`, `vehicle_temperature_readings` (solo inserción), `fleet_alerts`.
- Sin columnas agregadas a `vehicles`: el combustible, el odómetro, `soat_expires_on` y `tech_inspection_expires_on` ya son de DEL; FLO mantiene esos dos vencimientos sincronizados desde `vehicle_documents`. Las cargas, mantenimientos y otros costos enlazan su gasto en `expenses` (GAS).
- Funciones `assert_vehicle_operable`, `assert_driver_license_valid`; vista `vehicle_monthly_cost_v`; triggers de RN-FLO-02/04/06/07/08/10/13/14/15.
### PER
- Propias: `job_positions`, `employee_assignments`, `employment_terms`, `shifts`, `shift_assignments`, `establishment_qr_tokens`, `attendance_marks` (solo inserción), `attendance_days`, `salary_advances`, `commission_plans`, `commission_entries` (solo inserción), `staff_payouts`, `staff_payout_lines`, `supervision_actions`, `payroll_exchanges`, `payroll_cost_lines`.
- Sin columnas agregadas a `employees` (MAE): puesto, local, centro de costo y supervisor viven en `employee_assignments` con vigencia.
- Enlaces a la fase 1: `supervision_actions.control_alert_id` → `control_alerts` (CRM); `commission_entries.delivery_stop_id` → `delivery_stops` (DEL).
- Triggers de RN-PER-02/03/04/05/09/10/11/13/14; vista `personnel_cost_month_v`.
### PRS
- Propias: `budget_concepts`, `budget_concept_mappings`, `budgets`, `budget_versions`, `budget_lines`, `budget_actuals` (solo inserción), `budget_forecasts`, `budget_alerts`.
- Función `budget_traffic_light`; vista `budget_vs_actual_v`; índice parcial de versión aprobada única; triggers de RN-PRS-04/05.
- Sin columnas agregadas a tablas de otras fases.
### API
- Globales: `api_scopes`, `api_event_types`.
- Del tenant: `api_keys`, `api_usage_daily`, `api_sandboxes`, `api_webhook_endpoints`, `api_webhook_deliveries`, `api_webhook_attempts` (solo inserción).
- Columna agregada con `A()`: `sales_orders.api_key_id`.
- Reutiliza `idempotency_keys` (INT) para RN-API-13.
- Los destinos de **entrada** de proveedores son `webhook_endpoints` de INT; los de **salida** de esta API son `api_webhook_endpoints`.
### ONB
- Globales: `signup_requests` (privada de la plataforma), `industry_templates`, `industry_template_items`.
- Del tenant: `onboarding_runs`, `onboarding_steps`, `template_applications`, `data_imports`, `data_import_rows`, `opening_balances`.
- Reutiliza `file_attachments` (INT) para los archivos y `kpi_targets` (TAB) para las metas de las plantillas.
### OPS
- Globales y privadas de la plataforma: `platform_users`, `platform_parameters`, `platform_parameter_history`, `platform_audit_log`, `platform_incidents`, `platform_incident_tenants`, `platform_component_checks`, `platform_announcements` (el tenant lee las suyas), `platform_kpi_definitions`, `platform_metric_snapshots`, `tenant_health_snapshots`.
- Del tenant: `support_tickets`, `support_access_grants`, `support_access_log` (solo inserción), `announcement_reads`.
- Columnas agregadas con `A()`: `users.platform_user_id`, `users.support_grant_id`.
- Rol de base de datos `aycha_platform` con políticas por rol en las tablas globales y lectura de las tablas SaaS de todos los tenants.
### SEP
- Propias: `brand_separations`, `brand_separation_checks`, `brand_separation_items`, `brand_company_history`.
- Columnas agregadas con `A()`: `brands.separated_at`, `brands.separation_id`.
- Disparadores sobre tablas de otras fases: empresa vigente en `sales_documents` (RN-SEP-05) y marca separada en `sales_orders` (RN-SEP-06).
### SUS
- Globales (sin tenant): `saas_products`, `saas_product_modules`, `saas_plans`, `saas_plan_modules`, `saas_plan_limits`, `saas_addons`, `trial_registry` (privada), `platform_document_series` (privada).
- Del tenant: `subscriptions`, `subscription_addons`, `subscription_events` (solo inserción), `usage_counters`, `saas_invoices`, `saas_invoice_lines`, `saas_payment_attempts`.
- Columnas agregadas con `A()`: `tenant_modules.sus_source`, `tenant_modules.sus_subscription_id`.
- Disparadores sobre tablas de otras fases: límites en `brands`, `establishments`, `companies`, `users`; solo lectura en `sales_orders`, `sales_documents`, `payments`, `stock_movements`; conteo de pedidos en `sales_orders`; módulos contratados en `tenant_modules`.
