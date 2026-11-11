<?php

namespace App\Http\Controllers;

use App\Modulos\Seg\Services\Sesiones;
use App\Support\PasswordPolicy;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/** Mi perfil: cambiar la propia contraseña (cierra las demás sesiones, deja la actual). */
class ProfileController extends Controller
{
    public function password(Request $request)
    {
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string'],
        ]);
        $user = $request->user();

        if (! Hash::check($data['current_password'], $user->password)) {
            throw ValidationException::withMessages(['current_password' => ['La contraseña actual no es correcta.']]);
        }
        if ($problema = PasswordPolicy::problem($user, $data['password'])) {
            throw ValidationException::withMessages(['password' => [$problema]]);
        }

        PasswordPolicy::store($user, $data['password']);
        Sesiones::cerrando('REVOKED', 'Contraseña cambiada', fn () => $user->tokens()->where('id', '!=', $user->currentAccessToken()->id)->delete());

        return response()->json(['message' => 'Contraseña actualizada.']);
    }

    /** Regla vigente, para mostrarla en el formulario. */
    public function passwordRule()
    {
        return response()->json(['min' => PasswordPolicy::min(), 'rule' => PasswordPolicy::rule()]);
    }
}
