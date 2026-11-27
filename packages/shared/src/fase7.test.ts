import { describe, expect, it } from 'vitest';
import {
  ErrorGrc,
  decidirPaso,
  destinatariosPaso,
  escalarRol,
  evaluarSod,
  nivelesAprobacion,
  pasoVencido,
  rolMaximo,
  validarDelegacion,
  validarNiveles,
  validarPoliticaSod,
  type Delegacion,
} from './grc';
import { can } from './capacidades';
import { transicion } from './maquina-estados';

const codigo = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as ErrorGrc).code;
  }
  return null;
};

const CADENA = [
  { nivel: 1, importeMinimo: 0, rolRequerido: 'administracion' as const },
  {
    nivel: 2,
    importeMinimo: '10000.00',
    rolRequerido: 'gerente' as const,
    plazoHoras: 48,
  },
  {
    nivel: 3,
    importeMinimo: 50000,
    rolRequerido: 'admin' as const,
    aprobadorId: 'u-admin',
  },
];

describe('GRC: niveles de aprobación', () => {
  it('niveles por importe al céntimo, renumerados; sin cadena, un nivel con el rol de la regla', () => {
    expect(
      nivelesAprobacion({
        rolRegla: 'gerente',
        niveles: CADENA,
        importe: '9999.99',
      }),
    ).toEqual([
      {
        nivel: 1,
        rolRequerido: 'administracion',
        aprobadorId: null,
        plazoHoras: null,
      },
    ]);
    expect(
      nivelesAprobacion({
        rolRegla: 'gerente',
        niveles: CADENA,
        importe: 10000,
      }).map((n) => n.rolRequerido),
    ).toEqual(['administracion', 'gerente']);
    expect(
      nivelesAprobacion({
        rolRegla: 'gerente',
        niveles: CADENA,
        importe: 50000,
      })[2],
    ).toEqual({
      nivel: 3,
      rolRequerido: 'admin',
      aprobadorId: 'u-admin',
      plazoHoras: null,
    });
    expect(
      nivelesAprobacion({ rolRegla: 'gerente', niveles: [], importe: 1 }),
    ).toEqual([
      {
        nivel: 1,
        rolRequerido: 'gerente',
        aprobadorId: null,
        plazoHoras: null,
      },
    ]);
  });

  it('cadena coherente: consecutiva, importes y roles que no bajan, plazos positivos', () => {
    expect(() => validarNiveles(CADENA)).not.toThrow();
    expect(codigo(() => validarNiveles([{ ...CADENA[0], nivel: 2 }]))).toBe(
      'APPROVAL_LEVELS_INVALID',
    );
    expect(
      codigo(() => validarNiveles([CADENA[1], { ...CADENA[0], nivel: 2 }])),
    ).toBe('APPROVAL_LEVELS_INVALID');
    expect(
      codigo(() =>
        validarNiveles([CADENA[0], { ...CADENA[1], importeMinimo: -1 }]),
      ),
    ).toBe('APPROVAL_LEVELS_INVALID');
    expect(
      codigo(() =>
        validarNiveles([CADENA[0], { ...CADENA[1], plazoHoras: 0 }]),
      ),
    ).toBe('APPROVAL_LEVELS_INVALID');
    expect(rolMaximo(['administracion', 'admin', 'gerente'])).toBe('admin');
    expect(escalarRol('administracion')).toBe('gerente');
    expect(escalarRol('admin')).toBeNull();
    expect(
      pasoVencido('2026-11-26T10:00:00.000Z', '2026-11-26T10:00:00.001Z'),
    ).toBe(true);
    expect(pasoVencido(null, '2099-01-01T00:00:00.000Z')).toBe(false);
  });

  it('máquina de estados del paso', () => {
    expect(transicion('approval_step', 'en_espera', 'activo')).toBe('activo');
    expect(transicion('approval_step', 'activo', 'aprobado')).toBe('aprobado');
    expect(() =>
      transicion('approval_step', 'en_espera', 'aprobado'),
    ).toThrow();
    expect(() =>
      transicion('approval_step', 'aprobado', 'cancelado'),
    ).toThrow();
  });
});

describe('GRC: decisión, delegación y segregación de funciones', () => {
  const hoy = '2026-11-26';
  const delegaciones: Delegacion[] = [
    {
      delegante: { id: 'g1', rol: 'gerente' },
      delegadoId: 'a1',
      desde: '2026-11-20',
      hasta: '2026-11-30',
      activa: true,
    },
    {
      delegante: { id: 'g2', rol: 'gerente' },
      delegadoId: 'a1',
      desde: '2026-12-01',
      hasta: '2026-12-31',
      activa: true,
    },
  ];
  const base = {
    paso: { rolRequerido: 'gerente' as const, aprobadorId: null },
    solicitanteId: 's1',
    creadorId: 'c1',
    aprobadoresPrevios: [] as string[],
    delegaciones,
    hoy,
    politica: {},
  };

  it('por rol, por delegación vigente (en nombre de) y sin rol suficiente', () => {
    expect(
      decidirPaso({ ...base, usuario: { id: 'g3', rol: 'gerente' } }),
    ).toMatchObject({ impedimento: null, enNombreDe: null });
    expect(
      decidirPaso({ ...base, usuario: { id: 'a1', rol: 'administracion' } }),
    ).toMatchObject({ impedimento: null, enNombreDe: 'g1' });
    expect(
      decidirPaso({ ...base, usuario: { id: 'a2', rol: 'administracion' } })
        .impedimento,
    ).toBe('APPROVAL_ROLE_INSUFFICIENT');
    expect(
      decidirPaso({
        ...base,
        hoy: '2026-12-31',
        usuario: { id: 'a1', rol: 'administracion' },
      }).enNombreDe,
    ).toBe('g2');
    expect(
      decidirPaso({
        ...base,
        hoy: '2027-01-01',
        usuario: { id: 'a1', rol: 'administracion' },
      }).impedimento,
    ).toBe('APPROVAL_ROLE_INSUFFICIENT');
  });

  it('aprobador asignado: solo él o su delegado', () => {
    const asignado = {
      ...base,
      paso: { rolRequerido: 'gerente' as const, aprobadorId: 'g1' },
    };
    expect(
      decidirPaso({ ...asignado, usuario: { id: 'g3', rol: 'admin' } })
        .impedimento,
    ).toBe('APPROVAL_NOT_ASSIGNEE');
    expect(
      decidirPaso({ ...asignado, usuario: { id: 'a1', rol: 'administracion' } })
        .enNombreDe,
    ).toBe('g1');
  });

  it('SoD: solicitante y mismo aprobador bloquean siempre; creador según política', () => {
    expect(
      decidirPaso({ ...base, usuario: { id: 's1', rol: 'admin' } }).impedimento,
    ).toBe('SOD_CONFLICT');
    // El delegado de un aprobador previo tampoco puede firmar otro nivel.
    expect(
      decidirPaso({
        ...base,
        aprobadoresPrevios: ['g1'],
        usuario: { id: 'a1', rol: 'administracion' },
      }).sod.conflictos,
    ).toEqual([{ conflicto: 'mismo_aprobador_niveles', modo: 'bloquear' }]);
    const creador = { ...base, usuario: { id: 'c1', rol: 'gerente' } };
    expect(decidirPaso(creador)).toMatchObject({
      impedimento: null,
      sod: {
        excepciones: [
          {
            conflicto: 'creador_aprueba',
            modo: 'auditar',
            justificacion: null,
          },
        ],
      },
    });
    expect(
      decidirPaso({ ...creador, politica: { creador_aprueba: 'bloquear' } })
        .impedimento,
    ).toBe('SOD_CONFLICT');
    expect(
      decidirPaso({ ...creador, politica: { creador_aprueba: 'justificar' } })
        .impedimento,
    ).toBe('SOD_JUSTIFICATION_REQUIRED');
    expect(
      decidirPaso({
        ...creador,
        politica: { creador_aprueba: 'justificar' },
        justificacion: 'Único gerente de guardia',
      }),
    ).toMatchObject({
      impedimento: null,
      sod: {
        excepciones: [
          {
            conflicto: 'creador_aprueba',
            modo: 'justificar',
            justificacion: 'Único gerente de guardia',
          },
        ],
      },
    });
  });

  it('políticas: los conflictos fijos no se relajan; evaluar sin conflictos', () => {
    expect(
      codigo(() => validarPoliticaSod('solicitante_aprueba', 'auditar')),
    ).toBe('SOD_POLICY_LOCKED');
    expect(() =>
      validarPoliticaSod('aprobador_paga', 'justificar'),
    ).not.toThrow();
    expect(evaluarSod({ detectados: [], politica: {} })).toEqual({
      bloqueo: null,
      conflictos: [],
      excepciones: [],
    });
    expect(
      evaluarSod({
        detectados: ['solicitante_aprueba'],
        politica: { solicitante_aprueba: 'auditar' },
      }).bloqueo,
    ).toBe('SOD_CONFLICT');
  });

  it('delegaciones: sin autodelegación, fechas ni solapes', () => {
    expect(
      codigo(() =>
        validarDelegacion(
          { deleganteId: 'g1', delegadoId: 'g1', desde: hoy, hasta: hoy },
          [],
        ),
      ),
    ).toBe('APPROVAL_DELEGATION_INVALID');
    expect(
      codigo(() =>
        validarDelegacion(
          {
            deleganteId: 'g1',
            delegadoId: 'a1',
            desde: hoy,
            hasta: '2026-11-01',
          },
          [],
        ),
      ),
    ).toBe('APPROVAL_DELEGATION_INVALID');
    expect(
      codigo(() =>
        validarDelegacion(
          {
            deleganteId: 'g1',
            delegadoId: 'a1',
            desde: '2026-11-25',
            hasta: '2026-12-05',
          },
          [{ desde: '2026-12-01', hasta: '2026-12-10', activa: true }],
        ),
      ),
    ).toBe('APPROVAL_DELEGATION_OVERLAP');
    expect(() =>
      validarDelegacion(
        {
          deleganteId: 'g1',
          delegadoId: 'a1',
          desde: '2026-11-25',
          hasta: '2026-12-05',
        },
        [{ desde: '2026-12-01', hasta: '2026-12-10', activa: false }],
      ),
    ).not.toThrow();
  });
});

describe('GRC: destinatarios dirigidos', () => {
  const usuarios = [
    { id: 'adm', rol: 'admin', activo: true },
    { id: 'g1', rol: 'gerente', activo: true },
    { id: 'g-baja', rol: 'gerente', activo: false },
    { id: 'a1', rol: 'administracion', activo: true },
    { id: 'lec', rol: 'lector', activo: true },
    { id: 'obr', rol: 'obra', activo: true },
  ];
  it('solo quien puede decidir y sus delegados, sin excluidos ni difusión', () => {
    expect(
      destinatariosPaso({
        paso: { rolRequerido: 'gerente', aprobadorId: null },
        usuarios,
        delegaciones: [],
        hoy: '2026-11-26',
      }),
    ).toEqual(['adm', 'g1']);
    expect(
      destinatariosPaso({
        paso: { rolRequerido: 'gerente', aprobadorId: null },
        usuarios,
        delegaciones: [
          {
            delegante: { id: 'g1', rol: 'gerente' },
            delegadoId: 'a1',
            desde: '2026-11-01',
            hasta: '2026-11-30',
            activa: true,
          },
        ],
        hoy: '2026-11-26',
        excluir: ['adm'],
      }),
    ).toEqual(['a1', 'g1']);
    expect(
      destinatariosPaso({
        paso: { rolRequerido: 'administracion', aprobadorId: 'g1' },
        usuarios,
        delegaciones: [],
        hoy: '2026-11-26',
      }),
    ).toEqual(['g1']);
  });

  it('permisos: gobierno restringido', () => {
    expect(can('gerente', 'editar', 'gobierno')).toBe(true);
    expect(can('obra', 'editar', 'gobierno')).toBe(false);
  });
});
