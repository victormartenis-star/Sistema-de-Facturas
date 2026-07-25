import { DOC_STATUS_LABELS, type DocStatus } from '@erp/shared';

const STYLES: Record<DocStatus, string> = {
  subido: 'bg-sky-100 text-sky-700',
  procesando: 'bg-amber-100 text-amber-700',
  extraido: 'bg-indigo-100 text-indigo-700',
  validado: 'bg-emerald-100 text-emerald-700',
  rechazado: 'bg-rose-100 text-rose-700',
  error: 'bg-red-100 text-red-700',
};

export function DocStatusBadge({ status }: { status: DocStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {DOC_STATUS_LABELS[status]}
    </span>
  );
}
