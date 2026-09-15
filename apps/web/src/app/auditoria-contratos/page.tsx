'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CONTRACT_AUDIT_RISK_LABELS,
  type ContractAuditDto,
  type ContractAuditRiskLevel,
} from '@erp/shared';
import {
  contactsApi,
  contractAiApi,
  documentsApi,
  formatDate,
  projectsApi,
} from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconGavel, IconSparkles } from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  PageHeader,
  TableSkeleton,
  btnPrimaryCls,
  fieldCls,
  labelCls,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

const RISK_STYLES: Record<ContractAuditRiskLevel, string> = {
  bajo: 'bg-emerald-100 text-emerald-700',
  medio: 'bg-amber-100 text-amber-700',
  alto: 'bg-orange-100 text-orange-700',
  critico: 'bg-red-100 text-red-700',
};

function RiskBadge({ risk }: { risk: ContractAuditRiskLevel }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${RISK_STYLES[risk]}`}
    >
      {CONTRACT_AUDIT_RISK_LABELS[risk]}
    </span>
  );
}

export default function AuditoriaContratosPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<'text' | 'document'>('text');
  const [text, setText] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [contactId, setContactId] = useState('');
  const [result, setResult] = useState<ContractAuditDto | null>(null);

  const projectsQuery = useQuery({
    queryKey: ['projects-for-audit'],
    queryFn: () => projectsApi.list('', ''),
  });
  const contactsQuery = useQuery({
    queryKey: ['contacts-for-audit'],
    queryFn: () => contactsApi.list('', ''),
  });
  const documentsQuery = useQuery({
    queryKey: ['documents-for-audit'],
    queryFn: () => documentsApi.list('', '', ''),
    enabled: mode === 'document',
  });
  const historyQuery = useQuery({
    queryKey: ['contract-audits'],
    queryFn: () => contractAiApi.list(),
  });

  const auditMutation = useMutation({
    mutationFn: () =>
      contractAiApi.auditar({
        text: mode === 'text' ? text : undefined,
        documentId: mode === 'document' ? documentId : undefined,
        projectId: projectId || undefined,
        contactId: contactId || undefined,
      }),
    onSuccess: (audit) => {
      toast('Auditoría completada', 'success');
      setResult(audit);
      queryClient.invalidateQueries({ queryKey: ['contract-audits'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const canSubmit =
    mode === 'text' ? text.trim().length > 0 : documentId.length > 0;

  return (
    <div>
      <PageHeader
        title="Auditoría de contratos"
        subtitle="Copiloto IA que detecta cláusulas de riesgo en contratos de subcontrata y pliegos antes de firmarlos"
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Formulario de auditoría */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex gap-2">
            <button
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                mode === 'text'
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 text-gray-600'
              }`}
              onClick={() => setMode('text')}
            >
              Pegar texto
            </button>
            <button
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                mode === 'document'
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 text-gray-600'
              }`}
              onClick={() => setMode('document')}
            >
              Documento ya subido
            </button>
          </div>

          {mode === 'text' ? (
            <div className={fieldCls}>
              <label className={labelCls}>Texto del contrato o pliego</label>
              <textarea
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Pega aquí el texto del contrato…"
              />
            </div>
          ) : (
            <div className={fieldCls}>
              <label className={labelCls}>Documento</label>
              <select
                className={selectCls}
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
              >
                <option value="">Selecciona un documento…</option>
                {documentsQuery.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fileName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className={fieldCls}>
              <label className={labelCls}>Obra (opcional)</label>
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
            <div className={fieldCls}>
              <label className={labelCls}>Contacto (opcional)</label>
              <select
                className={selectCls}
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
              >
                <option value="">—</option>
                {contactsQuery.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.legalName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            className={`${btnPrimaryCls} mt-4 w-full justify-center`}
            disabled={!canSubmit || auditMutation.isPending}
            onClick={() => auditMutation.mutate()}
          >
            <IconSparkles size={15} />
            {auditMutation.isPending ? 'Auditando…' : 'Auditar'}
          </button>
        </div>

        {/* Resultado de la última auditoría */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Resultado</h2>
          {!result && (
            <EmptyState
              icon={<IconGavel size={24} />}
              title="Sin auditoría todavía"
            >
              El resultado aparecerá aquí en cuanto audites un contrato.
            </EmptyState>
          )}
          {result && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <RiskBadge risk={result.overallRisk} />
                <span className="text-xs text-gray-400">
                  Modelo: {result.model}
                </span>
              </div>
              <p className="text-sm text-gray-700">{result.summary}</p>
              <div className="space-y-2">
                {result.findings.length === 0 && (
                  <p className="text-sm text-gray-400">
                    Sin cláusulas de riesgo detectadas.
                  </p>
                )}
                {result.findings.map((f, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-gray-200 p-3 text-sm"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-700">
                        {f.category}
                      </span>
                      <RiskBadge risk={f.riskLevel} />
                    </div>
                    <p className="mb-1 text-gray-500 italic">"{f.clause}"</p>
                    <p className="text-gray-700">{f.explanation}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Recomendación: {f.recommendation}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Histórico */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Auditorías anteriores</h2>
        {historyQuery.isLoading && <TableSkeleton rows={3} />}
        {historyQuery.data?.length === 0 && (
          <p className="text-sm text-gray-400">Sin auditorías todavía.</p>
        )}
        {historyQuery.error && (
          <ErrorBanner message={errText(historyQuery.error)} />
        )}
        <div className="divide-y divide-gray-100">
          {historyQuery.data?.map((a) => (
            <button
              key={a.id}
              className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm hover:bg-gray-50"
              onClick={() => setResult(a)}
            >
              <span className="min-w-0 flex-1 truncate text-gray-700">
                {a.summary}
              </span>
              <RiskBadge risk={a.overallRisk} />
              <span className="w-24 shrink-0 text-right text-xs text-gray-400">
                {formatDate(a.createdAt.slice(0, 10))}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
