# Pendientes y decisiones abiertas

Lo que se vio y se dejó para después, para no perderlo. Cada punto dice qué falta y cuándo toca.

## 1. Consola de plataforma (superadmin) y pantallas de Intelectalab
*Anotado el 03/11/2026.*

**Qué pasa hoy.** El menú copia la matriz del prototipo (`G.ACCESS`). Ahí `GERENTE: '*'` (todo) hereda OPS y SUS, `ADMIN_SISTEMA` tiene `OPS: 'L'` y `SUS: 'L'`, y existe un rol de empresa `SOPORTE_PLATAFORMA` con `OPS: 'CLE'`. Resultado: usuarios de una empresa ven pantallas que son de Intelectalab.

**Cómo lo plantea el prototipo.** El superadmin **no es un rol de empresa**:
- Usuarios propios en `platform_users`, separados de `users`.
- Login propio (OPS-01, RN-OPS-01): bloqueo a los 5 intentos y **segundo factor obligatorio**.
- Roles propios: `PLATFORM_ADMIN` (todo), `BILLING`, `SUPPORT_L1`, `SUPPORT_L2`, `ENGINEER`, `READ_ONLY`.
- No ve datos de una empresa por defecto: pide un **acceso temporal que la empresa aprueba** (OPS-05, OPS-06, OPS-14), revocable y auditado en los dos lados.

**Qué pantallas ve cada lado.**

| Lado | Pantallas |
|---|---|
| Empresa (gerente, admin, administración) | OPS-14 Accesos de soporte, OPS-15 Mis tickets, SUS-01 a SUS-08 (su suscripción, plan, uso, medio de pago, mora) |
| Solo consola de Intelectalab | OPS-01 a OPS-13 y OPS-16, SUS-09 a SUS-14 |

**Por hacer.**
1. ~~**Pronto, pequeño:** ocultar a todos los roles de empresa las pantallas de consola,~~ **Hecho el 19/11/2026** (`SOLO_CONSOLA` en `lib/modulos.ts`): con la misma lista de pantallas permitidas (`screenOnly`) que ya se usa para la vendedora y el repartidor.
2. **Decidir:** quitar el rol `SOPORTE_PLATAFORMA`. En el prototipo simula a Intelectalab; en el sistema real lo cubren los usuarios de plataforma.
3. ~~**Con OPS (fase 4):** la consola como entrada aparte~~ **Hecho el 19/11/2026 (tanda 1):** `/consola` con `platform_users`, su ingreso con segundo factor y su propia sesión; no fija empresa, así que RLS no le muestra datos de negocio. Ver [cambios/2026-11-19_ops-consola.md](cambios/2026-11-19_ops-consola.md). El 19/11 también la tanda 2: lista y ficha de empresas y el alta desde la consola. Y la tanda 3: catálogo de planes con versiones, suscripciones y suspender o reactivar. La tanda 4 (bitácora, parámetros de plataforma, catálogos globales y ocultar la consola a las empresas) también quedó hecha el 19/11. **Por decidir:** el plan Inicial trae ONB sin CRM, DES, REC ni CAL, de los que depende (RN-SUS-01).
4. ~~**Con OPS: importar catálogos globales**~~ **Hecho el 19/11/2026:** pantalla `/consola/catalogos` con revisión antes de grabar (SUNAT, ubigeo y entidades financieras). *Anotado el 18/11/2026.* Hoy se hace con el comando `php artisan mae:importar-global`; el botón «Importar catálogo» del prototipo va en la consola de Intelectalab, no en el sistema de la empresa. Qué debe tener la pantalla: [catalogos-globales.md](catalogos-globales.md#lo-que-falta-para-más-adelante).

## 2. Datos y ajustes globales dentro de módulos de empresa
*Anotado el 03/11/2026.*

PLT, SEG, MAE, INT y AUD son de cada empresa, pero algunas pantallas tocan datos o ajustes que son **de toda la plataforma**. La empresa solo debe consultarlos; los cambia Intelectalab:

| Pantalla | Por qué | Lado de la empresa |
|---|---|---|
| PLT-12 Módulos activables | Lo que se enciende depende del plan (SUS) | Ver su lista; encender solo lo que su plan incluye |
| PLT-13 Dominio de acceso | El dominio lo verifica y publica la plataforma | Ver y solicitar |
| MAE-07 Catálogos SUNAT | Tabla global (`sunat_catalog_items`) | Solo consulta |
| MAE-08 Ubigeo | Tabla global; la importa el operador de plataforma | Solo consulta |
| MAE-09 Entidades financieras | Tabla global (`financial_institutions`) | Solo consulta |
| PLT-10 Parámetros | Las definiciones son globales (`parameter_definitions`); el valor es de la empresa | Cambia su valor dentro del rango |
| INT-13 Simulador de integraciones | Solo existe en ambientes de prueba | Oculto en producción (*hecho el 24/11/2026:* con `APP_ENV=production` la API lo rechaza y sale del menú) |

**Por hacer:** al construir cada una, que la API rechace escrituras de empresa sobre tablas globales (hoy el RLS no las cubre porque no tienen `tenant_id`) y que la pantalla se muestre de solo lectura.

*Hecho el 17/11/2026 para MAE-07, 08 y 09:* las tres pantallas son de solo consulta y la aplicación solo tiene `SELECT` sobre `sunat_catalog_items`, `ubigeo` y `financial_institutions`. Se actualizan con el comando descrito en [catalogos-globales.md](catalogos-globales.md).

## 3. Otros pendientes conocidos
- ~~**Segundo factor** (SEG-02, SEG-03)~~. *Hecho el 24/11/2026, opcional por ahora:* cada persona lo activa en Mi cuenta; para hacerlo obligatorio a los roles que lo exigen se enciende el parámetro `seg_mfa_enforce`. Ver [cambios/2026-11-26_aud-y-segundo-factor.md](cambios/2026-11-26_aud-y-segundo-factor.md).
- **Cumplimiento de RN-PLT-01 y RN-PLT-02:** `FORCE ROW LEVEL SECURITY` (hoy solo `ENABLE`), FK compuestas `(tenant_id, x_id)`, función `plt_rls_gaps()` y que CI falle si devuelve filas.
- ~~**Fecha límite de cierre guardada al cerrar**~~ (PLT-09). *Hecho el 07/11/2026 con PLT-10:* `accounting_periods.close_due_date` se llena al cerrar y los meses ya cerrados se completaron con el día vigente (5).
- ~~**Colores de la marca en todo el sistema**~~ (PLT-01 y PLT-06). *Hecho el 07/11/2026:* ver `docs/cambios/2026-11-07_colores-de-la-marca-en-el-sistema.md`.
- **Bitácora de accesos** (`access_log`, AUD-03) y **despacho del outbox** de eventos (INT-06).
- **Archivo de la depuración fuera del servidor** (D-AUD-03). Hoy los archivos cifrados de la depuración (AUD-07) quedan en el disco privado del mismo servidor. La decisión es guardarlos en un almacenamiento aparte que no permita sobrescribir. Falta elegir el proveedor.
- **Enlace de pago en el resumen del pedido** (RN-CRM-22): hoy el resumen lleva el Yape oficial de la empresa; el enlace de pago lo pondrá Caja (CAJ) cuando esté.
- **WhatsApp real** (D-CRM-01): falta elegir el proveedor oficial y su adaptador. Hasta entonces, los mensajes que se responden desde la bandeja en los números de producción quedan registrados como «no enviado». En el entorno de prueba salen por el conector falso.
- **Textos del aviso de registro** (D-CRM-06): los de cada número son provisionales; falta validarlos con el abogado de datos personales. Se ven en CRM-18 y se editan en Números y cuentas.
- **«Llamar» en Mis tareas** (CRM-17): espera a Telefonía (TEL). Hoy el botón queda apagado y la tarea se completa con el resultado de la llamada hecha desde el celular.
- **Grabaciones de llamadas** (TEL): la política de 12 meses ya está en AUD-06 y la depuración respeta las retenidas por caso legal. Falta que TEL guarde grabaciones, y validar el plazo con un abogado de datos personales (D-AUD-02).

## 4. Consola: lo que falta del prototipo 2.5
*Anotado el 24/11/2026.* Ella pidió conservar el diseño actual y agregar lo que el prototipo muestra. Ya hechas: Bitácora, Salud, Incidentes, Mora, Cobros y conciliación, Facturación, Catálogo de planes, Suscripciones, Empresas, Ficha de empresa, Registros y demos, Métricas, Tickets, Anuncios, Accesos, Complementos, Usuarios y Parámetros (24/11). Todas las listas se ordenan por columna. Lo que queda abajo necesita datos que el sistema todavía no guarda.

| Pantalla | Lo que falta |
|---|---|
| Empresas | Columna de integraciones (cuando existan) |
| Ficha de empresa | Volumen mensual de pedidos y mensajes (no se mide todavía); sumar OSE y WhatsApp a la salud cuando existan |
| Registros y demos | Tabla de altas en curso y tiempo de alta (falta guardar el avance del asistente de alta) |
| Métricas | Volumen por empresa (pedidos y mensajes del mes; no se mide todavía) |
| Anuncios | Lecturas y «Leído por» (no se registra quién lee cada anuncio) |
| Salud | Tarjeta «Versiones desplegadas» (no se guarda la versión de cada despliegue) |
