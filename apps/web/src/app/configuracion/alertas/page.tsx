'use client';

/**
 * Página /configuracion/alertas
 *
 * Umbrales configurables de las 4 alertas proactivas (Fase 13): documentación
 * de homologación, permisos y licencias, sobrecoste de partida y garantía de
 * postventa. El cron (`AlertsSchedulerService`, backend) las evalúa una vez
 * al día contra estas reglas y deja la bandeja de notificaciones (campana,
 * arriba a la derecha) — "Evaluar ahora" dispara la misma lógica sin
 * esperar al cron, útil para comprobar un umbral recién cambiado.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ALERT_CHANNELS,
  ALERT_CHANNEL_LABELS,
  ALERT_RULE_TYPE_LABELS,
  ALERT_RULE_TYPES_BY_DAYS,
  type AlertChannel,
  type AlertRuleDto,
  type AlertRuleType,
} from '@erp/shared';
import { alertsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/toast';
import { IconBell, IconLoader, IconSparkles } from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  TableSkeleton,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  labelCls,
} from '@/components/ui';

const MANAGE_ROLES = ['admin', 'gerente', 'administracion'];

function RuleRow({ rule, canEdit }: { rule: AlertRuleDto; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const isDaysType = (ALERT_RULE_TYPES_BY_DAYS as readonly string[]).includes(
    rule.type,
  );

  const [thresholdDays, setThresholdDays] = useState(rule.thresholdDays ?? 30);
  const [thresholdPct, setThresholdPct] = useState(rule.thresholdPct ?? 0);
  const [channels, setChannels] = useState<AlertChannel[]>(rule.channels);
  const [enabled, setEnabled] = useState(rule.enabled);

  // Si otra pestaña/usuario cambió la regla, refleja el valor fresco.
  useEffect(() => {
    setThresholdDays(rule.thresholdDays ?? 30);
    setThresholdPct(rule.thresholdPct ?? 0);
    setChannels(rule.channels);
    setEnabled(rule.enabled);
  }, [rule]);

  const dirty =
    (isDaysType ? thresholdDays !== rule.thresholdDays : false) ||
    (!isDaysType ? thresholdPct !== rule.thresholdPct : false) ||
    channels.join(',') !== rule.channels.join(',') ||
    enabled !== rule.enabled;

  const mutation = useMutation({
    mutationFn: () =>
      alertsApi.updateRule(rule.type, {
        ...(isDaysType ? { thresholdDays } : { thresholdPct }),
        channels,
        enabled,
      }),
    onSuccess: () => {
      toast('Regla actualizada', 'success');
      queryClient.invalidateQueries({ queryKey: ['alerts-rules'] });
    },
    onError: (err) => toast((err as Error).message, 'error'),
  });

  const toggleChannel = (ch: AlertChannel) => {
    setChannels((prev) =>
      prev.includes(ch)
        ? prev.filter((c) => c !== ch)
        : ([...prev, ch] as AlertChannel[]),
    );
  };

  return (
    <tr className="border-b border-gray-50 align-top hover:bg-gray-50/40">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canEdit}
              onChange={(e) => setEnabled(e.target.checked)}
              className="peer sr-only"
            />
            <div className="h-5 w-9 rounded-full bg-gray-200 transition peer-checked:bg-amber-500 peer-disabled:opacity-50" />
            <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
          </label>
          <span className="font-medium text-gray-900">
            {ALERT_RULE_TYPE_LABELS[rule.type]}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        {isDaysType ? (
          <div className={fieldCls + ' max-w-[140px]'}>
            <label className={labelCls}>Días de antelación</label>
            <input
              type="number"
              min={0}
              max={365}
              value={thresholdDays}
              disabled={!canEdit}
              onChange={(e) => setThresholdDays(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:bg-gray-50"
            />
          </div>
        ) : (
          <div className={fieldCls + ' max-w-[140px]'}>
            <label className={labelCls}>% de desviación tolerado</label>
            <input
              type="number"
              min={0}
              max={1000}
              step={0.5}
              value={thresholdPct}
              disabled={!canEdit}
              onChange={(e) => setThresholdPct(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:bg-gray-50"
            />
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-3">
          {ALERT_CHANNELS.map((ch) => (
            <label
              key={ch}
              className="flex items-center gap-1.5 text-xs text-gray-600"
            >
              <input
                type="checkbox"
                checked={channels.includes(ch)}
                disabled={!canEdit}
                onChange={() => toggleChannel(ch)}
              />
              {ALERT_CHANNEL_LABELS[ch]}
            </label>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        {canEdit && (
          <button
            onClick={() => mutation.mutate()}
            disabled={!dirty || mutation.isPending}
            className={`${btnGhostCls} ${!dirty ? 'opacity-40' : ''}`}
          >
            {mutation.isPending ? (
              <IconLoader size={14} className="animate-spin" />
            ) : (
              'Guardar'
            )}
          </button>
        )}
      </td>
    </tr>
  );
}

export default function AlertasConfigPage() {
  const { user } = useAuth();
  const toast = useToast();
  const canEdit = Boolean(user?.role && MANAGE_ROLES.includes(user.role));

  const query = useQuery({
    queryKey: ['alerts-rules'],
    queryFn: () => alertsApi.listRules(),
    staleTime: 30_000,
  });

  const runMutation = useMutation({
    mutationFn: () => alertsApi.run(),
    onSuccess: (summary) => {
      toast(
        summary.created > 0
          ? `${summary.created} notificación(es) nueva(s) creada(s)`
          : 'Sin novedades: todo dentro de los umbrales configurados',
        'success',
      );
    },
    onError: (err) => toast((err as Error).message, 'error'),
  });

  const rules: AlertRuleDto[] = query.data ?? [];
  const ordered: (AlertRuleType | undefined)[] = [
    'compliance_doc',
    'permiso',
    'sobrecoste',
    'garantia_postventa',
  ];
  const sorted = ordered
    .map((t) => rules.find((r) => r.type === t))
    .filter((r): r is AlertRuleDto => Boolean(r));

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Reglas de alerta"
        subtitle="Umbrales de las notificaciones proactivas — el cron las evalúa a diario"
      >
        {canEdit && (
          <button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className={btnPrimaryCls}
          >
            {runMutation.isPending ? (
              <IconLoader size={14} className="animate-spin" />
            ) : (
              <IconSparkles size={14} />
            )}
            Evaluar ahora
          </button>
        )}
      </PageHeader>

      {query.isLoading && <TableSkeleton rows={4} />}
      {query.error && <ErrorBanner message={(query.error as Error).message} />}

      {!query.isLoading && !query.error && sorted.length === 0 && (
        <EmptyState icon={<IconBell size={40} />} title="Sin reglas">
          <p className="text-sm text-gray-500">
            No se han podido cargar las reglas de alerta.
          </p>
        </EmptyState>
      )}

      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs font-semibold tracking-wider text-gray-500 uppercase">
                <th className="px-4 py-3">Tipo de alerta</th>
                <th className="px-4 py-3">Umbral</th>
                <th className="px-4 py-3">Canales</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <RuleRow key={r.id} rule={r} canEdit={canEdit} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!canEdit && (
        <p className="text-xs text-gray-400">
          Solo administración y gerencia pueden cambiar estos umbrales.
        </p>
      )}
    </div>
  );
}
