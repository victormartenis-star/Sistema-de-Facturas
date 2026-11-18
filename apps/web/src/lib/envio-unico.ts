/**
 * Guarda de envío único para formularios. Un doble clic llega antes de que
 * React pinte el estado `saving` (y el botón se deshabilite), así que la
 * protección tiene que vivir en el propio manejador de envío.
 *
 * `intentar()` devuelve `true` solo para el primer envío; los siguientes
 * devuelven `false` hasta que `liberar()` se llama (al terminar la mutación,
 * con éxito o con error).
 */
export interface GuardaEnvio {
  intentar(): boolean;
  liberar(): void;
  enCurso(): boolean;
}

export function crearGuardaEnvio(): GuardaEnvio {
  let abierto = false;
  return {
    intentar() {
      if (abierto) return false;
      abierto = true;
      return true;
    },
    liberar() {
      abierto = false;
    },
    enCurso() {
      return abierto;
    },
  };
}
