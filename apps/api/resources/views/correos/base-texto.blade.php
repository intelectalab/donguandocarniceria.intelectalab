{!! $titulo !!}

@if ($saludo)
{!! $saludo !!}

@endif
@foreach ($parrafos as $p)
{!! $p !!}

@endforeach
@if ($codigo)
Tu código: {!! $codigo !!}
@if ($vence)
{!! $vence !!}
@endif

@endif
@foreach ($pasos as $i => $paso)
{{ $i + 1 }}. {!! $paso !!}
@endforeach
@if (count($pasos))

@endif
@if ($boton)
{!! $boton['texto'] !!}: {!! $boton['url'] !!}

@endif
@if ($nota)
{!! $nota !!}

@endif
--
GestionCarnica · {!! $sitio !!}
