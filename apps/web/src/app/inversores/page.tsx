'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CASHFLOW_DIRECTION_LABELS,
  INVESTMENT_ACCOUNT_STATUS_LABELS,
  INVESTOR_KIND_LABELS,
  type InvestmentAccountDto,
  type InvestorDto,
} from '@erp/shared';
import { formatDate, formatEur, investorsApi, projectsApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconPercent, IconPlus, IconTrendingUp } from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  TableSkeleton,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  labelCls,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

export default function InversoresPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  const [newInvestorOpen, setNewInvestorOpen] = useState(false);
  const [newAccountOpen, setNewAccountOpen] = useState(false);

  const investorsQuery = useQuery({
    queryKey: ['investors'],
    queryFn: () => investorsApi.listInvestors(),
  });
  const accountsQuery = useQuery({
    queryKey: ['investment-accounts'],
    queryFn: () => investorsApi.listAccounts(),
  });

  return (
    <div>
      <PageHeader
        title="Inversores"
        subtitle="Cuentas en participación, aportaciones, reparto de dividendos y TIR/VAN"
      >
        <button
          className={btnGhostCls}
          onClick={() => setNewInvestorOpen(true)}
        >
          <IconPlus size={14} /> Inversor
        </button>
        <button
          className={btnPrimaryCls}
          onClick={() => setNewAccountOpen(true)}
        >
          <IconPlus size={14} /> Cuenta
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          {/* Inversores */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">Inversores</h2>
            {investorsQuery.isLoading && <TableSkeleton rows={3} />}
            <ul className="space-y-1">
              {investorsQuery.data?.map((inv) => (
                <li key={inv.id} className="text-sm">
                  <span className="font-medium">{inv.legalName}</span>
                  <span className="ml-1 text-xs text-gray-400">
                    ({INVESTOR_KIND_LABELS[inv.kind]})
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Cuentas */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">Cuentas</h2>
            {accountsQuery.isLoading && <TableSkeleton rows={3} />}
            {accountsQuery.error && (
              <ErrorBanner message={errText(accountsQuery.error)} />
            )}
            <div className="space-y-1">
              {accountsQuery.data?.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => setSelectedAccountId(acc.id)}
                  className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm ${
                    selectedAccountId === acc.id
                      ? 'bg-amber-50 text-amber-700'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <p className="truncate font-medium">{acc.name}</p>
                  <p className="text-xs text-gray-400">
                    {formatEur(acc.committedAmount)} ·{' '}
                    {acc.totalParticipationPct}%
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          {!selectedAccountId && (
            <EmptyState
              icon={<IconTrendingUp size={24} />}
              title="Elige una cuenta"
            >
              Selecciona una cuenta en participación para ver sus inversores,
              movimientos e informe.
            </EmptyState>
          )}
          {selectedAccountId && (
            <AccountDetail
              accountId={selectedAccountId}
              investors={investorsQuery.data ?? []}
            />
          )}
        </div>
      </div>

      <NewInvestorModal
        open={newInvestorOpen}
        onClose={() => setNewInvestorOpen(false)}
      />
      <NewAccountModal
        open={newAccountOpen}
        onClose={() => setNewAccountOpen(false)}
        onCreated={(id) => setSelectedAccountId(id)}
      />
    </div>
  );

  function NewInvestorModal({
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  }) {
    const [legalName, setLegalName] = useState('');
    const mutation = useMutation({
      mutationFn: () =>
        investorsApi.createInvestor({ legalName: legalName.trim() }),
      onSuccess: () => {
        toast('Inversor creado', 'success');
        queryClient.invalidateQueries({ queryKey: ['investors'] });
        setLegalName('');
        onClose();
      },
      onError: (e) => toast(errText(e), 'error'),
    });
    return (
      <Modal open={open} onClose={onClose} title="Nuevo inversor">
        <div className="space-y-3">
          <div className={fieldCls}>
            <label className={labelCls}>Nombre / razón social</label>
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
            />
          </div>
          <button
            className={`${btnPrimaryCls} w-full justify-center`}
            disabled={!legalName.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Crear
          </button>
        </div>
      </Modal>
    );
  }

  function NewAccountModal({
    open,
    onClose,
    onCreated,
  }: {
    open: boolean;
    onClose: () => void;
    onCreated: (id: string) => void;
  }) {
    const [name, setName] = useState('');
    const [committedAmount, setCommittedAmount] = useState('0');
    const [startDate, setStartDate] = useState(
      new Date().toISOString().slice(0, 10),
    );
    const [projectId, setProjectId] = useState('');
    const projectsQuery = useQuery({
      queryKey: ['projects-for-investors'],
      queryFn: () => projectsApi.list('', ''),
      enabled: open,
    });
    const mutation = useMutation({
      mutationFn: () =>
        investorsApi.createAccount({
          name: name.trim(),
          committedAmount: Number(committedAmount) || 0,
          startDate,
          projectId: projectId || null,
        }),
      onSuccess: (acc: InvestmentAccountDto) => {
        toast('Cuenta creada', 'success');
        queryClient.invalidateQueries({ queryKey: ['investment-accounts'] });
        setName('');
        onCreated(acc.id);
        onClose();
      },
      onError: (e) => toast(errText(e), 'error'),
    });
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Nueva cuenta en participación"
      >
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
            <label className={labelCls}>
              Obra (opcional — vacío = a nivel de empresa)
            </label>
            <select
              className={selectCls}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">—</option>
              {projectsQuery.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className={fieldCls}>
              <label className={labelCls}>Capital comprometido</label>
              <input
                type="number"
                step="0.01"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={committedAmount}
                onChange={(e) => setCommittedAmount(e.target.value)}
              />
            </div>
            <div className={fieldCls}>
              <label className={labelCls}>Fecha de inicio</label>
              <input
                type="date"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </div>
          <button
            className={`${btnPrimaryCls} w-full justify-center`}
            disabled={!name.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Crear
          </button>
        </div>
      </Modal>
    );
  }
}

function AccountDetail({
  accountId,
  investors,
}: {
  accountId: string;
  investors: InvestorDto[];
}) {
  const queryClient = useQueryClient();
  const [participationOpen, setParticipationOpen] = useState(false);
  const [cashflowOpen, setCashflowOpen] = useState(false);
  const [distributeOpen, setDistributeOpen] = useState(false);

  const accountQuery = useQuery({
    queryKey: ['investment-account', accountId],
    queryFn: () => investorsApi.getAccount(accountId),
  });
  const participationsQuery = useQuery({
    queryKey: ['investment-participations', accountId],
    queryFn: () => investorsApi.listParticipations(accountId),
  });
  const cashflowsQuery = useQuery({
    queryKey: ['investment-cashflows', accountId],
    queryFn: () => investorsApi.listCashflows(accountId),
  });
  const reportQuery = useQuery({
    queryKey: ['investment-report', accountId],
    queryFn: () => investorsApi.report(accountId, 0.08),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({
      queryKey: ['investment-account', accountId],
    });
    queryClient.invalidateQueries({
      queryKey: ['investment-participations', accountId],
    });
    queryClient.invalidateQueries({
      queryKey: ['investment-cashflows', accountId],
    });
    queryClient.invalidateQueries({
      queryKey: ['investment-report', accountId],
    });
    queryClient.invalidateQueries({ queryKey: ['investment-accounts'] });
  };

  const account = accountQuery.data;
  const participations = participationsQuery.data ?? [];

  return (
    <div className="space-y-5">
      {account && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">{account.name}</h2>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {INVESTMENT_ACCOUNT_STATUS_LABELS[account.status]}
            </span>
            {account.projectCode && (
              <span className="text-xs text-gray-400">
                {account.projectCode}
              </span>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Comprometido"
              value={formatEur(account.committedAmount)}
            />
            <Stat
              label="Valoración actual"
              value={formatEur(account.currentValuationAmount)}
            />
            <Stat
              label="% participado"
              value={`${account.totalParticipationPct}%`}
              warn={Math.abs(account.totalParticipationPct - 100) > 0.01}
            />
            <Stat label="Inicio" value={formatDate(account.startDate)} />
          </div>
        </div>
      )}

      {/* Informe TIR/VAN */}
      {reportQuery.data && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <IconPercent size={14} /> Informe TIR/VAN (tasa 8%)
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400">
                <th className="pb-2">Inversor</th>
                <th className="pb-2 text-right">Aportado</th>
                <th className="pb-2 text-right">Repartido</th>
                <th className="pb-2 text-right">TIR</th>
                <th className="pb-2 text-right">VAN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reportQuery.data.investors.map((r) => (
                <tr key={r.investorId}>
                  <td className="py-1.5">{r.investorName}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatEur(r.totalAportado)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatEur(r.totalRepartido)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {r.irr !== null ? `${(r.irr * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatEur(r.npv)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Participaciones */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Participaciones</h3>
          <button
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50"
            onClick={() => setParticipationOpen(true)}
          >
            <IconPlus size={13} /> Añadir inversor
          </button>
        </div>
        <div className="divide-y divide-gray-100">
          {participations.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between py-2 text-sm"
            >
              <span>{p.investorName}</span>
              <span className="tabular-nums text-gray-600">
                {p.participationPct}% · {formatEur(p.committedAmount)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Cashflows */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Movimientos</h3>
          <div className="flex gap-2">
            <button
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
              onClick={() => setCashflowOpen(true)}
            >
              <IconPlus size={13} /> Movimiento
            </button>
            <button
              className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600"
              onClick={() => setDistributeOpen(true)}
            >
              Repartir dividendo
            </button>
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {(cashflowsQuery.data ?? []).map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between py-2 text-sm"
            >
              <span>
                {c.investorName} —{' '}
                <span className="text-gray-400">
                  {CASHFLOW_DIRECTION_LABELS[c.direction]}
                </span>
              </span>
              <span className="tabular-nums">
                {formatDate(c.flowDate)} · {formatEur(c.amount)}
              </span>
            </div>
          ))}
          {(cashflowsQuery.data ?? []).length === 0 && (
            <p className="py-2 text-sm text-gray-400">
              Sin movimientos todavía.
            </p>
          )}
        </div>
      </div>

      <AddParticipationModal
        open={participationOpen}
        onClose={() => setParticipationOpen(false)}
        accountId={accountId}
        investors={investors}
        onDone={invalidateAll}
      />
      <AddCashflowModal
        open={cashflowOpen}
        onClose={() => setCashflowOpen(false)}
        accountId={accountId}
        participations={participations}
        onDone={invalidateAll}
      />
      <DistributeModal
        open={distributeOpen}
        onClose={() => setDistributeOpen(false)}
        accountId={accountId}
        onDone={invalidateAll}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p
        className={`text-sm font-semibold tabular-nums ${warn ? 'text-amber-600' : 'text-gray-900'}`}
      >
        {value}
      </p>
    </div>
  );
}

function AddParticipationModal({
  open,
  onClose,
  accountId,
  investors,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  investors: InvestorDto[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [investorId, setInvestorId] = useState('');
  const [pct, setPct] = useState('0');
  const [committedAmount, setCommittedAmount] = useState('0');
  const [joinedAt, setJoinedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );

  const mutation = useMutation({
    mutationFn: () =>
      investorsApi.createParticipation(accountId, {
        investorId,
        participationPct: Number(pct) || 0,
        committedAmount: Number(committedAmount) || 0,
        joinedAt,
      }),
    onSuccess: () => {
      toast('Participación añadida', 'success');
      onDone();
      onClose();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Añadir inversor a la cuenta">
      <div className="space-y-3">
        <div className={fieldCls}>
          <label className={labelCls}>Inversor</label>
          <select
            className={selectCls}
            value={investorId}
            onChange={(e) => setInvestorId(e.target.value)}
          >
            <option value="">Selecciona…</option>
            {investors.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.legalName}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label className={labelCls}>% participación</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Capital comprometido</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={committedAmount}
              onChange={(e) => setCommittedAmount(e.target.value)}
            />
          </div>
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Fecha de alta</label>
          <input
            type="date"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={joinedAt}
            onChange={(e) => setJoinedAt(e.target.value)}
          />
        </div>
        <button
          className={`${btnPrimaryCls} w-full justify-center`}
          disabled={!investorId || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Añadir
        </button>
      </div>
    </Modal>
  );
}

function AddCashflowModal({
  open,
  onClose,
  accountId,
  participations,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  participations: { investorId: string; investorName: string }[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [investorId, setInvestorId] = useState('');
  const [direction, setDirection] = useState<'aportacion' | 'reparto'>(
    'aportacion',
  );
  const [amount, setAmount] = useState('0');
  const [flowDate, setFlowDate] = useState(
    new Date().toISOString().slice(0, 10),
  );

  const mutation = useMutation({
    mutationFn: () =>
      investorsApi.createCashflow(accountId, {
        investorId,
        direction,
        amount: Number(amount) || 0,
        flowDate,
      }),
    onSuccess: () => {
      toast('Movimiento registrado', 'success');
      onDone();
      onClose();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Nuevo movimiento">
      <div className="space-y-3">
        <div className={fieldCls}>
          <label className={labelCls}>Inversor</label>
          <select
            className={selectCls}
            value={investorId}
            onChange={(e) => setInvestorId(e.target.value)}
          >
            <option value="">Selecciona…</option>
            {participations.map((p) => (
              <option key={p.investorId} value={p.investorId}>
                {p.investorName}
              </option>
            ))}
          </select>
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Tipo</label>
          <select
            className={selectCls}
            value={direction}
            onChange={(e) =>
              setDirection(e.target.value as 'aportacion' | 'reparto')
            }
          >
            {Object.entries(CASHFLOW_DIRECTION_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label className={labelCls}>Importe</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Fecha</label>
            <input
              type="date"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={flowDate}
              onChange={(e) => setFlowDate(e.target.value)}
            />
          </div>
        </div>
        <button
          className={`${btnPrimaryCls} w-full justify-center`}
          disabled={!investorId || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Registrar
        </button>
      </div>
    </Modal>
  );
}

function DistributeModal({
  open,
  onClose,
  accountId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [totalAmount, setTotalAmount] = useState('0');
  const [flowDate, setFlowDate] = useState(
    new Date().toISOString().slice(0, 10),
  );

  const mutation = useMutation({
    mutationFn: () =>
      investorsApi.distribute(accountId, {
        totalAmount: Number(totalAmount) || 0,
        flowDate,
      }),
    onSuccess: (result) => {
      toast(
        `Repartidos ${formatEur(result.totalAmount)} entre ${result.created.length} inversores`,
        'success',
      );
      onDone();
      onClose();
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Repartir dividendo">
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          Se reparte pro-rata entre los inversores de la cuenta según su % de
          participación vigente.
        </p>
        <div className={fieldCls}>
          <label className={labelCls}>Importe total</label>
          <input
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
          />
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Fecha</label>
          <input
            type="date"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={flowDate}
            onChange={(e) => setFlowDate(e.target.value)}
          />
        </div>
        <button
          className={`${btnPrimaryCls} w-full justify-center`}
          disabled={Number(totalAmount) <= 0 || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Repartir
        </button>
      </div>
    </Modal>
  );
}
