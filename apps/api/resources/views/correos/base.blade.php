<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{{ $titulo }}</title>
<style>
  @media only screen and (max-width: 480px) {
    .gc-tarjeta { padding: 24px 20px 22px 20px !important; }
    .gc-codigo { font-size: 26px !important; letter-spacing: 4px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#F4F1EC;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F1EC;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

    {{-- Marca --}}
    <tr><td style="padding:0 4px 20px 4px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="40" height="40" align="center" valign="middle" style="width:40px;height:40px;background-color:#6E1423;border-radius:10px;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:bold;line-height:40px;color:#D4A72C;">G</td>
        <td style="padding-left:12px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#2B1A1D;">GestionCarnica</td>
      </tr></table>
    </td></tr>

    {{-- Tarjeta --}}
    <tr><td class="gc-tarjeta" style="background-color:#FFFFFF;border-radius:14px;border-top:4px solid #6E1423;padding:32px 32px 28px 32px;font-family:Arial,Helvetica,sans-serif;color:#3A2E30;font-size:15px;line-height:24px;">

      <h1 style="margin:0 0 20px 0;font-size:22px;line-height:30px;font-weight:bold;color:#2B1A1D;">{{ $titulo }}</h1>

      @if ($saludo)
        <p style="margin:0 0 14px 0;">{{ $saludo }}</p>
      @endif

      @foreach ($parrafos as $p)
        <p style="margin:0 0 14px 0;">{{ $p }}</p>
      @endforeach

      @if ($codigo)
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 22px 0;">
          <tr><td align="center" style="background-color:#FBF6EA;border:1px solid #EAD9AE;border-radius:10px;padding:18px 12px;">
            <div style="font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:#8A7458;">Tu código</div>
            <div class="gc-codigo" style="margin-top:6px;font-family:'Courier New',Courier,monospace;font-size:32px;line-height:40px;font-weight:bold;letter-spacing:6px;color:#6E1423;">{{ $codigo }}</div>
            @if ($vence)
              <div style="margin-top:6px;font-size:13px;line-height:18px;color:#8A7458;">{{ $vence }}</div>
            @endif
          </td></tr>
        </table>
      @endif

      @if (count($pasos))
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
          @foreach ($pasos as $i => $paso)
            <tr>
              <td width="34" valign="top" style="padding:0 0 12px 0;">
                <div style="width:24px;height:24px;border-radius:12px;background-color:#6E1423;color:#FFFFFF;font-size:13px;line-height:24px;font-weight:bold;text-align:center;">{{ $i + 1 }}</div>
              </td>
              <td valign="top" style="padding:0 0 12px 0;">{{ $paso }}</td>
            </tr>
          @endforeach
        </table>
      @endif

      @if ($boton)
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 6px 0;">
          <tr><td align="center" style="background-color:#6E1423;border-radius:8px;">
            <a href="{{ $boton['url'] }}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:8px;">{{ $boton['texto'] }}</a>
          </td></tr>
        </table>
        <p style="margin:12px 0 0 0;font-size:13px;line-height:20px;color:#7A6E70;">Si el botón no funciona, copia este enlace en tu navegador:<br>
          <a href="{{ $boton['url'] }}" target="_blank" style="color:#6E1423;word-break:break-all;">{{ $boton['url'] }}</a></p>
      @endif

      @if ($nota)
        <p style="margin:24px 0 0 0;padding-top:16px;border-top:1px solid #EEE8E3;font-size:13px;line-height:20px;color:#7A6E70;">{{ $nota }}</p>
      @endif
    </td></tr>

    {{-- Pie --}}
    <tr><td align="center" style="padding:20px 8px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#9A8F90;">
      Este correo lo envió GestionCarnica de forma automática; no hace falta responderlo.<br>
      <a href="{{ $sitio }}" target="_blank" style="color:#9A8F90;">{{ preg_replace('#^https?://#', '', rtrim($sitio, '/')) }}</a>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>
