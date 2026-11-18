<?php

// Contraseñas (RN-SEG-02): se guardan con Argon2id. Las guardadas antes con bcrypt se siguen
// aceptando y se convierten a Argon2id la próxima vez que la persona ingresa (AuthController).
// Por eso no se exige que el hash sea del algoritmo actual («verify»).

return [

    'driver' => env('HASH_DRIVER', 'argon2id'),

    'bcrypt' => [
        'rounds' => env('BCRYPT_ROUNDS', 12),
        'verify' => false,
        'limit' => env('BCRYPT_LIMIT', null),
    ],

    'argon' => [
        'memory' => (int) env('ARGON_MEMORY', 65536),
        'threads' => (int) env('ARGON_THREADS', 1),
        'time' => (int) env('ARGON_TIME', 4),
        'verify' => false,
    ],

    'rehash_on_login' => true,

];
