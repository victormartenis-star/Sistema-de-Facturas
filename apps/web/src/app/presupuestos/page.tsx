'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  BUDGET_STATUS_LABELS,
  type BudgetDetailDto,
  type BudgetDto,
  type BudgetItemDto,
  type BudgetStatus,
} from '@erp/shared';
import { ApiError, budgetsApi, formatEur, projectsApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  IconCalculator,
  IconChevronDown,
  IconChevronUp,
  IconPlus,
  IconTrash,
  IconUpload,
} from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  TableSkeleton,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  inputCls,
  labelCls,
  selectCls,
} from '@/components/ui';

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<BudgetStatus, string> = {
  borrador: 'bg-gray-200 text-gray-600',
  activo: 'bg-emerald-100 text-emerald-700',
  cerrado: 'bg-slate-200 text-slate-500',
};

function BudgetStatusBadge({ status }: { status: BudgetStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {BUDGET_STATUS_LABELS[status]}
    </span>
  );
}

// ─── Árbol de partidas ────────────────────────────────────────────────────────

function BudgetTree({ detail }: { detail: BudgetDetailDto }) {
  if (detail.items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-400">
        Este presupuesto no tiene partidas todavía.
      </p>
    );
  }

  // Reconstruye el árbol a partir de la lista plana usando parentCode
  const rootItems = detail.items.filter((i) => i.parentCode === null);
  const byParent = new Map<string, BudgetItemDto[]>();
  for (const item of detail.items) {
    if (item.parentCode) {
      if (!byParent.has(item.parentCode)) byParent.set(item.parentCode, []);
      byParent.get(item.parentCode)!.push(item);
    }
  }

  function renderItem(item: BudgetItemDto, depth: number): React.ReactNode {
    const kids = byParent.get(item.code) ?? [];
    const isChapter = item.level <= 2;
    const indent = depth * 20;

    return (
      <div key={item.id}>
        <div
          className={`flex items-baseline gap-2 border-b border-gray-100 px-4 py-2 text-sm last:border-0 ${
            isChapter ? 'bg-gray-50/70 font-semibold' : 'hover:bg-amber-50/30'
          }`}
          style={{ paddingLeft: `${16 + indent}px` }}
        >
          <span className="w-36 shrink-0 font-mono text-xs text-gray-500">
            {item.code}
          </span>
          <span className="min-w-0 flex-1 truncate" title={item.name}>
            {item.name}
          </span>
          {!isChapter && (
            <>
              <span className="w-10 shrink-0 text-right text-xs text-gray-500">
                {item.unit || '—'}
              </span>
              <span className="w-24 shrink-0 text-right tabular-nums text-gray-600">
                {item.quantity > 0
                  ? Number(item.quantity).toLocaleString('es-ES', {
                      maximumFractionDigits: 2,
                    })
                  : '—'}
              </span>
              <span className="w-28 shrink-0 text-right tabular-nums text-gray-600">
                {item.unitPrice > 0 ? formatEur(item.unitPrice) : '—'}
              </span>
            </>
          )}
          <span
            className={`w-28 shrink-0 text-right tabular-nums ${isChapter ? 'text-gray-700' : 'font-medium'}`}
          >
            {item.totalAmount > 0 ? formatEur(item.totalAmount) : '—'}
          </span>
        </div>
        {kids.map((k) => renderItem(k, depth + 1))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      {/* Cabecera */}
      <div className="flex items-baseline gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
        <span className="w-36 shrink-0">Código</span>
        <span className="flex-1">Descripción</span>
        <span className="w-10 shrink-0 text-right">Ud.</span>
        <span className="w-24 shrink-0 text-right">Medición</span>
        <span className="w-28 shrink-0 text-right">Precio ud.</span>
        <span className="w-28 shrink-0 text-right">Importe</span>
      </div>
      {rootItems.map((i) => renderItem(i, 0))}
      {/* Total */}
      <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold">
        <span className="text-gray-600">Total presupuesto</span>
        <span className="w-28 text-right tabular-nums text-gray-900">
          {formatEur(detail.totalAmount)}
        </span>
      </div>
    </div>
  );
}

// ─── Modal crear presupuesto ──────────────────────────────────────────────────

function CreateBudgetModal({
  open,
  projectId,
  onClose,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');

  const mutation = useMutation({
    mutationFn: () => budgetsApi.create(projectId, { name: name.trim() }),
    onSuccess: () => {
      toast('Presupuesto creado');
      qc.invalidateQueries({ queryKey: ['budgets', projectId] });
      setName('');
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      title="Nuevo presupuesto"
      onClose={() => {
        mutation.reset();
        onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <label className="block">
          <span className={labelCls}>Nombre</span>
          <input
            className={`${inputCls} w-full`}
            placeholder="Ej. Presupuesto inicial v1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </label>
        {mutation.isError && (
          <ErrorBanner
            message={(mutation.error as Error).message ?? 'Error desconocido'}
          />
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnGhostCls} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={mutation.isPending || !name.trim()}
          >
            {mutation.isPending ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Modal importar BC3 ───────────────────────────────────────────────────────

function ImportBc3Modal({
  open,
  projectId,
  onClose,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const mutation = useMutation({
    mutationFn: () => budgetsApi.importBc3(projectId, file!, name.trim() || undefined),
    onSuccess: (res) => {
      toast(`BC3 importado: ${res.itemsCreated} partidas`);
      qc.invalidateQueries({ queryKey: ['budgets', projectId] });
      if (res.warnings.length > 0) {
        setWarnings(res.warnings);
      } else {
        reset();
        onClose();
      }
    },
  });

  const reset = () => {
    setName('');
    setFile(null);
    setWarnings([]);
    mutation.reset();
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Modal open={open} title="Importar BC3 (Presto / FIEBDC-3)" onClose={handleClose}>
      {warnings.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-amber-700">
            Importado con {warnings.length} aviso{warnings.length !== 1 ? 's' : ''}:
          </p>
          <ul className="max-h-48 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-1">
            {warnings.map((w, i) => (
              <li key={i}>· {w}</li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 pt-1">
            <button className={btnPrimaryCls} onClick={handleClose}>
              Cerrar
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <label className="block">
            <span className={labelCls}>Archivo .bc3</span>
            <input
              ref={fileRef}
              type="file"
              accept=".bc3,.BC3"
              required
              className="mt-1 block w-full text-sm text-gray-600 file:mr-4 file:rounded-lg file:border-0 file:bg-amber-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-amber-700 hover:file:bg-amber-100"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !name) setName(f.name.replace(/\.bc3$/i, ''));
              }}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Nombre del presupuesto</span>
            <input
              className={`${inputCls} w-full`}
              placeholder="Ej. Presupuesto Presto v2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {mutation.isError && (
            <ErrorBanner
              message={(mutation.error as Error).message ?? 'Error al importar'}
            />
          )}
          <p className="text-xs text-gray-500">
            Se importarán capítulos y partidas del árbol BC3. Podrás enlazar las
            partidas a fases de obra después para activar el control de desvíos.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={btnGhostCls} onClick={handleClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={mutation.isPending || !file}
            >
              <IconUpload size={14} />
              {mutation.isPending ? 'Importando…' : 'Importar'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ─── Tarjeta de presupuesto ───────────────────────────────────────────────────

function BudgetCard({
  budget,
  projectId,
}: {
  budget: BudgetDto;
  projectId: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['budget-detail', budget.id],
    queryFn: () => budgetsApi.getDetail(budget.id),
    enabled: expanded,
  });

  const activateMutation = useMutation({
    mutationFn: () => budgetsApi.update(budget.id, { status: 'activo' }),
    onSuccess: () => {
      toast('Presupuesto activado — es ahora la línea base de la obra');
      qc.invalidateQueries({ queryKey: ['budgets', projectId] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const closeMutation = useMutation({
    mutationFn: () => budgetsApi.update(budget.id, { status: 'cerrado' }),
    onSuccess: () => {
      toast('Presupuesto cerrado');
      qc.invalidateQueries({ queryKey: ['budgets', projectId] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => budgetsApi.remove(budget.id),
    onSuccess: () => {
      toast('Presupuesto eliminado');
      qc.invalidateQueries({ queryKey: ['budgets', projectId] });
      setDeleteOpen(false);
    },
    onError: (e) => {
      toast((e as Error).message, 'error');
      setDeleteOpen(false);
    },
  });

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Cabecera tarjeta */}
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">{budget.name}</span>
            <BudgetStatusBadge status={budget.status} />
            {budget.source === 'bc3' && (
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                BC3
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">
            {budget.itemCount} partidas ·{' '}
            <span className="font-medium text-gray-700">
              {formatEur(budget.totalAmount)}
            </span>
            {budget.importedAt && (
              <span className="text-gray-400">
                {' '}· importado{' '}
                {new Date(budget.importedAt).toLocaleDateString('es-ES')}
              </span>
            )}
          </p>
        </div>

        {/* Acciones */}
        <div className="flex shrink-0 items-center gap-1.5">
          {budget.status === 'borrador' && (
            <button
              onClick={() => activateMutation.mutate()}
              disabled={activateMutation.isPending}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              Activar
            </button>
          )}
          {budget.status === 'activo' && (
            <button
              onClick={() => closeMutation.mutate()}
              disabled={closeMutation.isPending}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-100 disabled:opacity-50"
            >
              Cerrar
            </button>
          )}
          <button
            onClick={() => setDeleteOpen(true)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
            title="Eliminar presupuesto"
          >
            <IconTrash size={15} />
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title={expanded ? 'Ocultar partidas' : 'Ver partidas'}
          >
            {expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Árbol de partidas (expandible) */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 pb-5 pt-4">
          {detailQuery.isLoading && (
            <div className="py-4 text-center text-sm text-gray-400">
              Cargando partidas…
            </div>
          )}
          {detailQuery.isError && (
            <ErrorBanner
              message={(detailQuery.error as Error).message}
            />
          )}
          {detailQuery.data && <BudgetTree detail={detailQuery.data} />}
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title={`¿Eliminar el presupuesto "${budget.name}"?`}
        description="Todas las partidas se eliminarán. Es un borrado lógico."
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function PresupuestosPage() {
  const [projectId, setProjectId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 60_000,
  });

  const budgetsQuery = useQuery({
    queryKey: ['budgets', projectId],
    queryFn: () => budgetsApi.listByProject(projectId),
    enabled: !!projectId,
  });

  const projects = projectsQuery.data ?? [];
  const budgets = budgetsQuery.data ?? [];

  return (
    <div className="animate-fade-in-up space-y-6">
      <PageHeader title="Presupuestos">
        {projectId && (
          <>
            <button
              onClick={() => setImportOpen(true)}
              className={btnGhostCls}
            >
              <IconUpload size={15} />
              Importar BC3
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              className={btnPrimaryCls}
            >
              <IconPlus size={15} />
              Nuevo presupuesto
            </button>
          </>
        )}
      </PageHeader>

      {/* Selector de obra */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700 shrink-0">Obra</label>
        <select
          className={`${selectCls} max-w-sm flex-1`}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">— Selecciona una obra —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Sin obra seleccionada */}
      {!projectId && (
        <EmptyState
          icon={<IconCalculator size={26} />}
          title="Selecciona una obra para ver sus presupuestos"
        />
      )}

      {/* Cargando presupuestos */}
      {projectId && budgetsQuery.isLoading && <TableSkeleton rows={3} />}

      {/* Error */}
      {projectId && budgetsQuery.isError && (
        <ErrorBanner message={(budgetsQuery.error as Error).message} />
      )}

      {/* Sin presupuestos */}
      {projectId && budgetsQuery.isSuccess && budgets.length === 0 && (
        <EmptyState
          icon={<IconCalculator size={26} />}
          title="Esta obra no tiene presupuestos todavía"
        >
          <div className="flex gap-2">
            <button
              onClick={() => setImportOpen(true)}
              className={btnGhostCls}
            >
              <IconUpload size={15} />
              Importar BC3
            </button>
            <button onClick={() => setCreateOpen(true)} className={btnPrimaryCls}>
              <IconPlus size={15} />
              Crear presupuesto
            </button>
          </div>
        </EmptyState>
      )}

      {/* Lista de presupuestos */}
      {budgets.length > 0 && (
        <div className="space-y-4">
          {budgets.map((b) => (
            <BudgetCard key={b.id} budget={b} projectId={projectId} />
          ))}
        </div>
      )}

      {/* Modales */}
      {projectId && (
        <>
          <CreateBudgetModal
            open={createOpen}
            projectId={projectId}
            onClose={() => setCreateOpen(false)}
          />
          <ImportBc3Modal
            open={importOpen}
            projectId={projectId}
            onClose={() => setImportOpen(false)}
          />
        </>
      )}
    </div>
  );
}
