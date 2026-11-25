/** Lote o serie tal como lo admite la API (`loteIndicadoSchema`). */
interface LoteIndicado {
  codigo: string;
  cantidad: number;
  caducidad?: string;
}

/**
 * Lotes escritos en una línea de movimiento: «codigo:cantidad[:caducidad]»
 * separados por coma, punto y coma o salto de línea; sin cantidad (series)
 * cuenta 1. Admite coma decimal en la cantidad («2,5»). Vacío: sin lotes
 * (en salidas, la API asigna por FEFO).
 */
export function parseLotes(
  texto: string | undefined,
): LoteIndicado[] | undefined {
  const partes = (texto ?? '')
    .split(/[\n;]|,(?!\d)/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (partes.length === 0) return undefined;
  return partes.map((p) => {
    const [codigo, cantidad, caducidad] = p.split(':').map((x) => x.trim());
    return {
      codigo,
      cantidad: cantidad ? Number(cantidad.replace(',', '.')) : 1,
      ...(caducidad ? { caducidad } : {}),
    };
  });
}
