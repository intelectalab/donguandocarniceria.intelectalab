# 03/11/2026 · Ingreso general (sin dominio por empresa)

Por ahora todas las empresas entran por la misma dirección (`http://localhost:3010`). El dominio por empresa queda listo y apagado, para activarlo más adelante.

## Cómo se sabe la empresa
- **Al ingresar** (y al recuperar la contraseña): por el correo. Si el mismo correo existiera en dos empresas, entra a la de la contraseña que coincide.
- **En cada petición con sesión:** por el token. Sanctum valida el token completo dentro de esa empresa.
- **Para no abrir el RLS,** dos funciones del dueño devuelven solo el id de la empresa: `auth_tenants_for_email(correo)` y `auth_tenant_for_token(id)` (migración `..._seg_empresa_sin_dominio.php`).
- **La pantalla de ingreso** sale con la marca de Aycha, porque todavía no hay empresa. Dentro del sistema, todo es de la empresa del usuario: nombre, marcas, locales y menú.

## Interruptor
`TENANT_POR_DOMINIO` en el `.env` de la API (`config/aycha.php`):
- `false` (ahora): ingreso general.
- `true`: cada empresa entra por su dominio (`tenant_hostnames`, cabecera `X-Tenant-Host`), y el ingreso sale con su nombre y su color. Ya existen los dominios locales `donguando.localhost` y `cs.localhost`.

## Pruebas
18 en total, que cubren los dos modos. Las de dominio encienden el interruptor dentro de la prueba.
- **Modo general:**
  - la gerente de CS entra por la misma dirección y solo ve CS;
  - con el mismo correo en dos empresas, entra a la de su contraseña;
  - un token solo da acceso a su empresa.
- **Modo por dominio:** dominio desconocido, token de otra empresa y usuario que intenta entrar por el dominio de otra empresa.
