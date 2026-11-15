import { useEffect, useRef } from 'react';
import { nuevoUuid } from './api-error';

/**
 * Clave de idempotencia por intento de envío. Se genera una vez y se reutiliza
 * en reintentos y dobles clics hasta llamar a `renovar()` (tras un éxito o al
 * reabrir el formulario).
 */
export interface ClaveIntento {
  actual: () => string;
  renovar: () => string;
}

export function crearClaveIntento(
  generar: () => string = nuevoUuid,
): ClaveIntento {
  let clave = generar();
  return {
    actual: () => clave,
    renovar: () => (clave = generar()),
  };
}

/** Hook: renueva la clave cada vez que el formulario pasa a abierto. */
export function useClaveIntento(abierto: boolean): ClaveIntento {
  const ref = useRef<ClaveIntento | null>(null);
  if (ref.current === null) ref.current = crearClaveIntento();
  const intento = ref.current;
  const estabaAbierto = useRef(abierto);
  useEffect(() => {
    if (abierto && !estabaAbierto.current) intento.renovar();
    estabaAbierto.current = abierto;
  }, [abierto, intento]);
  return intento;
}
