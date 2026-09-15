'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import type { BimModelDto, BudgetItemDto } from '@erp/shared';
import { bimApi, budgetsApi, projectsApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { BimViewer, type ElementClickInfo } from '@/components/bim';
import { Modal, btnGhostCls, btnPrimaryCls } from '@/components/ui';
import { IconCube, IconPlus, IconTrash, IconUpload } from '@/components/icons';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

export default function BimPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [loadingBuffer, setLoadingBuffer] = useState(false);
  const [selectedElement, setSelectedElement] =
    useState<ElementClickInfo | null>(null);
  const [colorVersion, setColorVersion] = useState(0);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId),
  });

  const modelsQuery = useQuery({
    queryKey: ['bim-models', projectId],
    queryFn: () => bimApi.list(projectId),
  });

  const linksQuery = useQuery({
    queryKey: ['bim-links', selectedModelId],
    queryFn: () => bimApi.listLinks(selectedModelId!),
    enabled: !!selectedModelId,
  });

  const linksByGlobalId = useMemo(() => {
    const map = new Map<
      string,
      (typeof linksQuery)['data'] extends (infer U)[] | undefined ? U : never
    >();
    for (const link of linksQuery.data ?? []) map.set(link.ifcGlobalId, link);
    return map;
  }, [linksQuery.data]);

  // Presupuesto activo de la obra, para el selector de partidas del panel lateral.
  const budgetItemsQuery = useQuery({
    queryKey: ['budget-items-for-bim', projectId],
    queryFn: async () => {
      const budgets = await budgetsApi.listByProject(projectId);
      const active = budgets.find((b) => b.status === 'activo') ?? budgets[0];
      if (!active) return [] as BudgetItemDto[];
      const detail = await budgetsApi.getDetail(active.id);
      return detail.items;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => bimApi.upload(file, projectId, file.name),
    onSuccess: (model) => {
      toast(`Modelo "${model.name}" subido`, 'success');
      queryClient.invalidateQueries({ queryKey: ['bim-models', projectId] });
      setSelectedModelId(model.id);
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => bimApi.remove(id),
    onSuccess: () => {
      toast('Modelo eliminado', 'success');
      queryClient.invalidateQueries({ queryKey: ['bim-models', projectId] });
      setSelectedModelId(null);
      setBuffer(null);
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const linkMutation = useMutation({
    mutationFn: (input: {
      budgetItemId: string | null;
      notes: string | null;
    }) =>
      bimApi.upsertLink(selectedModelId!, selectedElement!.globalId, {
        ifcElementName: selectedElement!.name,
        ifcElementType: selectedElement!.ifcType,
        budgetItemId: input.budgetItemId,
        notes: input.notes,
      }),
    onSuccess: () => {
      toast('Vínculo guardado', 'success');
      queryClient.invalidateQueries({
        queryKey: ['bim-links', selectedModelId],
      });
      setColorVersion((v) => v + 1);
      setSelectedElement(null);
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  async function openModel(model: BimModelDto) {
    setSelectedModelId(model.id);
    setBuffer(null);
    setLoadingBuffer(true);
    try {
      const buf = await bimApi.fetchModelBuffer(model.id);
      setBuffer(buf);
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setLoadingBuffer(false);
    }
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.ifc')) {
      toast('Selecciona un archivo .ifc', 'error');
      return;
    }
    uploadMutation.mutate(file);
  }

  const currentLink = selectedElement
    ? linksByGlobalId.get(selectedElement.globalId)
    : undefined;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          href={`/obras/${projectId}`}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          ← {projectQuery.data?.name ?? 'Obra'}
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <IconCube size={22} /> Visor BIM
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".ifc"
            className="hidden"
            onChange={handleFileChosen}
          />
          <button
            className={btnPrimaryCls}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
          >
            <IconUpload size={15} /> Subir modelo .ifc
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_1fr]">
        {/* Lista de modelos */}
        <div className="space-y-2">
          {modelsQuery.isLoading && (
            <p className="text-sm text-gray-500">Cargando modelos…</p>
          )}
          {modelsQuery.data?.length === 0 && (
            <p className="text-sm text-gray-500">
              Sin modelos BIM todavía. Sube un .ifc para empezar.
            </p>
          )}
          {modelsQuery.data?.map((model) => (
            <div
              key={model.id}
              className={`group flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                selectedModelId === model.id
                  ? 'border-amber-400 bg-amber-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <button
                className="min-w-0 flex-1 truncate text-left"
                title={model.fileName}
                onClick={() => openModel(model)}
              >
                {model.name}
              </button>
              <button
                className="shrink-0 text-gray-400 opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                onClick={() => {
                  if (confirm(`¿Eliminar el modelo "${model.name}"?`)) {
                    removeMutation.mutate(model.id);
                  }
                }}
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* Visor */}
        <div>
          {!selectedModelId && (
            <div className="flex h-[560px] items-center justify-center rounded-xl border border-dashed border-gray-300 text-sm text-gray-400">
              Elige un modelo de la lista o sube uno nuevo
            </div>
          )}
          {selectedModelId && loadingBuffer && (
            <div className="flex h-[560px] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-500">
              Descargando modelo…
            </div>
          )}
          {selectedModelId && buffer && (
            <BimViewer
              buffer={buffer}
              linksByGlobalId={linksByGlobalId}
              onElementClick={setSelectedElement}
              colorVersion={colorVersion}
            />
          )}
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-gray-400" /> Sin
              vincular
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-400" />{' '}
              Vinculada, sin certificar
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-red-500 to-green-500" />{' '}
              % certificado a origen
            </span>
          </div>
        </div>
      </div>

      {/* Panel de vínculo del elemento seleccionado */}
      <Modal
        open={!!selectedElement}
        onClose={() => setSelectedElement(null)}
        title={selectedElement?.name ?? selectedElement?.ifcType ?? 'Elemento'}
      >
        {selectedElement && (
          <ElementLinkForm
            key={selectedElement.globalId}
            elementInfo={selectedElement}
            budgetItems={budgetItemsQuery.data ?? []}
            initialBudgetItemId={currentLink?.budgetItemId ?? null}
            initialNotes={currentLink?.notes ?? ''}
            certifiedPct={currentLink?.certifiedPct ?? null}
            saving={linkMutation.isPending}
            onSave={(budgetItemId, notes) =>
              linkMutation.mutate({ budgetItemId, notes: notes || null })
            }
            onCancel={() => setSelectedElement(null)}
          />
        )}
      </Modal>
    </div>
  );
}

function ElementLinkForm({
  elementInfo,
  budgetItems,
  initialBudgetItemId,
  initialNotes,
  certifiedPct,
  saving,
  onSave,
  onCancel,
}: {
  elementInfo: ElementClickInfo;
  budgetItems: BudgetItemDto[];
  initialBudgetItemId: string | null;
  initialNotes: string;
  certifiedPct: number | null;
  saving: boolean;
  onSave: (budgetItemId: string | null, notes: string) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState('');
  const [budgetItemId, setBudgetItemId] = useState(initialBudgetItemId);
  const [notes, setNotes] = useState(initialNotes);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const items = needle
      ? budgetItems.filter(
          (i) =>
            i.code.toLowerCase().includes(needle) ||
            i.name.toLowerCase().includes(needle),
        )
      : budgetItems;
    return items.slice(0, 30);
  }, [budgetItems, search]);

  const selected = budgetItems.find((i) => i.id === budgetItemId) ?? null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        {elementInfo.ifcType ?? 'Elemento IFC'} · {elementInfo.globalId}
      </p>

      {certifiedPct !== null && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Certificado a origen: {certifiedPct.toFixed(1)} %
        </p>
      )}

      <div>
        <p className="mb-1 text-xs font-medium text-gray-600">
          Partida de presupuesto vinculada
        </p>
        {selected ? (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
            <span className="truncate">
              <strong>{selected.code}</strong> — {selected.name}
            </span>
            <button
              className="shrink-0 text-gray-500 hover:text-red-600"
              onClick={() => setBudgetItemId(null)}
            >
              <IconTrash size={14} />
            </button>
          </div>
        ) : (
          <p className="mb-2 text-sm text-gray-400">Sin vincular</p>
        )}
        <input
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          placeholder="Buscar partida por código o descripción…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-gray-400">Sin resultados</p>
            )}
            {filtered.map((item) => (
              <button
                key={item.id}
                className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-gray-50"
                onClick={() => {
                  setBudgetItemId(item.id);
                  setSearch('');
                }}
              >
                <strong>{item.code}</strong> — {item.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-gray-600">Notas</p>
        <textarea
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2">
        <button className={btnGhostCls} onClick={onCancel}>
          Cancelar
        </button>
        <button
          className={btnPrimaryCls}
          disabled={saving}
          onClick={() => onSave(budgetItemId, notes)}
        >
          <IconPlus size={15} /> Guardar vínculo
        </button>
      </div>
    </div>
  );
}
