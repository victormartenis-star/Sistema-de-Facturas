import type { RetencionesLadoDto, RetencionesObraDto } from '@erp/shared';
import { formatDate, formatEur } from '@/lib/api';

function Lado({ titulo, l }: { titulo: string; l: RetencionesLadoDto }) {
  const filas: [string, string, boolean][] = [
    ['Retenido', formatEur(l.retenido), false],
    ['Liberado', formatEur(l.liberado), false],
    ['Pendiente', formatEur(l.pendiente), false],
    ['Vencido', formatEur(l.vencido), l.vencido > 0],
    [
      'Próxima liberación',
      l.proximaLiberacion ? formatDate(l.proximaLiberacion) : '—',
      false,
    ],
  ];
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
        {titulo}
      </h3>
      <dl className="space-y-1.5 text-sm">
        {filas.map(([k, v, aviso]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-gray-500">{k}</dt>
            <dd
              className={`font-medium tabular-nums ${aviso ? 'text-red-700' : ''}`}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function PanelRetenciones({ r }: { r: RetencionesObraDto }) {
  return (
    <div>
      <div className="grid gap-6 sm:grid-cols-2">
        <Lado titulo="A cobrar del cliente" l={r.aCobrarDeCliente} />
        <Lado titulo="A pagar a proveedores" l={r.aPagarAProveedores} />
      </div>
      <p className="mt-4 flex justify-between border-t border-gray-100 pt-3 text-sm font-semibold">
        <span>Saldo (pendiente a cobrar − a pagar)</span>
        <span className="tabular-nums">{formatEur(r.saldo)}</span>
      </p>
    </div>
  );
}
