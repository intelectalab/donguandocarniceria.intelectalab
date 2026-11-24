# Auditoría y segundo factor

Rama `feature/aud-auditoria`, creada desde `feature/int-integraciones` (que todavía no está en main).

## Plan por tandas

1. **Segundo factor:** activarlo con QR y códigos de recuperación (SEG-03), pedir el código al ingresar (SEG-02) y su parte en Mi cuenta (SEG-06). *Hecha.*
2. Consulta de cambios (AUD-01), Historia del registro (AUD-02) y Bitácora de accesos (AUD-03).
3. Accesos a datos sensibles (AUD-04) y Exportaciones con aprobación (AUD-05).
4. Políticas de retención (AUD-06), Corridas de depuración (AUD-07) y Revisión de accesos (AUD-08).

Decisión de ella (24/11/2026): el segundo factor es **opcional por ahora**. La obligación para los roles que lo exigen queda lista, pero apagada.

---

# Tanda 1: segundo factor (SEG-02, SEG-03 y SEG-06)

## Base de datos

Migración `2026_11_26_000100_seg_segundo_factor`:
- **users:**
  - el secreto TOTP, cifrado con la clave de la aplicación (`totp_secret_enc`);
  - el secreto que se está activando y cuándo empezó, que vence a los 15 minutos;
  - los tres campos están ocultos en las respuestas de la API.
- **mfa_recovery_codes:** la huella SHA-256 del código cabe entera, y «anulado» pasa a ser una fecha.
- **Usuarios de la demostración:** 8 venían marcados con el segundo factor activo, pero sin secreto guardado. Así habrían quedado fuera del sistema al pedirles un código que no tienen. La migración les apaga la marca y anula sus códigos; lo activan ellos en Mi cuenta.
- **Parámetro nuevo `seg_mfa_enforce`, apagado:** con él encendido, los roles que exigen segundo factor deben activarlo al ingresar. Se cambia en Parámetros (PLT-10), como los demás.

## Reglas (`Seg\Services\SegundoFactor`)

- **RN-SEG-05, activar:**
  - se genera un secreto nuevo con su QR (un enlace `otpauth://` con el emisor «GestionCarnica · empresa»);
  - se confirma con el primer código de la app y quedan 10 códigos de recuperación (`seg_recovery_codes_count`) del tipo `ABCD-EFGH`, sin letras ni números que se confundan;
  - los códigos se muestran una sola vez y de ellos solo se guarda la huella.
- **RN-SEG-06, al ingresar:**
  - con la contraseña correcta no se entrega la sesión, sino un «desafío»: un valor al azar de un solo uso que vale 5 minutos y solo sirve para verificar el código. Se guarda en la caché, solo como huella;
  - se acepta el código de 6 dígitos de la app, que nunca sirve dos veces, o un código de recuperación, que se gasta al usarlo;
  - al quinto código incorrecto el desafío se borra y cuenta como un intento fallido para el bloqueo de la cuenta;
  - las rutas tienen un límite de 10 intentos por minuto.
- **RN-SEG-07:** con `seg_mfa_enforce` encendido y un rol que lo exige, el ingreso pide activarlo antes de entrar, y en Mi cuenta no se puede desactivar.
- **Mi cuenta:**
  - pedir códigos de recuperación nuevos exige un código de la app, y los anteriores dejan de servir;
  - desactivarlo exige un código de la app o de recuperación.
- **Reinicio por un administrador** (ficha del usuario): ahora también borra el secreto guardado. Antes guardaba el texto «REINICIADO» en la fecha de anulación.
- **Bitácora de accesos:** eventos nuevos: pidió el segundo factor, activado, desactivado, códigos nuevos y usó un código de recuperación. Ya existían el segundo factor correcto y el fallido.

## Pantallas

- **Ingreso:**
  - si la persona tiene el segundo factor, después de la contraseña aparece «Verificación en dos pasos» con el código de la app;
  - el enlace «¿No tienes tu celular? Usa un código de recuperación» cambia el campo;
  - «Volver al ingreso» regresa al correo y la contraseña. Si el paso vence, también vuelve solo, con el aviso.
- **Si es obligatorio para su rol:** el ingreso muestra el QR y la clave para escribirla a mano, pide el primer código y entrega los códigos de recuperación antes de entrar.
- **Mi cuenta (o Mi perfil), sección «Segundo factor»:**
  - estado, fecha de activación, códigos disponibles y qué dice su rol;
  - «Activar segundo factor», «Códigos de recuperación nuevos» y «Desactivar» (este último no aparece si es obligatorio);
  - un aviso cuando quedan 2 códigos o menos.
- **Los códigos de recuperación** se pueden copiar, descargar en `.txt` o imprimir, y hay que marcar «Ya guardé mis códigos» para seguir.
- **El QR** se dibuja en el navegador (`qrcode-generator`, igual que en la consola): el secreto no sale a ningún servicio externo.

## Arreglos en Integraciones (en esta rama)

- **Salud de integraciones:** el tiempo de proceso de los webhooks por día ahora es un gráfico de línea, como en el prototipo. Tiene la línea de meta y los puntos sobre la meta van en el color de aviso.
- **Simulador (INT-13):** solo existe fuera de producción. Con `APP_ENV=production` la API responde 404 y `/me` devuelve `pantallas_ocultas: ["INT-13"]`, con lo que la web lo saca del menú. Además, el botón «Disparar» ya no se estira a todo el ancho.

## Pruebas

`tests/Feature/Modulos/SegundoFactorTest.php`, con 4 casos:
- **activar e ingresar:**
  - activar desde Mi cuenta: un código equivocado no lo activa, y quedan 10 códigos;
  - el secreto se guarda cifrado, de los códigos solo la huella, y el secreto nunca sale en la API;
  - el ingreso pide el código; ni el desafío ni el código sirven dos veces;
  - el código de recuperación funciona una vez, y el desafío vence a los 5 minutos;
  - todo queda en la bitácora.
- **intentos, códigos nuevos y desactivar:** cinco códigos malos cuentan para el bloqueo; los códigos nuevos piden un código de la app y anulan los anteriores; desactivar pide un código y después se entra solo con la contraseña.
- **obligatorio:** con el parámetro encendido se activa al ingresar y no se puede desactivar; un rol que no lo exige entra directo.
- **reinicio por un administrador:** borra el secreto.

En `IntTest`, un caso nuevo: el simulador no existe en producción. `PltParametrosTest` ahora cuenta 272 parámetros, por el nuevo.

En total el sistema tiene 380 pruebas, todas correctas. Revisado en el navegador contra `aycha_test`:
- activar en Mi perfil, ver los códigos, cerrar sesión, ingresar con el código y entrar con un código de recuperación, en 1280 y 375 px;
- Salud con la línea y el Simulador con su botón.

## Salud de integraciones: período y gráficos con datos (después del commit de la tanda 1)

- **Por qué estaban vacíos:** en la base local había un webhook de hoy, enviado desde el Simulador y rechazado. Los 10 días terminaban hoy y los datos de octubre quedaban fuera.
- **Cada gráfico tiene su propio tramo:** muestra sus últimos 10 días con actividad de su tipo (webhooks procesados, mensajes salientes). En operación terminan hoy.
- **Filtro «Período»:**
  - por defecto, los últimos 10 días con actividad;
  - también cualquier mes con datos (los últimos 12), día por día;
  - con un mes completo, el eje muestra solo el número del día, uno cada dos.
- **Cifras de webhooks** (repetidos y tiempo de proceso p95): se miden hasta el último webhook válido. Los rechazados por firma ya no corren la ventana.
- **Pruebas:** la de Salud revisa los dos tramos, que la línea tenga puntos, el mes de septiembre completo (30 días) y que un mes mal escrito se rechace.
