import { describe, expect, it } from 'vitest';
import {
  isPortalRole,
  isReadOnlyRole,
  USER_ROLE_LABELS,
  USER_ROLES,
  userCreateSchema,
  userUpdateSchema,
} from './auth';

describe('rol lector', () => {
  it('está en USER_ROLES y conserva los 6 roles anteriores', () => {
    expect([...USER_ROLES]).toEqual([
      'admin',
      'gerente',
      'administracion',
      'obra',
      'subcontrata',
      'cliente',
      'lector',
    ]);
    expect(USER_ROLE_LABELS.lector).toBe('Lector (solo lectura)');
  });

  it('isReadOnlyRole solo es true para lector', () => {
    for (const role of USER_ROLES) {
      expect(isReadOnlyRole(role)).toBe(role === 'lector');
    }
  });

  it('lector no es un rol de portal', () => {
    expect(isPortalRole('lector')).toBe(false);
  });

  it('los esquemas de alta y edición de usuario aceptan role lector', () => {
    expect(
      userCreateSchema.safeParse({
        email: 'lector@test.dintel.es',
        password: 'Test1234!',
        fullName: 'Lector',
        role: 'lector',
      }).success,
    ).toBe(true);
    expect(userUpdateSchema.safeParse({ role: 'lector' }).success).toBe(true);
  });
});
