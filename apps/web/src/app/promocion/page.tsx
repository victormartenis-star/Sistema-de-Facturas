'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  REAL_ESTATE_UNIT_KIND_LABELS,
  REAL_ESTATE_UNIT_STATUS_LABELS,
  type RealEstateUnitDto,
  type RealEstateUnitKind,
  type RealEstateUnitStatus,
} from '@erp/shared';
import { formatEur, projectsApi, realEstateApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconHome, IconPlus } from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  TableSkeleton,
  btnPrimaryCls,
  fieldCls,
  labelCls,
  selectCls,
} from '@/components/ui';
import { UnitDetailPanel } from './unit-detail-panel';
import { PostventaPanel } from './postventa-panel';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

const STATUS_STYLES: Record<RealEstateUnitStatus, string> = {
  disponible: 'bg-emerald-100 text-emerald-700',
  reservada: 'bg-amber-100 text-amber-700',
  vendida: 'bg-sky-100 text-sky-700',
  entregada: 'bg-gray-200 text-gray-700',
};

export default function PromocionPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [newUnitOpen, setNewUnitOpen] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ['projects-for-real-estate'],
    queryFn: () => projectsApi.list('', ''),
  });

  const unitsQuery = useQuery({
    queryKey: ['real-estate-units', projectId],
    queryFn: () => realEstateApi.listUnits(projectId || undefined),
  });

  const commercializationQuery = useQuery({
    queryKey: ['real-estate-commercialization', projectId],
    queryFn: () => realEstateApi.commercialization(projectId),
    enabled: !!projectId,
  });

  const createUnitMutation = useMutation({
    mutationFn: (input: {
      code: string;
      kind: RealEstateUnitKind;
      salePrice: number;
      surfaceM2: number | null;
    }) =>
      realEstateApi.createUnit({
        projectId,
        code: input.code,
        kind: input.kind,
        salePrice: input.salePrice,
        surfaceM2: input.surfaceM2,
      }),
    onSuccess: () => {
      toast('Unidad creada', 'success');
      queryClient.invalidateQueries({ queryKey: ['real-estate-units'] });
      setNewUnitOpen(false);
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  return (
    <div>
      <PageHeader
        title="Promoción y comercialización"
        subtitle="Unidades en venta, reservas, plan de cobros, entrega de llaves y postventa"
      >
        <select
          className={selectCls}
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setSelectedUnitId(null);
          }}
        >
          <option value="">Todas las obras</option>
          {projectsQuery.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
        <button
          className={btnPrimaryCls}
          disabled={!projectId}
          title={!projectId ? 'Elige primero una obra' : undefined}
          onClick={() => setNewUnitOpen(true)}
        >
          <IconPlus size={14} /> Unidad
        </button>
      </PageHeader>

      {commercializationQuery.data && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-400">Unidades</p>
            <p className="text-xl font-bold tabular-nums">
              {commercializationQuery.data.total}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-400">% Vendido</p>
            <p className="text-xl font-bold tabular-nums text-sky-600">
              {commercializationQuery.data.vendidasPct}%
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-400">% Entregado</p>
            <p className="text-xl font-bold tabular-nums text-gray-700">
              {commercializationQuery.data.entregadasPct}%
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">Unidades</h2>
          {unitsQuery.isLoading && <TableSkeleton rows={4} />}
          {unitsQuery.error && (
            <ErrorBanner message={errText(unitsQuery.error)} />
          )}
          {unitsQuery.data?.length === 0 && (
            <p className="text-sm text-gray-400">
              Sin unidades — elige una obra y crea la primera.
            </p>
          )}
          <div className="space-y-1">
            {unitsQuery.data?.map((u: RealEstateUnitDto) => (
              <button
                key={u.id}
                onClick={() => setSelectedUnitId(u.id)}
                className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm ${
                  selectedUnitId === u.id
                    ? 'bg-amber-50 text-amber-700'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{u.code}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[u.status]}`}
                  >
                    {REAL_ESTATE_UNIT_STATUS_LABELS[u.status]}
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  {REAL_ESTATE_UNIT_KIND_LABELS[u.kind]} ·{' '}
                  {formatEur(u.salePrice)}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          {!selectedUnitId && (
            <EmptyState icon={<IconHome size={24} />} title="Elige una unidad">
              Selecciona una unidad de la lista para ver su reserva, plan de
              cobros y entrega de llaves.
            </EmptyState>
          )}
          {selectedUnitId && <UnitDetailPanel unitId={selectedUnitId} />}
          <PostventaPanel unitId={selectedUnitId} />
        </div>
      </div>

      <NewUnitModal
        open={newUnitOpen}
        onClose={() => setNewUnitOpen(false)}
        onSave={(input) => createUnitMutation.mutate(input)}
        saving={createUnitMutation.isPending}
      />
    </div>
  );
}

function NewUnitModal({
  open,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (input: {
    code: string;
    kind: RealEstateUnitKind;
    salePrice: number;
    surfaceM2: number | null;
  }) => void;
  saving: boolean;
}) {
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<RealEstateUnitKind>('vivienda');
  const [salePrice, setSalePrice] = useState('0');
  const [surfaceM2, setSurfaceM2] = useState('');

  return (
    <Modal open={open} onClose={onClose} title="Nueva unidad">
      <div className="space-y-3">
        <div className={fieldCls}>
          <label className={labelCls}>
            Identificador (p.ej. "1ºA", "Local 3")
          </label>
          <input
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>Tipo</label>
          <select
            className={selectCls}
            value={kind}
            onChange={(e) => setKind(e.target.value as RealEstateUnitKind)}
          >
            {Object.entries(REAL_ESTATE_UNIT_KIND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label className={labelCls}>Superficie (m²)</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={surfaceM2}
              onChange={(e) => setSurfaceM2(e.target.value)}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Precio de venta</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
            />
          </div>
        </div>
        <button
          className={`${btnPrimaryCls} w-full justify-center`}
          disabled={!code.trim() || saving}
          onClick={() =>
            onSave({
              code: code.trim(),
              kind,
              salePrice: Number(salePrice) || 0,
              surfaceM2: surfaceM2 ? Number(surfaceM2) : null,
            })
          }
        >
          Crear unidad
        </button>
      </div>
    </Modal>
  );
}
