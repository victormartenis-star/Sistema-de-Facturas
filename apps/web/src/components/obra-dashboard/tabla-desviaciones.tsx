import { Fragment } from 'react';
import {
  agruparDesviacionPorCapitulo,
  type DesviacionPartidaDto,
} from '@erp/shared';
import { formatEur } from '@/lib/api';

function Desvio({
  desvio,
  pct,
  sobre,
}: {
  desvio: number;
  pct: number | null;
  sobre: boolean;
}) {
  return (
    <span
      className={`font-medium tabular-nums ${sobre ? 'text-red-700' : 'text-emerald-700'}`}
    >
      {desvio > 0 ? '+' : ''}
      {formatEur(desvio)}
      {pct !== null && (
        <span className="block text-xs font-normal text-gray-400">
          {pct > 0 ? '+' : ''}
          {pct.toFixed(1)} %
        </span>
      )}
    </span>
  );
}

const th = 'px-3 py-2 font-medium';
const tdNum = 'px-3 py-2.5 text-right tabular-nums';

function FilaPartida({
  p,
  sangrada,
}: {
  p: DesviacionPartidaDto;
  sangrada: boolean;
}) {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className={`px-3 py-2.5 ${sangrada ? 'pl-8 text-gray-700' : ''}`}>
        {p.code && (
          <span className="mr-2 font-mono text-xs text-gray-500">{p.code}</span>
        )}
        {p.name}
      </td>
      <td className={tdNum}>{formatEur(p.budget)}</td>
      <td className={tdNum}>{formatEur(p.actual)}</td>
      <td className={tdNum}>
        <Desvio
          desvio={p.deviation}
          pct={p.deviationPct}
          sobre={p.overBudget}
        />
      </td>
    </tr>
  );
}

/**
 * Desviación frente a presupuesto. Por capítulo (prefijo del código
 * `capítulo.partida`) si todos los códigos siguen esa forma; si no, por partida.
 */
export function TablaDesviaciones({
  filas,
  totalPresupuestado,
  totalReal,
}: {
  filas: DesviacionPartidaDto[];
  totalPresupuestado: number;
  totalReal: number;
}) {
  if (filas.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-500">
        La obra no tiene partidas ni costes imputados.
      </p>
    );
  }
  const capitulos = agruparDesviacionPorCapitulo(filas);
  const porPartida = [...filas].sort((a, b) => {
    if ((a.phaseId === null) !== (b.phaseId === null))
      return a.phaseId === null ? 1 : -1;
    return b.deviation - a.deviation;
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Desviación presupuestaria">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase">
            <th className={th}>
              {capitulos ? 'Capítulo / partida' : 'Partida'}
            </th>
            <th className={`${th} text-right`}>Presupuesto</th>
            <th className={`${th} text-right`}>Real</th>
            <th className={`${th} text-right`}>Desvío</th>
          </tr>
        </thead>
        <tbody>
          {capitulos
            ? capitulos.map((c) => (
                <Fragment key={c.capitulo}>
                  <tr className="border-b border-gray-100 bg-gray-50/60 font-semibold">
                    <td className="px-3 py-2.5">
                      {c.capitulo === 'Sin partida'
                        ? c.capitulo
                        : `Capítulo ${c.capitulo}`}
                    </td>
                    <td className={tdNum}>{formatEur(c.budget)}</td>
                    <td className={tdNum}>{formatEur(c.actual)}</td>
                    <td className={tdNum}>
                      <Desvio
                        desvio={c.deviation}
                        pct={c.deviationPct}
                        sobre={c.overBudget}
                      />
                    </td>
                  </tr>
                  {c.partidas.map((p) => (
                    <FilaPartida
                      key={p.phaseId ?? 'sin-partida'}
                      p={p}
                      sangrada
                    />
                  ))}
                </Fragment>
              ))
            : porPartida.map((p) => (
                <FilaPartida
                  key={p.phaseId ?? 'sin-partida'}
                  p={p}
                  sangrada={false}
                />
              ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200 font-semibold">
            <td className="px-3 py-2.5">Total</td>
            <td className={tdNum}>{formatEur(totalPresupuestado)}</td>
            <td className={tdNum}>{formatEur(totalReal)}</td>
            <td className="px-3 py-2.5" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
