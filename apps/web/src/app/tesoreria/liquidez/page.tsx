'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CATEGORIAS_LIQUIDEZ, CATEGORIA_LIQUIDEZ_LABELS } from '@erp/shared';
import {
  bancaApi,
  formatDate,
  formatEur,
  projectsApi,
  treasuryApi,
} from '@/lib/api';
import { ErrorBanner, PageHeader, inputCls, selectCls } from '@/components/ui';

const hoy = () => new Date().toISOString().slice(0, 10);

/** Previsión de liquidez por horizontes, categorías y semanas. */
export default function LiquidezPage() {
  const [desde, setDesde] = useState(hoy);
  const [horizontes, setHorizontes] = useState('7,30,60,90');
  const [cuentaId, setCuentaId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [plazoCobro, setPlazoCobro] = useState('60');
  const [plazoPago, setPlazoPago] = useState('60');
  const cuentas = useQuery({
    queryKey: ['treasury', 'cuentas', 'activas'],
    queryFn: () => treasuryApi.listBankAccounts(true),
  });
  const obras = useQuery({
    queryKey: ['projects', 'liquidez'],
    queryFn: () => projectsApi.list('', ''),
  });
  const filtros = {
    desde,
    horizontes,
    bankAccountId: cuentaId || undefined,
    projectId: projectId || undefined,
    plazoCobroDias: Number(plazoCobro) || 0,
    plazoPagoDias: Number(plazoPago) || 0,
  };
  const p = useQuery({
    queryKey: ['treasury', 'liquidez', filtros],
    queryFn: () => bancaApi.liquidez(filtros),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(desde),
  });
  const d = p.data;

  return (
    <div>
      <PageHeader
        title="Previsión de liquidez"
        subtitle="Saldo de bancos (572x sin los talones en tránsito) más cobros y pagos de cartera, talones, certificaciones por facturar, pedidos comprometidos y comisiones de avales."
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <input
          type="date"
          className={inputCls}
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          aria-label="Desde"
        />
        <input
          className={`${inputCls} w-36`}
          value={horizontes}
          onChange={(e) => setHorizontes(e.target.value)}
          aria-label="Horizontes en días"
          title="Días separados por comas"
        />
        <select
          className={selectCls}
          value={cuentaId}
          onChange={(e) => setCuentaId(e.target.value)}
          aria-label="Cuenta"
        >
          <option value="">Consolidado de la empresa</option>
          {(cuentas.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          aria-label="Obra"
        >
          <option value="">Todas las obras</option>
          {(obras.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.code} · {o.name}
            </option>
          ))}
        </select>
        <label className="text-xs text-gray-600">
          Plazo cobro
          <input
            className={`${inputCls} ml-1 w-16`}
            inputMode="numeric"
            value={plazoCobro}
            onChange={(e) => setPlazoCobro(e.target.value)}
          />
        </label>
        <label className="text-xs text-gray-600">
          Plazo pago
          <input
            className={`${inputCls} ml-1 w-16`}
            inputMode="numeric"
            value={plazoPago}
            onChange={(e) => setPlazoPago(e.target.value)}
          />
        </label>
      </div>
      {p.isError && <ErrorBanner message={(p.error as Error).message} />}
      {d && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-white p-3 text-sm shadow-sm">
              <p className="text-xs uppercase text-gray-500">Saldo inicial</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatEur(d.saldoInicial)}
              </p>
              <p className="text-xs text-gray-500">
                {d.fuenteSaldo === 'contable'
                  ? 'Contabilidad: 572x sin 5729'
                  : d.fuenteSaldo === 'cuenta'
                    ? 'Saldo declarado de la cuenta'
                    : 'Por obra: sin saldo de bancos'}
              </p>
            </div>
            <div className="rounded-xl border bg-white p-3 text-sm shadow-sm">
              <p className="text-xs uppercase text-gray-500">
                Talones en tránsito (5729)
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {formatEur(d.saldoTransito5729)}
              </p>
            </div>
            <div className="rounded-xl border bg-white p-3 text-sm shadow-sm">
              <p className="text-xs uppercase text-gray-500">
                Atrasados (proyectados el primer día)
              </p>
              <p className="tabular-nums">
                +{formatEur(d.atrasados.entradas)} / −
                {formatEur(d.atrasados.salidas)}
              </p>
            </div>
          </div>
          <div className="mb-6 overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Concepto</th>
                  {d.horizontes.map((h) => (
                    <th key={h.dias} className="px-3 py-2 text-right">
                      {h.dias} días{' '}
                      <span className="block font-normal">
                        {formatDate(h.hasta)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CATEGORIAS_LIQUIDEZ.map((c) => (
                  <tr key={c} className="border-t border-gray-100">
                    <td className="px-3 py-1.5">
                      {CATEGORIA_LIQUIDEZ_LABELS[c]}
                    </td>
                    {d.horizontes.map((h) => {
                      const v = h.porCategoria[c];
                      const neto = v.entradas - v.salidas;
                      return (
                        <td
                          key={h.dias}
                          className={`px-3 py-1.5 text-right tabular-nums ${neto < 0 ? 'text-red-700' : ''}`}
                        >
                          {neto === 0 ? '—' : formatEur(neto)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t font-semibold">
                  <td className="px-3 py-1.5">Saldo final</td>
                  {d.horizontes.map((h) => (
                    <td
                      key={h.dias}
                      className={`px-3 py-1.5 text-right tabular-nums ${h.saldoFinal < 0 ? 'text-red-700' : ''}`}
                    >
                      {formatEur(h.saldoFinal)}
                    </td>
                  ))}
                </tr>
                <tr className="text-xs text-gray-600">
                  <td className="px-3 py-1.5">Mínimo (fecha)</td>
                  {d.horizontes.map((h) => (
                    <td
                      key={h.dias}
                      className={`px-3 py-1.5 text-right tabular-nums ${h.tension ? 'font-semibold text-red-700' : ''}`}
                    >
                      {formatEur(h.saldoMinimo)} ({formatDate(h.fechaMinimo)})
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <h2 className="mb-2 text-sm font-semibold">Por semanas</h2>
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Semana</th>
                  <th className="px-3 py-2 text-right">Entradas</th>
                  <th className="px-3 py-2 text-right">Salidas</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {d.semanas.map((s) => (
                  <tr key={s.desde} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 tabular-nums">
                      {formatDate(s.desde)} – {formatDate(s.hasta)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(s.entradas)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatEur(s.salidas)}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums ${s.saldo < 0 ? 'font-semibold text-red-700' : ''}`}
                    >
                      {formatEur(s.saldo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Supuestos: certificaciones cobradas a {d.supuestos.plazoCobroDias}{' '}
            días y pedidos pagados a {d.supuestos.plazoPagoDias} días de su
            fecha. Con una cuenta elegida solo cuentan las remesas, talones y
            avales de esa cuenta.
          </p>
        </>
      )}
    </div>
  );
}
