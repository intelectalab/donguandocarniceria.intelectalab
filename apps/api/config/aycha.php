<?php

return [
    /*
    | Cómo se sabe de qué empresa es cada petición.
    |  false (por ahora): ingreso general. La empresa sale del usuario (por su correo al ingresar y
    |         por su token después). Todas las empresas entran por la misma dirección.
    |  true: cada empresa entra por su dominio (tenant_hostnames, cabecera X-Tenant-Host).
    */
    'tenant_por_dominio' => (bool) env('TENANT_POR_DOMINIO', false),
];
