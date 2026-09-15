'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { BankAccountCreateInput, BankAccountKind } from '@erp/shared';
import { BANK_ACCOUNT_KIND_LABELS } from '@erp/shared';
import { formatEur, treasuryApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconPlus, IconWallet } from '@/components/icons';
import {
  ErrorBanner,
  Modal,
  btnPrimaryCls,
  fieldCls,
  labelCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

export function BankAccountsPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<BankAccountKind>('banco');
  const [currentBalance, setCurrentBalance] = useState('0');

  const accountsQuery = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => treasuryApi.listBankAccounts(),
  });

  const createMutation = useMutation({
    mutationFn: (input: BankAccountCreateInput) =>
      treasuryApi.createBankAccount(input),
    onSuccess: () => {
      toast('Cuenta creada', 'success');
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['illiquidity-projection'] });
      setOpen(false);
      setName('');
      setCurrentBalance('0');
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Cuentas bancarias y caja</h2>
        <button
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50"
          onClick={() => setOpen(true)}
        >
          <IconPlus size={13} /> Nueva
        </button>
      </div>
      {accountsQuery.error && (
        <ErrorBanner message={errText(accountsQuery.error)} />
      )}
      {accountsQuery.data?.length === 0 && (
        <p className="text-sm text-gray-400">
          Sin cuentas dadas de alta — la proyección de iliquidez parte de saldo
          0.
        </p>
      )}
      <div className="divide-y divide-gray-100">
        {accountsQuery.data?.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <IconWallet size={14} className="text-gray-400" />
              <span>{a.name}</span>
              <span className="text-xs text-gray-400">
                {BANK_ACCOUNT_KIND_LABELS[a.kind]}
              </span>
            </div>
            <span className="font-medium tabular-nums">
              {formatEur(a.currentBalance)}
            </span>
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Nueva cuenta">
        <div className="space-y-3">
          <div className={fieldCls}>
            <label className={labelCls}>Nombre</label>
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Tipo</label>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as BankAccountKind)}
            >
              {Object.entries(BANK_ACCOUNT_KIND_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Saldo actual</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={currentBalance}
              onChange={(e) => setCurrentBalance(e.target.value)}
            />
          </div>
          <button
            className={`${btnPrimaryCls} w-full justify-center`}
            disabled={!name.trim() || createMutation.isPending}
            onClick={() =>
              createMutation.mutate({
                name: name.trim(),
                kind,
                currentBalance: Number(currentBalance) || 0,
                isActive: true,
              })
            }
          >
            Crear cuenta
          </button>
        </div>
      </Modal>
    </section>
  );
}
