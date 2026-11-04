# 03/11/2026 · Login, sidebar y header como en erp-saas

Siguen el diseño de erp-saas, otro SaaS de Intelectalab (`apps/web/src/components/auth` y `components/layout`), con los colores de Don Guando.

## Login (`components/auth`)
- **`AuthShell`:**
  - panel de la empresa teñido con su color, oscurecido lo justo para que el texto blanco se lea;
  - brillos y rayas, tres funciones destacadas y las marcas;
  - en celular, el panel queda como franja superior;
  - animación de entrada (framer-motion).
- **Ingreso:**
  - «Usuario (correo)» con ícono y contraseña con ojo para mostrarla;
  - «Recordarme» (sesión de 30 días; sin marcar, 12 horas) y «¿Olvidó su contraseña?»;
  - error animado y botón con spinner.
- **Recuperar contraseña** (`/forgot-password` → `/reset-password`): código de 6 caracteres al correo, con la vigencia de `seg_reset_token_minutes`. Admite 5 intentos y un solo uso. Al cambiar la contraseña se cierran las sesiones abiertas. En local, el correo va a `storage/logs/laravel.log`.

## Sidebar (`components/layout/Sidebar.tsx`)
- **Barra desplegada (256 px) o en modo íconos (64 px).** Se recuerda en el navegador.
- **Encabezado de la barra:** tarjeta del usuario con iniciales y punto de sesión activa, empresa, y los selectores de marca y local.
- **Grupos del prototipo con ícono:** se pliegan y se recuerdan. El grupo de la pantalla abierta se despliega solo.
- **Ítem activo** marcado con una barra blanca.
- **Módulo apagado:** sale con el candado «Apagado» y abre un aviso RN-PLT-07, con «Ir a Plataforma» si el rol puede encenderlo.
- **Modo íconos:** panel flotante con los módulos del grupo y tooltips.
- **Esqueleto mientras carga la sesión.**
- **Sección Cuenta:** Mi perfil y Salir. En celular, la barra se abre como cajón.

## Header (`components/layout/Header.tsx`)
- Hamburguesa, migas (empresa · grupo) y título de la pantalla.
- Buscador con Ctrl K, que recorre los módulos del rol y las pantallas de la cuenta.
- Tema claro u oscuro.
- Campana con contador («9+»), panel de las últimas notificaciones, «Marcar todas como leídas» y «Ver todas» (`/notificaciones`). Se actualiza cada minuto.
- Menú de usuario: Mi perfil y seguridad (`/perfil`), Cambiar contraseña (modal), Cambiar de cuenta y Cerrar sesión.
- Título de la pestaña: «Pantalla · Empresa».

## Armazón (`AppShell.tsx`)
Un módulo abierto por su dirección sin acceso del rol, o apagado, no se monta: se muestra el motivo. Si `/me` falla, aparece «Reintentar».

## API
- `POST /v1/me/password`: política de SEG (largo mínimo, mayúsculas, minúsculas, número y sin repetir las últimas 5); cierra las demás sesiones.
- `POST /v1/auth/forgot`, `POST /v1/auth/reset` y `GET /v1/auth/password-rule`.
- `GET /v1/me/notifications/summary`, `GET /v1/me/notifications`, `POST /v1/me/notifications/{id}/read` y `POST /v1/me/notifications/read-all`.
- `GET /v1/tenant` devuelve también el color principal.
- Migración `..._seg_largo_de_hashes.php`: las columnas de hashes generadas desde el prototipo eran demasiado cortas (40). El generador ya lo corrige para las fases siguientes.
- Las semillas incluyen las 87 notificaciones del prototipo.
- 15 pruebas (se agregaron 3 en `CuentaTest`).

## Diferencias con erp-saas
- **Marcas y locales:** los selectores van en la barra lateral, bajo la empresa. En la cabecera quitaban espacio al título.
- **Sin aviso de «Plan» ni banner de renovación:** el módulo SUS todavía no existe. Los candados son de módulos apagados.
- **Sin segundo factor:** pendiente de la decisión entre TOTP y código por correo.
- **Buscador sin registros:** solo busca pantallas, porque aún no hay clientes ni pedidos.
- **Fuentes:** las del prototipo (Archivo y Source Sans 3), no Poppins.
