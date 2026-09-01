import { describe, expect, it } from 'vitest';
import {
  REQUIRED_WORKER_DOCS,
  assessWorker,
  daysToNextExpiry,
  nextExpiry,
  type WorkerDocState,
  type WorkerState,
} from './workers';

const HOY = '2026-06-15';

/** Los cinco documentos exigibles, todos vigentes hasta bien lejos. */
const docsCompletos = (): WorkerDocState[] =>
  REQUIRED_WORKER_DOCS.map((docType) => ({
    docType,
    expiresAt: '2027-12-31',
    rejected: false,
  }));

const trabajador = (over: Partial<WorkerState> = {}): WorkerState => ({
  isActive: true,
  docs: docsCompletos(),
  companyBlocked: false,
  ...over,
});

describe('assessWorker', () => {
  it('con los cinco documentos al día, entra', () => {
    const a = assessWorker(trabajador(), HOY);
    expect(a.allowed).toBe(true);
    expect(a.status).toBe('autorizado');
    expect(a.missing).toEqual([]);
    expect(a.reasons).toEqual([]);
  });

  it('si falta cualquiera de los cinco, no entra', () => {
    for (const falta of REQUIRED_WORKER_DOCS) {
      const docs = docsCompletos().filter((d) => d.docType !== falta);
      const a = assessWorker(trabajador({ docs }), HOY);
      expect(a.allowed).toBe(false);
      expect(a.missing).toEqual([falta]);
    }
  });

  it('un documento caducado cuenta como ausente, no como aviso', () => {
    // El día que vence la aptitud médica, esa persona deja de poder entrar.
    const docs = docsCompletos().map((d) =>
      d.docType === 'aptitud_medica' ? { ...d, expiresAt: '2026-06-14' } : d,
    );
    const a = assessWorker(trabajador({ docs }), HOY);
    expect(a.allowed).toBe(false);
    expect(a.missing).toEqual(['aptitud_medica']);
    expect(a.expiring).toEqual([]);
  });

  it('un documento rechazado también invalida', () => {
    const docs = docsCompletos().map((d) =>
      d.docType === 'alta_ss' ? { ...d, rejected: true } : d,
    );
    expect(assessWorker(trabajador({ docs }), HOY).allowed).toBe(false);
  });

  it('lo que caduca pronto avisa pero deja entrar', () => {
    const docs = docsCompletos().map((d) =>
      d.docType === 'formacion_prl' ? { ...d, expiresAt: '2026-07-01' } : d,
    );
    const a = assessWorker(trabajador({ docs }), HOY);
    expect(a.allowed).toBe(true);
    expect(a.status).toBe('con_avisos');
    expect(a.expiring).toEqual(['formacion_prl']);
  });

  it('un documento sin caducidad se considera permanente', () => {
    const docs = docsCompletos().map((d) =>
      d.docType === 'entrega_epi' ? { ...d, expiresAt: null } : d,
    );
    expect(assessWorker(trabajador({ docs }), HOY).allowed).toBe(true);
  });

  it('si la empresa está bloqueada, el trabajador no entra', () => {
    // La responsabilidad es solidaria: el problema no es suyo, pero tampoco
    // se resuelve dejándole pasar.
    const a = assessWorker(trabajador({ companyBlocked: true }), HOY);
    expect(a.allowed).toBe(false);
    expect(a.reasons[0]).toContain('Su empresa no está homologada');
    // Su documentación sigue estando bien: no se le imputa a él
    expect(a.missing).toEqual([]);
  });

  it('un trabajador de baja no entra, aunque tenga todo', () => {
    const a = assessWorker(trabajador({ isActive: false }), HOY);
    expect(a.status).toBe('baja');
    expect(a.allowed).toBe(false);
  });

  it('un trabajador sin ningún documento lista los cinco que faltan', () => {
    const a = assessWorker(trabajador({ docs: [] }), HOY);
    expect(a.missing).toHaveLength(5);
    expect(a.allowed).toBe(false);
  });

  it('los documentos no exigibles no influyen', () => {
    const docs = [
      ...docsCompletos(),
      { docType: 'otro' as const, expiresAt: '2020-01-01', rejected: true },
    ];
    expect(assessWorker(trabajador({ docs }), HOY).allowed).toBe(true);
  });
});

describe('próxima caducidad', () => {
  it('devuelve la fecha más cercana de los exigibles', () => {
    const docs = docsCompletos().map((d) =>
      d.docType === 'aptitud_medica' ? { ...d, expiresAt: '2026-09-30' } : d,
    );
    expect(nextExpiry(docs)).toBe('2026-09-30');
    expect(daysToNextExpiry(docs, HOY)).toBe(107);
  });

  it('ignora los documentos que no son exigibles', () => {
    const docs: WorkerDocState[] = [
      ...docsCompletos(),
      { docType: 'otro', expiresAt: '2026-06-20', rejected: false },
    ];
    expect(nextExpiry(docs)).toBe('2027-12-31');
  });

  it('sin fechas de caducidad no se pronuncia', () => {
    expect(nextExpiry([])).toBeNull();
    expect(daysToNextExpiry([], HOY)).toBeNull();
  });
});
