'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  BUDGET_STATUSES,
  BUDGET_STATUS_LABELS,
  canDeleteBudget,
  type BudgetDetailDto,
  type BudgetDto,
  type BudgetItemDto,
  type BudgetStatus,
} from '@erp/shared';
import { budgetsApi, formatEur } from '@/lib/api';
import { useListadoPaginado } from '@/lib/use-listado-paginado';
import { usePermisos } from '@/lib/permisos';
import {
  BarraFiltros,
  DataTable,
  EstadoError,
  FiltroEstado,
  FiltroObra,
  type ColumnaDef,
} from '@/components/data-table';
import { useAvisarError, useToast } from '@/components/toast';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  IconCalculator,
  IconPlus,
  IconTrash,
  IconUpload,
} from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  btnGhostCls,
  btnPrimaryCls,
  inputCls,
  labelCls,
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
      qc.invalidateQueries({ queryKey: ['budgets'] });
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
    mutationFn: () =>
      budgetsApi.importBc3(projectId, file!, name.trim() || undefined),
    onSuccess: (res) => {
      toast(`BC3 importado: ${res.itemsCreated} partidas`);
      qc.invalidateQueries({ queryKey: ['budgets'] });
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
    <Modal
      open={open}
      title="Importar BC3 (Presto / FIEBDC-3)"
      onClose={handleClose}
    >
      {warnings.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-amber-700">
            Importado con {warnings.length} aviso
            {warnings.length !== 1 ? 's' : ''}:
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

// ─── Detalle expandido de un presupuesto ──────────────────────────────────────

function DetallePresupuesto({ budget }: { budget: BudgetDto }) {
  const detailQuery = useQuery({
    queryKey: ['budget-detail', budget.id],
    queryFn: () => budgetsApi.getDetail(budget.id),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-4 w-full" />
        ))}
      </div>
    );
  }
  if (detailQuery.isError) {
    return (
      <EstadoError
        compacto
        error={detailQuery.error}
        onReintentar={() => void detailQuery.refetch()}
      />
    );
  }
  return detailQuery.data ? <BudgetTree detail={detailQuery.data} /> : null;
}

// ─── Acciones de un presupuesto ───────────────────────────────────────────────

function AccionesPresupuesto({ budget }: { budget: BudgetDto }) {
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const { can } = usePermisos();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['budgets'] });
    qc.invalidateQueries({ queryKey: ['economics'] });
  };

  const activateMutation = useMutation({
    mutationFn: () =>
      budgetsApi.update(budget.id, { status: 'activo' }, budget.version),
    onSuccess: () => {
      toast('Presupuesto activado — es ahora la línea base de la obra');
      invalidate();
    },
    onError: (e) => avisarError(e, invalidate),
  });

  const closeMutation = useMutation({
    mutationFn: () =>
      budgetsApi.update(budget.id, { status: 'cerrado' }, budget.version),
    onSuccess: () => {
      toast('Presupuesto cerrado');
      invalidate();
    },
    onError: (e) => avisarError(e, invalidate),
  });

  const duplicateMutation = useMutation({
    mutationFn: () => budgetsApi.duplicate(budget.id),
    onSuccess: () => {
      toast('Nueva versión creada en borrador: edítala y actívala');
      invalidate();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => budgetsApi.remove(budget.id, budget.version),
    onSuccess: () => {
      toast('Presupuesto eliminado');
      invalidate();
      setDeleteOpen(false);
    },
    onError: (e) => {
      avisarError(e, invalidate);
      setDeleteOpen(false);
    },
  });

  return (
    <>
      {budget.status === 'borrador' && can('cambiarEstado', 'presupuesto') && (
        <button
          onClick={() => activateMutation.mutate()}
          disabled={activateMutation.isPending}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          Activar
        </button>
      )}
      {budget.status === 'activo' && can('cambiarEstado', 'presupuesto') && (
        <button
          onClick={() => closeMutation.mutate()}
          disabled={closeMutation.isPending}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-100 disabled:opacity-50"
        >
          Cerrar
        </button>
      )}
      {/* Corregir un presupuesto activo o cerrado = nueva versión. */}
      {can('duplicar', 'presupuesto') && (
        <button
          onClick={() => duplicateMutation.mutate()}
          disabled={duplicateMutation.isPending}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
          title="Crea una copia en borrador (nueva versión) para corregirla"
        >
          Duplicar
        </button>
      )}
      {canDeleteBudget(budget.status) && can('borrar', 'presupuesto') && (
        <button
          onClick={() => setDeleteOpen(true)}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
          title="Eliminar presupuesto"
        >
          <IconTrash size={15} />
        </button>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title={`¿Eliminar el presupuesto "${budget.name}"?`}
        description="Todas las partidas se eliminarán. Es un borrado lógico."
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

const COLUMNAS: ColumnaDef<BudgetDto>[] = [
  {
    id: 'nombre',
    cabecera: 'Nombre',
    celda: (b) => (
      <span className="flex items-center gap-2">
        <span className="font-semibold text-gray-900">{b.name}</span>
        {b.source === 'bc3' && (
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
            BC3
          </span>
        )}
      </span>
    ),
  },
  {
    id: 'estado',
    cabecera: 'Estado',
    celda: (b) => <BudgetStatusBadge status={b.status} />,
  },
  {
    id: 'partidas',
    cabecera: 'Partidas',
    alineacion: 'derecha',
    ocultaEnMovil: true,
    celda: (b) => b.itemCount,
  },
  {
    id: 'importe',
    cabecera: 'Importe',
    alineacion: 'derecha',
    celda: (b) => (
      <span className="font-medium">{formatEur(b.totalAmount)}</span>
    ),
  },
  {
    id: 'importado',
    cabecera: 'Importado',
    ocultaEnMovil: true,
    celda: (b) => (
      <span className="text-gray-500">
        {b.importedAt
          ? new Date(b.importedAt).toLocaleDateString('es-ES')
          : '—'}
      </span>
    ),
  },
];

export default function PresupuestosPage() {
  const { can } = usePermisos();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const listado = useListadoPaginado({
    clave: 'budgets',
    filtrosIniciales: { projectId: '', status: '' },
    habilitada: (f) => f.projectId !== '',
    consulta: (p) =>
      budgetsApi.listPaginadoPorObra(p.projectId, {
        status: p.status,
        page: p.page,
        pageSize: p.pageSize,
      }),
  });
  const { filtros, setFiltro } = listado;
  const projectId = filtros.projectId;

  const botonesCreacion = (
    <>
      {can('importar', 'presupuesto') && (
        <button onClick={() => setImportOpen(true)} className={btnGhostCls}>
          <IconUpload size={15} />
          Importar BC3
        </button>
      )}
      {can('crear', 'presupuesto') && (
        <button onClick={() => setCreateOpen(true)} className={btnPrimaryCls}>
          <IconPlus size={15} />
          Nuevo presupuesto
        </button>
      )}
    </>
  );

  return (
    <div className="animate-fade-in-up space-y-6">
      <PageHeader
        title="Presupuestos"
        count={projectId ? listado.total : undefined}
      >
        {projectId && botonesCreacion}
      </PageHeader>

      <BarraFiltros
        hayFiltros={filtros.status !== ''}
        onLimpiar={() => setFiltro('status', '')}
      >
        <FiltroObra
          obligatorio
          value={projectId}
          onChange={(v) => {
            setFiltro('projectId', v);
            setExpandedId(null);
          }}
        />
        <FiltroEstado<BudgetStatus>
          value={filtros.status as BudgetStatus | ''}
          onChange={(v) => setFiltro('status', v)}
          estados={BUDGET_STATUSES}
          etiquetas={BUDGET_STATUS_LABELS}
        />
      </BarraFiltros>

      {/* Sin obra seleccionada */}
      {!projectId && (
        <EmptyState
          icon={<IconCalculator size={26} />}
          title="Selecciona una obra para ver sus presupuestos"
        />
      )}

      {projectId && (
        <DataTable
          etiqueta="Presupuestos"
          columnas={COLUMNAS}
          filas={listado.filas}
          idFila={(b) => b.id}
          cargando={listado.cargando}
          actualizando={listado.actualizando}
          error={listado.error}
          onReintentar={listado.reintentar}
          hayFiltros={filtros.status !== ''}
          paginacion={{
            page: listado.page,
            pageSize: listado.pageSize,
            total: listado.total,
            onPageChange: listado.setPage,
            onPageSizeChange: listado.setPageSize,
          }}
          vacio={{
            icono: <IconCalculator size={26} />,
            titulo: 'Esta obra no tiene presupuestos todavía',
            accion: (
              <div className="flex justify-center gap-2">{botonesCreacion}</div>
            ),
          }}
          vacioConFiltros={{
            titulo: 'Ningún presupuesto coincide con el filtro',
            onLimpiar: () => setFiltro('status', ''),
          }}
          idExpandida={expandedId}
          onExpandir={setExpandedId}
          filaExpandida={(b) => <DetallePresupuesto budget={b} />}
          acciones={(b) => <AccionesPresupuesto budget={b} />}
        />
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
