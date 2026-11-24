<?php

namespace App\Modulos\Ops\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ops\Services\Consola;
use App\Modulos\Ops\Services\UsuariosPlataforma;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** OPS-01 Ingreso a la consola (con activación de la cuenta) y OPS-12 Usuarios de plataforma. */
class ConsolaController extends Controller
{
    /* ------------------------------------------------------------------ OPS-01 */

    public function ingresar(Request $request)
    {
        $d = $request->validate([
            'email' => ['required', 'email', 'max:120'],
            'password' => ['required', 'string', 'max:200'],
            'codigo' => ['required', 'string', 'max:10'],
        ], [], ['codigo' => 'código de la app']);

        return response()->json(UsuariosPlataforma::ingresar($d['email'], $d['password'], $d['codigo'], $request->ip(), $request->userAgent()));
    }

    public function prepararActivacion(Request $request)
    {
        $d = $request->validate([
            'email' => ['required', 'email', 'max:120'],
            'codigo' => ['required', 'string', 'max:12'],
            'password' => ['required', 'string', 'max:200', 'confirmed'],
        ], [], ['codigo' => 'código de la invitación']);

        return response()->json(UsuariosPlataforma::prepararActivacion($d['email'], $d['codigo'], $d['password']));
    }

    public function activar(Request $request)
    {
        $d = $request->validate([
            'email' => ['required', 'email', 'max:120'],
            'codigo' => ['required', 'string', 'max:12'],
            'password' => ['required', 'string', 'max:200', 'confirmed'],
            'totp' => ['required', 'string', 'max:10'],
        ], [], ['codigo' => 'código de la invitación', 'totp' => 'código de la app']);
        UsuariosPlataforma::activar($d['email'], $d['codigo'], $d['password'], $d['totp']);

        return response()->json(['message' => 'Tu cuenta está activa. Ya puedes ingresar a la consola.']);
    }

    public function yo(Request $request)
    {
        return response()->json(UsuariosPlataforma::publico($request->attributes->get('consola_usuario')));
    }

    public function salir(Request $request)
    {
        UsuariosPlataforma::salir($request->attributes->get('consola_sesion'), $request->attributes->get('consola_usuario'));

        return response()->noContent();
    }

    /* ------------------------------------------------------------------ OPS-12 */

    public function usuarios(Request $request)
    {
        return response()->json([
            'data' => UsuariosPlataforma::lista(),
            'roles' => collect(Consola::ROLES)->map(fn ($n, $c) => ['code' => $c, 'name' => $n])->values(),
            'dominios' => Consola::dominios(),
            'capacidades' => Consola::capacidades(),
        ]);
    }

    public function crearUsuario(Request $request)
    {
        $d = $request->validate([
            'email' => ['required', 'email', 'max:120'],
            'full_name' => ['required', 'string', 'min:3', 'max:120'],
            'role' => ['required', Rule::in(array_keys(Consola::ROLES))],
        ], [], ['full_name' => 'nombre completo', 'role' => 'rol']);

        return response()->json(UsuariosPlataforma::publico(UsuariosPlataforma::crear($d, $this->quien($request))), 201);
    }

    public function editarUsuario(Request $request, string $id)
    {
        $d = $request->validate([
            'full_name' => ['required', 'string', 'min:3', 'max:120'],
            'role' => ['required', Rule::in(array_keys(Consola::ROLES))],
        ], [], ['full_name' => 'nombre completo', 'role' => 'rol']);

        return response()->json(UsuariosPlataforma::publico(UsuariosPlataforma::editar($id, $d, $this->quien($request))));
    }

    public function estadoUsuario(Request $request, string $id)
    {
        $d = $request->validate([
            'status' => ['required', Rule::in(['ACTIVE', 'LOCKED', 'DISABLED'])],
            'reason' => ['required', 'string', 'min:5', 'max:200'],
        ], [], ['status' => 'estado', 'reason' => 'motivo']);

        return response()->json(UsuariosPlataforma::publico(UsuariosPlataforma::cambiarEstado($id, $d['status'], trim($d['reason']), $this->quien($request))));
    }

    public function reiniciarSegundoFactor(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:200']], [], ['reason' => 'motivo']);

        return response()->json(UsuariosPlataforma::publico(UsuariosPlataforma::reiniciarSegundoFactor($id, trim($d['reason']), $this->quien($request))));
    }

    public function reenviarInvitacion(Request $request, string $id)
    {
        UsuariosPlataforma::reenviarInvitacion($id, $this->quien($request));

        return response()->json(['message' => 'Se envió un código nuevo a su correo.']);
    }

    private function quien(Request $request): array
    {
        return $request->attributes->get('consola_usuario');
    }
}
