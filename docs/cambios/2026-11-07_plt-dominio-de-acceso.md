# 07/11/2026 · PLT-13 Dominio de acceso

## Pantalla
- Cifras: empresa cliente y su plan, estado (si no está activa no se muestra el inicio de sesión), dominio principal y cuántos dominios tiene.
- Tabla de dominios: activo, pendiente de DNS o inactivo; si es el principal; y cómo se verificó (o el registro TXT que falta).
- Agregar un dominio propio: queda pendiente de DNS con un valor `aycha-verify=…` al azar. «Verificar» explica qué registro TXT crear y lo busca en el DNS; si está, el dominio queda activo (y principal si se pidió). Publicarlo en el servidor con su certificado lo hace Intelectalab.
- Hacer principal, desactivar o retirar una solicitud. El principal no se desactiva, ni uno asignado por Intelectalab.
- Aviso mientras el ingreso por dominio esté apagado (`TENANT_POR_DOMINIO`): por ahora se entra por el ingreso general.
- Cambiar dominios pide `plt.hostname.manage` (gerencia y sistemas).

## Seguridad
- `tenant_hostnames` es global (sin RLS), porque el ingreso la lee antes de saber la empresa. Por eso `App\Modulos\Plt\Services\Dominios` filtra **todas** las consultas por la empresa de la sesión: una empresa no ve ni toca los dominios de otra (hay prueba).
- Una empresa no puede pedir dominios de aycha.pe, .localhost ni .test (los asigna Intelectalab), ni direcciones IP, ni un dominio ya registrado; el mensaje no dice de quién es.
- La propiedad se prueba con un registro TXT aleatorio (`random_bytes`). La verificación solo hace una consulta DNS: no se conecta al dominio.
- Agregar y verificar tienen límite de intentos.

## API
`GET /v1/plt/dominios`, `POST /v1/plt/dominios`, `POST /v1/plt/dominios/{id}/verificar`, `.../principal`, `.../desactivar`.

## Pruebas
`tests/Feature/Modulos/PltDominiosTest.php`: solo ve los suyos, no agrega dominios de Aycha, ajenos ni inválidos, verificación con TXT y cambio de principal, no toca dominios de otra empresa, no desactiva los de la plataforma y permisos. 73 pruebas en total.
