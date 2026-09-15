'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PRL_CHECKLIST_ITEM_LABELS } from '@erp/shared';
import { formatDate, offlineFieldApi, projectsApi } from '@/lib/api';
import { submitOrQueue } from '@/lib/offline-queue';
import { useToast } from '@/components/toast';
import { IconCheck, IconShield } from '@/components/icons';
import {
  ErrorBanner,
  PageHeader,
  TableSkeleton,
  btnPrimaryCls,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

/** Checklist PRL diario antes de empezar a trabajar — offline-first, igual que fichajes. */
export default function ChecklistPrlPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [checked, setChecked] = useState<boolean[]>(
    PRL_CHECKLIST_ITEM_LABELS.map(() => false),
  );
  const [submitting, setSubmitting] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ['projects-for-checklist-prl'],
    queryFn: () => projectsApi.list('', ''),
  });
  const checklistsQuery = useQuery({
    queryKey: ['checklists-prl', projectId],
    queryFn: () => offlineFieldApi.listChecklists(projectId || undefined),
    enabled: !!projectId,
  });

  function toggle(i: number) {
    setChecked((prev) => prev.map((c, idx) => (idx === i ? !c : c)));
  }

  async function submit() {
    if (!projectId || !workerName.trim()) {
      toast('Elige obra y escribe tu nombre', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const items = PRL_CHECKLIST_ITEM_LABELS.map((label, i) => ({
        label,
        checked: checked[i],
      }));
      const { queued } = await submitOrQueue('checklist-prl', {
        projectId,
        workerName: workerName.trim(),
        checkDate: new Date().toISOString().slice(0, 10),
        items,
      });
      toast(
        queued
          ? 'Checklist guardado — se sincronizará solo con cobertura'
          : 'Checklist registrado',
        'success',
      );
      setChecked(PRL_CHECKLIST_ITEM_LABELS.map(() => false));
      queryClient.invalidateQueries({
        queryKey: ['checklists-prl', projectId],
      });
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Checklist PRL diario"
        subtitle="Comprobación antes de empezar a trabajar — funciona sin cobertura"
      />

      <div className="mx-auto max-w-md space-y-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Obra
          </label>
          <select
            className={`${selectCls} mb-3`}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">Elige…</option>
            {projectsQuery.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>

          <label className="mb-1 block text-xs font-medium text-gray-600">
            Tu nombre
          </label>
          <input
            className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={workerName}
            onChange={(e) => setWorkerName(e.target.value)}
          />

          <div className="space-y-2">
            {PRL_CHECKLIST_ITEM_LABELS.map((label, i) => (
              <button
                key={label}
                onClick={() => toggle(i)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition ${
                  checked[i]
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                    checked[i]
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-gray-300'
                  }`}
                >
                  {checked[i] && <IconCheck size={14} />}
                </span>
                {label}
              </button>
            ))}
          </div>

          <button
            className={`${btnPrimaryCls} mt-4 w-full justify-center`}
            disabled={submitting}
            onClick={submit}
          >
            <IconShield size={15} /> Registrar checklist
          </button>
        </div>

        {projectId && (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">Checklists de hoy</h2>
            {checklistsQuery.isLoading && <TableSkeleton rows={3} />}
            {checklistsQuery.error && (
              <ErrorBanner message={errText(checklistsQuery.error)} />
            )}
            <div className="divide-y divide-gray-100">
              {checklistsQuery.data?.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span>{c.workerName}</span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400">
                      {formatDate(c.checkDate)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        c.allChecked
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {c.allChecked ? 'Completo' : 'Incompleto'}
                    </span>
                  </span>
                </div>
              ))}
              {checklistsQuery.data?.length === 0 && (
                <p className="py-2 text-sm text-gray-400">
                  Sin checklists todavía.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
