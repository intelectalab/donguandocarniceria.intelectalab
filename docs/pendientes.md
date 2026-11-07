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
1. **Pronto, pequeño:** ocultar a todos los roles de empresa las pantallas de consola, con la misma lista de pantallas permitidas (`screenOnly`) que ya se usa para la vendedora y el repartidor.
2. **Decidir:** quitar el rol `SOPORTE_PLATAFORMA`. En el prototipo simula a Intelectalab; en el sistema real lo cubren los usuarios de plataforma.
3. **Con OPS (fase 4):** la consola como entrada aparte (por ejemplo `/consola`), con `platform_users`, su login y su segundo factor. Diseñar cómo entra **sin saltarse el RLS** de las empresas, porque un usuario de plataforma no tiene `tenant_id`.

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
| INT-13 Simulador de integraciones | Solo existe en ambientes de prueba | Oculto en producción |

**Por hacer:** al construir cada una, que la API rechace escrituras de empresa sobre tablas globales (hoy el RLS no las cubre porque no tienen `tenant_id`) y que la pantalla se muestre de solo lectura.

## 3. Otros pendientes conocidos
- **Segundo factor** (SEG-02, SEG-03): pendiente por decisión del equipo; no se implementa por ahora.
- **Cumplimiento de RN-PLT-01 y RN-PLT-02:** `FORCE ROW LEVEL SECURITY` (hoy solo `ENABLE`), FK compuestas `(tenant_id, x_id)`, función `plt_rls_gaps()` y que CI falle si devuelve filas.
- ~~**Fecha límite de cierre guardada al cerrar**~~ (PLT-09). *Hecho el 07/11/2026 con PLT-10:* `accounting_periods.close_due_date` se llena al cerrar y los meses ya cerrados se completaron con el día vigente (5).
- **Colores de la marca en todo el sistema** (PLT-01 y PLT-06). *Anotado el 07/11/2026.* PLT-06 ya guarda los colores de cada marca, pero la aplicación usa la paleta fija de `globals.css`. Hacer: al cambiar la marca en el selector de arriba, leer `Temas::vigente()` y poner sus colores en las variables CSS (`--primary`, `--accent`, `--bg`, `--surface`, `--ink`…), en claro y en oscuro.
- **Bitácora de accesos** (`access_log`, AUD-03) y **despacho del outbox** de eventos (INT-06).
