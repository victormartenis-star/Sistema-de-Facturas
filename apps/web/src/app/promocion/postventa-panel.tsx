'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  POSTVENTA_INCIDENT_CATEGORY_LABELS,
  POSTVENTA_INCIDENT_STATUS_LABELS,
  type PostventaIncidentCategory,
  type PostventaIncidentStatus,
} from '@erp/shared';
import { formatDate, realEstateApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconAlertTriangle, IconPlus, IconWrench } from '@/components/icons';
import {
  Modal,
  btnPrimaryCls,
  fieldCls,
  labelCls,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

const STATUS_STYLES: Record<PostventaIncidentStatus, string> = {
  abierta: 'bg-red-100 text-red-700',
  en_reparacion: 'bg-amber-100 text-amber-700',
  cerrada: 'bg-emerald-100 text-emerald-700',
};

/** Incidencias de postventa/garantía. Si `unitId` es null, muestra todas las de la empresa. */
export function PostventaPanel({ unitId }: { unitId: string | null }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const incidentsQuery = useQuery({
    queryKey: ['postventa-incidents', unitId],
    queryFn: () => realEstateApi.listIncidents(unitId ?? undefined),
  });

  const statusMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: PostventaIncidentStatus;
    }) => realEstateApi.updateIncidentStatus(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['postventa-incidents'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <IconWrench size={14} /> Postventa
        </h3>
        <button
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50 disabled:opacity-40"
          disabled={!unitId}
          title={
            !unitId
              ? 'Elige una unidad para reportar una incidencia'
              : undefined
          }
          onClick={() => setOpen(true)}
        >
          <IconPlus size={12} /> Incidencia
        </button>
      </div>
      <div className="divide-y divide-gray-100">
        {(incidentsQuery.data ?? []).map((i) => (
          <div key={i.id} className="py-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {POSTVENTA_INCIDENT_CATEGORY_LABELS[i.category]} · {i.unitCode}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[i.status]}`}
              >
                {POSTVENTA_INCIDENT_STATUS_LABELS[i.status]}
              </span>
            </div>
            <p className="text-gray-600">{i.description}</p>
            <div className="mt-1 flex items-center justify-between text-xs text-gray-400">
              <span>
                Reportada {formatDate(i.reportedAt)}
                {i.warrantyExpired && (
                  <span className="ml-2 inline-flex items-center gap-1 text-red-600">
                    <IconAlertTriangle size={11} /> Garantía vencida
                  </span>
                )}
              </span>
              {i.status !== 'cerrada' && (
                <div className="flex gap-2">
                  {i.status === 'abierta' && (
                    <button
                      className="text-amber-600 hover:underline"
                      onClick={() =>
                        statusMutation.mutate({
                          id: i.id,
                          status: 'en_reparacion',
                        })
                      }
                    >
                      En reparación
                    </button>
                  )}
                  <button
                    className="text-emerald-600 hover:underline"
                    onClick={() =>
                      statusMutation.mutate({ id: i.id, status: 'cerrada' })
                    }
                  >
                    Cerrar
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {(incidentsQuery.data ?? []).length === 0 && (
          <p className="py-2 text-sm text-gray-400">Sin incidencias.</p>
        )}
      </div>

      {unitId && (
        <NewIncidentModal
          open={open}
          onClose={() => setOpen(false)}
          unitId={unitId}
          onDone={() =>
            queryClient.invalidateQueries({ queryKey: ['postventa-incidents'] })
          }
        />
      )}
    </div>
  );
}

function NewIncidentModal({
  open,
  onClose,
  unitId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  unitId: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [category, setCategory] = useState<PostventaIncidentCategory>('otros');
  const [description, setDescription] = useState('');
  const [reportedAt, setReportedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [warrantyDeadline, setWarrantyDeadline] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      realEstateApi.createIncident({
        unitId,
        category,
        description: description.trim(),
        reportedAt,
        warrantyDeadline: warrantyDeadline || null,
      }),
    onSuccess: () => {
      toast('Incidencia registrada', 'success');
      onDone();
      onClose();
      setDescription('');
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Nueva incidencia de postventa">
      <div className="space-y-3">
        <div className={fieldCls}>
          <label className={labelCls}>Categoría</label>
          <select
            className={selectCls}
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as PostventaIncidentCategory)
            }
          >
            {Object.entries(POSTVENTA_INCIDENT_CATEGORY_LABELS).map(
              ([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ),
            )}
          </select>
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Descripción</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label className={labelCls}>Fecha</label>
            <input
              type="date"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={reportedAt}
              onChange={(e) => setReportedAt(e.target.value)}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Fin de garantía (opcional)</label>
            <input
              type="date"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={warrantyDeadline}
              onChange={(e) => setWarrantyDeadline(e.target.value)}
            />
          </div>
        </div>
        <button
          className={`${btnPrimaryCls} w-full justify-center`}
          disabled={!description.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Registrar
        </button>
      </div>
    </Modal>
  );
}
