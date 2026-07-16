import { PROJECT_STATUS_LABELS, type ProjectStatus } from '@erp/shared';

const STYLES: Record<ProjectStatus, string> = {
  oferta: 'bg-sky-100 text-sky-700',
  adjudicada: 'bg-indigo-100 text-indigo-700',
  en_curso: 'bg-emerald-100 text-emerald-700',
  pausada: 'bg-amber-100 text-amber-700',
  finalizada: 'bg-gray-200 text-gray-700',
  garantia: 'bg-violet-100 text-violet-700',
  cerrada: 'bg-gray-100 text-gray-500',
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {PROJECT_STATUS_LABELS[status]}
    </span>
  );
}
