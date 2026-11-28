<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <style>
        @page { margin: 18mm 15mm 18mm; }
        body { color: #1f2937; font-family: DejaVu Sans, sans-serif; font-size: 9pt; line-height: 1.45; }
        .top { border-bottom: 2px solid #166534; margin-bottom: 18px; padding-bottom: 8px; }
        .brand { color: #166534; font-size: 11pt; font-weight: bold; }
        .number { color: #4b5563; float: right; font-size: 9pt; }
        h1 { font-size: 17pt; margin: 0 0 4px; }
        h2 { border-bottom: 1px solid #d1d5db; font-size: 11pt; margin: 18px 0 8px; padding-bottom: 4px; }
        p { margin: 6px 0 10px; }
        .muted { color: #6b7280; font-size: 8pt; }
        .simulation { background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; font-weight: bold; margin: 12px 0; padding: 8px; }
        table { border-collapse: collapse; margin: 6px 0 14px; width: 100%; }
        th, td { border: 1px solid #d1d5db; padding: 6px 7px; vertical-align: top; }
        th { background: #f3f4f6; font-weight: bold; text-align: left; }
        .summary th { width: 22%; }
        .amount { text-align: right; white-space: nowrap; }
        .small { font-size: 8pt; }
        .keep-together { page-break-inside: avoid; }
        .signatures { margin-top: 30px; }
        .signatures td { border: 0; padding: 4px 18px 4px 0; width: 50%; }
        .signature-line { border-top: 1px solid #6b7280; margin-top: 38px; padding-top: 5px; }
        .footer { border-top: 1px solid #d1d5db; color: #6b7280; font-size: 7pt; margin-top: 24px; padding-top: 6px; }
        thead { display: table-header-group; }
        tr { page-break-inside: avoid; }
    </style>
</head>
<body>
    <div class="top">
        <span class="brand">GestionCarnica</span>
        <span class="number">{{ $acta['act_number'] }}</span>
    </div>

    <h1>Acta de separación de marca</h1>
    <p><strong>{{ $acta['brand_name'] }} ({{ $acta['brand_code'] }})</strong></p>
    <p class="muted">
        Fecha de corte: {{ $acta['cutoff_date'] }} · Entrada en vigencia: {{ $acta['effective_from'] }} ·
        Generada: {{ \Carbon\Carbon::parse($acta['generated_at'])->timezone('America/Lima')->format('d/m/Y H:i') }}
    </p>

    @if ($acta['simulation'])
        <div class="simulation">SIMULACIÓN · Este documento no representa cambios operativos.</div>
    @endif

    <p>
        Con fecha de corte {{ $acta['cutoff_date'] }}, la marca {{ $acta['brand_name'] }}
        deja de emitir con {{ $acta['origin_legal_name'] }} (RUC {{ $acta['origin_ruc'] }}) y, desde
        {{ $acta['effective_from'] }}, pasa a {{ $acta['dest_type_name'] }}:
        {{ $destination }}. El histórico anterior al corte se conserva tal como fue emitido.
    </p>

    <table class="summary">
        <tbody>
            <tr>
                <th>Empresa de origen</th>
                <td>{{ $acta['origin_legal_name'] }} · RUC {{ $acta['origin_ruc'] }}</td>
                <th>Destino</th>
                <td>{{ $acta['dest_type_name'] }} · {{ $destination }}@if ($acta['dest_ruc']) · RUC {{ $acta['dest_ruc'] }}@endif</td>
            </tr>
            <tr>
                <th>Fecha de corte</th>
                <td>{{ $acta['cutoff_date'] }}</td>
                <th>Vigencia en destino</th>
                <td>{{ $acta['effective_from'] }}</td>
            </tr>
            <tr>
                <th>Stock traspasado</th>
                <td>{{ count($stockRows) }} lotes · {{ number_format($stockSent, 3, ',', '.') }} enviados · {{ number_format($stockReceived, 3, ',', '.') }} recibidos</td>
                <th>Valor del traspaso</th>
                <td>S/ {{ number_format($acta['stock_value_pen'], 2, ',', '.') }} · IGV de comprobantes S/ {{ number_format($transferTax, 2, ',', '.') }}</td>
            </tr>
            <tr>
                <th>Cuentas por cobrar</th>
                <td>Quedan en origen S/ {{ number_format($receivablesKept, 2, ',', '.') }} · cedidas S/ {{ number_format($receivablesAssigned, 2, ',', '.') }}</td>
                <th>Pedidos abiertos</th>
                <td>{{ $ordersTotal }} · {{ $ordersResolved }} resueltos</td>
            </tr>
            <tr>
                <th>Paquete de exportación</th>
                <td colspan="3">
                    @if ($acta['export_number'])
                        {{ $acta['export_number'] }} · SHA-256 {{ $acta['export_sha256'] }}
                    @else
                        No generado
                    @endif
                </td>
            </tr>
        </tbody>
    </table>

    <h2>Comprobantes y guías de remisión</h2>
    <table>
        <thead>
            <tr>
                <th>Comprobante</th>
                <th>Fecha</th>
                <th>Guía de remisión</th>
                <th class="amount">Subtotal</th>
                <th class="amount">IGV</th>
                <th class="amount">Total</th>
            </tr>
        </thead>
        <tbody>
            @forelse ($transferDocs as $doc)
                <tr>
                    <td>{{ $doc['full_number'] ?? '-' }}</td>
                    <td>{{ $doc['issue_date'] ?? '-' }}</td>
                    <td>{{ $doc['guide_number'] ?? '-' }}</td>
                    <td class="amount">S/ {{ number_format((float) ($doc['subtotal'] ?? 0), 2, ',', '.') }}</td>
                    <td class="amount">S/ {{ number_format((float) ($doc['igv'] ?? 0), 2, ',', '.') }}</td>
                    <td class="amount">S/ {{ number_format((float) ($doc['total'] ?? 0), 2, ',', '.') }}</td>
                </tr>
            @empty
                <tr><td colspan="6" class="muted">Sin comprobantes de traspaso asociados.</td></tr>
            @endforelse
        </tbody>
    </table>

    <h2>Detalle del stock traspasado</h2>
    <table>
        <thead>
            <tr>
                <th>Lote y producto</th>
                <th>Almacén</th>
                <th class="amount">Enviado</th>
                <th class="amount">Recibido</th>
                <th>Estado</th>
            </tr>
        </thead>
        <tbody>
            @forelse ($stockRows as $item)
                <tr>
                    <td>{{ $item['label'] }}</td>
                    <td>{{ $item['warehouse_name'] }}</td>
                    <td class="amount">{{ number_format($item['qty'], 3, ',', '.') }} {{ $item['uom'] }}</td>
                    <td class="amount">{{ $item['received_qty'] === null ? '-' : number_format($item['received_qty'], 3, ',', '.').' '.$item['uom'] }}</td>
                    <td>{{ $item['status_name'] }}</td>
                </tr>
            @empty
                <tr><td colspan="5" class="muted">No hay lotes incluidos en el traspaso.</td></tr>
            @endforelse
        </tbody>
    </table>

    <h2>Preparación y aprobación</h2>
    <table class="signatures">
        <tbody>
            <tr>
                <td>
                    <div class="signature-line">
                        <strong>{{ $acta['prepared_by_name'] ?: 'Pendiente' }}</strong><br>
                        Preparó<br><span class="muted">{{ $acta['prepared_at'] ?: '-' }}</span>
                    </div>
                </td>
                <td>
                    <div class="signature-line">
                        <strong>{{ $acta['approved_by_name'] ?: 'Pendiente de aprobación' }}</strong><br>
                        Aprobó<br><span class="muted">{{ $acta['approved_at'] ?: '-' }}</span>
                    </div>
                </td>
            </tr>
        </tbody>
    </table>

    @if ($acta['approval_note'])
        <p class="small"><strong>Nota de aprobación:</strong> {{ $acta['approval_note'] }}</p>
    @endif

    <div class="footer">Documento generado por {{ $acta['generated_by_name'] }} · GestionCarnica · {{ $acta['act_number'] }}</div>
</body>
</html>
