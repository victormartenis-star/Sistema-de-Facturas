'use client';

/**
 * Página /tesoreria/conciliacion
 *
 * Conciliación bancaria asistida (Fase 14): sube un extracto (CSV o
 * Norma 43), la API sugiere qué `payment_milestones` cuadra cada
 * movimiento por importe + sentido + fecha cercana — nunca conciliada
 * automáticamente, aquí solo se confirma o se elige a mano.
 */

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BankAccountDto, BankTransactionDto } from '@erp/shared';
import {
  bankReconciliationApi,
  formatDate,
  formatEur,
  treasuryApi,
  type BankTransactionSuggestionDto,
} from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconCheck, IconUpload, IconWallet, IconX } from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  TableSkeleton,
  btnGhostCls,
  btnPrimaryCls,
  selectCls,
} from '@/components/ui';

const CONFIDENCE_STYLES: Record<string, string> = {
  alta: 'bg-emerald-100 text-emerald-700',
  media: 'bg-amber-100 text-amber-700',
  baja: 'bg-gray-100 text-gray-600',
};

function ImportPanel({
  bankAccountId,
  disabled,
}: {
  bankAccountId: string;
  disabled: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState<'csv' | 'norma43'>('csv');
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      bankReconciliationApi.import(bankAccountId, format, file!),
    onSuccess: (res) => {
      toast(
        `${res.imported} movimiento${res.imported !== 1 ? 's' : ''} nuevo${res.imported !== 1 ? 's' : ''}` +
          (res.duplicates > 0 ? ` · ${res.duplicates} ya importado(s)` : ''),
        'success',
      );
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['bank-transactions', bankAccountId] });
      qc.invalidateQueries({ queryKey: ['bank-suggestions', bankAccountId] });
    },
    onError: (err) => toast((err as Error).message, 'error'),
  });

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Formato del extracto
        </label>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as 'csv' | 'norma43')}
          className={selectCls}
          disabled={disabled}
        >
          <option value="csv">CSV</option>
          <option value="norma43">Norma 43 (AEB43)</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Fichero
        </label>
        <input
          ref={fileRef}
          type="file"
          accept={format === 'csv' ? '.csv,text/csv' : '.txt,.43'}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={disabled}
          className="block text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-200"
        />
      </div>
      <button
        onClick={() => mutation.mutate()}
        disabled={disabled || !file || mutation.isPending}
        className={btnPrimaryCls}
      >
        <IconUpload size={14} />
        {mutation.isPending ? 'Importando…' : 'Importar'}
      </button>
    </div>
  );
}

function ReconcileCell({
  transaction,
  suggestion,
}: {
  transaction: BankTransactionDto;
  suggestion: BankTransactionSuggestionDto | undefined;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const milestonesQuery = useQuery({
    queryKey: ['treasury-milestones', 'previsto'],
    queryFn: () => treasuryApi.milestones({ status: 'previsto' }),
    staleTime: 30_000,
  });
  const [manualId, setManualId] = useState('');

  const reconcile = useMutation({
    mutationFn: (milestoneId: string) =>
      bankReconciliationApi.reconcile(transaction.id, milestoneId),
    onSuccess: () => {
      toast('Movimiento conciliado', 'success');
      qc.invalidateQueries({ queryKey: ['bank-transactions'] });
      qc.invalidateQueries({ queryKey: ['bank-suggestions'] });
      qc.invalidateQueries({ queryKey: ['treasury-milestones'] });
    },
    onError: (err) => toast((err as Error).message, 'error'),
  });

  const unreconcile = useMutation({
    mutationFn: () => bankReconciliationApi.unreconcile(transaction.id),
    onSuccess: () => {
      toast('Movimiento desconciliado', 'success');
      qc.invalidateQueries({ queryKey: ['bank-transactions'] });
      qc.invalidateQueries({ queryKey: ['bank-suggestions'] });
    },
    onError: (err) => toast((err as Error).message, 'error'),
  });

  if (transaction.reconciledMilestoneId) {
    return (
      <button
        onClick={() => unreconcile.mutate()}
        disabled={unreconcile.isPending}
        className={btnGhostCls}
        title="Desconciliar"
      >
        <IconX size={13} />
        Desconciliar
      </button>
    );
  }

  const candidates = suggestion?.candidates ?? [];
  const milestones = milestonesQuery.data ?? [];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {candidates.slice(0, 2).map((c) => {
        const milestone = milestones.find((m) => m.id === c.milestoneId);
        return (
          <button
            key={c.milestoneId}
            onClick={() => reconcile.mutate(c.milestoneId)}
            disabled={reconcile.isPending}
            title={
              milestone
                ? `${milestone.invoiceNumber} — ${milestone.contactName}`
                : undefined
            }
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${CONFIDENCE_STYLES[c.confidence]} hover:opacity-80`}
          >
            <IconCheck size={12} />
            {milestone
              ? `${formatEur(milestone.amount)} (${formatDate(milestone.dueDate)})`
              : 'Vencimiento'}
          </button>
        );
      })}
      <select
        value={manualId}
        onChange={(e) => {
          const id = e.target.value;
          setManualId('');
          if (id) reconcile.mutate(id);
        }}
        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-500"
      >
        <option value="">
          {candidates.length > 0 ? 'Elegir otro…' : 'Elegir a mano…'}
        </option>
        {milestones.map((m) => (
          <option key={m.id} value={m.id}>
            {m.invoiceNumber} · {m.contactName} · {formatEur(m.amount)} ·{' '}
            {formatDate(m.dueDate)}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function ConciliacionPage() {
  const [bankAccountId, setBankAccountId] = useState('');
  const [onlyPending, setOnlyPending] = useState(true);

  const accountsQuery = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => treasuryApi.listBankAccounts(true),
    staleTime: 60_000,
  });
  const accounts: BankAccountDto[] = accountsQuery.data ?? [];
  const activeAccountId = bankAccountId || accounts[0]?.id || '';

  const transactionsQuery = useQuery({
    queryKey: ['bank-transactions', activeAccountId, onlyPending],
    queryFn: () =>
      bankReconciliationApi.list(
        activeAccountId,
        onlyPending ? false : undefined,
      ),
    enabled: Boolean(activeAccountId),
  });
  const suggestionsQuery = useQuery({
    queryKey: ['bank-suggestions', activeAccountId],
    queryFn: () => bankReconciliationApi.suggestions(activeAccountId),
    enabled: Boolean(activeAccountId),
    staleTime: 15_000,
  });
  const suggestionsByTx = new Map(
    (suggestionsQuery.data ?? []).map((s) => [s.transactionId, s]),
  );

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Conciliación bancaria"
        subtitle="Importa un extracto y cuadra cada movimiento contra un vencimiento — asistida, nunca automática"
      />

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={activeAccountId}
          onChange={(e) => setBankAccountId(e.target.value)}
          className={selectCls + ' min-w-[220px]'}
        >
          {accounts.length === 0 && (
            <option value="">Sin cuentas activas</option>
          )}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} {a.iban ? `(${a.iban})` : ''}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(e) => setOnlyPending(e.target.checked)}
          />
          Solo pendientes de conciliar
        </label>
      </div>

      {!activeAccountId && !accountsQuery.isLoading && (
        <EmptyState
          icon={<IconWallet size={40} />}
          title="Sin cuentas bancarias"
        >
          <p className="text-sm text-gray-500">
            Da de alta una cuenta en Tesorería antes de importar un extracto.
          </p>
        </EmptyState>
      )}

      {activeAccountId && (
        <>
          <ImportPanel bankAccountId={activeAccountId} disabled={false} />

          {transactionsQuery.isLoading && <TableSkeleton rows={5} />}
          {transactionsQuery.error && (
            <ErrorBanner message={(transactionsQuery.error as Error).message} />
          )}

          {!transactionsQuery.isLoading &&
            (transactionsQuery.data ?? []).length === 0 && (
              <EmptyState
                icon={<IconWallet size={40} />}
                title="Sin movimientos"
              >
                <p className="text-sm text-gray-500">
                  Importa un extracto para empezar a conciliar.
                </p>
              </EmptyState>
            )}

          {(transactionsQuery.data ?? []).length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs font-semibold tracking-wider text-gray-500 uppercase">
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Concepto</th>
                    <th className="px-4 py-3 text-right">Importe</th>
                    <th className="px-4 py-3">Conciliación</th>
                  </tr>
                </thead>
                <tbody>
                  {(transactionsQuery.data ?? []).map((tx) => (
                    <tr
                      key={tx.id}
                      className="border-b border-gray-50 hover:bg-gray-50/40"
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                        {formatDate(tx.transactionDate)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{tx.concept}</td>
                      <td
                        className={`px-4 py-3 text-right font-medium tabular-nums ${
                          tx.amount >= 0 ? 'text-emerald-700' : 'text-gray-900'
                        }`}
                      >
                        {formatEur(tx.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <ReconcileCell
                          transaction={tx}
                          suggestion={suggestionsByTx.get(tx.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
