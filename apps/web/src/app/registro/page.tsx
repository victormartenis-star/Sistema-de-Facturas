import { AuthCard, AuthSwitchLink } from '@/components/auth-ui';

/**
 * El registro público está cerrado: las cuentas las crea un administrador
 * desde Configuración > Usuarios (el primer admin se crea por bootstrap).
 */
export default function RegisterPage() {
  return (
    <AuthCard
      title="Registro cerrado"
      subtitle="El registro público está cerrado"
      footer={
        <AuthSwitchLink
          prompt="¿Ya tienes cuenta?"
          href="/login"
          label="Iniciar sesión"
        />
      }
    >
      <p className="text-sm text-gray-600">
        Pide a un administrador que cree tu cuenta.
      </p>
    </AuthCard>
  );
}
