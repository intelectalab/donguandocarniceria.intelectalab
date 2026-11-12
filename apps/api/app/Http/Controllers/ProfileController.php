<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Auth\AuthController;
use App\Modulos\Seg\Services\Bitacora;
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

        // RN-SEG-04: un fallo aquí cuenta igual que al ingresar; al llegar al máximo se bloquea la cuenta y
        // se cierran sus sesiones (también esta), así una sesión robada no sirve para adivinar la contraseña.
        if (! Hash::check($data['current_password'], $user->password)) {
            AuthController::registrarFallo($user);
            $bloqueada = $user->fresh()->locked_until?->isFuture();
            throw ValidationException::withMessages(['current_password' => [$bloqueada
                ? 'Demasiados intentos: tu cuenta quedó bloqueada y se cerraron tus sesiones.'
                : 'La contraseña actual no es correcta.']]);
        }
        if ($problema = PasswordPolicy::problem($user, $data['password'])) {
            throw ValidationException::withMessages(['password' => [$problema]]);
        }

        PasswordPolicy::store($user, $data['password']);
        Sesiones::cerrando('REVOKED', 'Contraseña cambiada', fn () => $user->tokens()->where('id', '!=', $user->currentAccessToken()->id)->delete());

        Bitacora::registrar('PASSWORD_CHANGED', ['user' => $user, 'entity' => 'users', 'entity_id' => $user->id]);

        return response()->json(['message' => 'Contraseña actualizada.']);
    }

    /** Regla vigente, para mostrarla en el formulario. */
    public function passwordRule()
    {
        return response()->json(['min' => PasswordPolicy::min(), 'rule' => PasswordPolicy::rule()]);
    }
}
