'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from '@erp/shared';
import {
  contactsApi,
  documentsApi,
  formatDate,
  formatEur,
  projectsApi,
} from '@/lib/api';
import { DocStatusBadge } from '@/components/doc-status-badge';
import { ErrorBanner } from '@/components/ui';
import {
  IconBuilding,
  IconEuro,
  IconFileText,
  IconPlus,
  IconSparkles,
  IconUpload,
  IconUsers,
  type IconProps,
} from '@/components/icons';

const STATUS_BAR_COLORS: Record<ProjectStatus, string> = {
  oferta: 'bg-sky-400',
  adjudicada: 'bg-indigo-400',
  en_curso: 'bg-emerald-500',
  pausada: 'bg-amber-400',
  finalizada: 'bg-gray-400',
  garantia: 'bg-violet-400',
  cerrada: 'bg-gray-300',
};

function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: (p: IconProps) => ReactNode;
  tone: string;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="animate-fade-in-up rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}
        >
          <Icon size={19} />
        </span>
        <p className="text-sm font-medium text-gray-500">{label}</p>
      </div>
      <p className="mt-4 text-2xl font-bold tracking-tight tabular-nums">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="animate-fade-in-up rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function QuickAction({
  href,
  icon,
  title,
  subtitle,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-amber-300 hover:shadow-md"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-500 transition group-hover:bg-amber-500 group-hover:text-white">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-gray-900">
          {title}
        </span>
        <span className="block truncate text-xs text-gray-500">{subtitle}</span>
      </span>
    </Link>
  );
}

export default function DashboardPage() {
  const [today, setToday] = useState('');
  useEffect(() => {
    const text = new Intl.DateTimeFormat('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date());
    setToday(text.charAt(0).toUpperCase() + text.slice(1));
  }, []);

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
  });
  const contactsQuery = useQuery({
    queryKey: ['contacts', '', ''],
    queryFn: () => contactsApi.list('', ''),
  });
  const documentsQuery = useQuery({
    queryKey: ['documents', '', '', ''],
    queryFn: () => documentsApi.list('', '', ''),
  });

  const projects = projectsQuery.data ?? [];
  const contacts = contactsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];

  const enCurso = projects.filter((p) => p.status === 'en_curso');
  const contratado = enCurso.reduce(
    (sum, p) => sum + (p.contractAmount ?? 0),
    0,
  );
  const proveedores = contacts.filter(
    (c) => c.kind === 'proveedor' || c.kind === 'ambos',
  ).length;
  const clientes = contacts.filter(
    (c) => c.kind === 'cliente' || c.kind === 'ambos',
  ).length;
  const sinClasificar = documents.filter((d) => d.docType === null).length;

  const statusCounts = PROJECT_STATUSES.map((s) => ({
    status: s,
    count: projects.filter((p) => p.status === s).length,
  })).filter((x) => x.count > 0);

  const recentDocs = [...documents]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);

  const loading =
    projectsQuery.isLoading ||
    contactsQuery.isLoading ||
    documentsQuery.isLoading;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Panel de control</h1>
        <p className="mt-1 text-sm text-gray-500">{today || ' '}</p>
      </div>

      {projectsQuery.isError && (
        <div className="mb-6">
          <ErrorBanner message={(projectsQuery.error as Error).message} />
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-gray-200 bg-white p-5"
            >
              <div className="skeleton h-10 w-10 rounded-xl" />
              <div className="skeleton mt-4 h-6 w-24" />
              <div className="skeleton mt-2 h-3 w-32" />
            </div>
          ))}
        </div>
      )}

      {!loading && !projectsQuery.isError && (
        <>
          {/* Indicadores principales */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={IconBuilding}
              tone="bg-emerald-50 text-emerald-600"
              label="Obras en curso"
              value={String(enCurso.length)}
              hint={`de ${projects.length} en total`}
            />
            <KpiCard
              icon={IconEuro}
              tone="bg-amber-50 text-amber-600"
              label="Contratado (en curso)"
              value={formatEur(contratado)}
              hint="Suma de contratos sin IVA"
            />
            <KpiCard
              icon={IconUsers}
              tone="bg-sky-50 text-sky-600"
              label="Contactos"
              value={String(contacts.length)}
              hint={`${proveedores} proveedores · ${clientes} clientes`}
            />
            <KpiCard
              icon={IconFileText}
              tone="bg-violet-50 text-violet-600"
              label="Documentos"
              value={String(documents.length)}
              hint={
                sinClasificar > 0
                  ? `${sinClasificar} sin clasificar`
                  : 'Todos clasificados'
              }
            />
          </div>

          {/* Detalle en dos columnas */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card
              title="Obras por estado"
              action={
                <Link
                  href="/obras"
                  className="text-xs font-medium text-amber-600 hover:text-amber-700"
                >
                  Ver obras →
                </Link>
              }
            >
              {projects.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  Todavía no hay obras registradas
                </p>
              ) : (
                <>
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100">
                    {statusCounts.map(({ status, count }) => (
                      <div
                        key={status}
                        className={STATUS_BAR_COLORS[status]}
                        style={{
                          width: `${(count / projects.length) * 100}%`,
                        }}
                        title={`${PROJECT_STATUS_LABELS[status]}: ${count}`}
                      />
                    ))}
                  </div>
                  <ul className="mt-4 space-y-2.5">
                    {statusCounts.map(({ status, count }) => (
                      <li
                        key={status}
                        className="flex items-center gap-2.5 text-sm"
                      >
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_BAR_COLORS[status]}`}
                        />
                        <span className="flex-1 text-gray-700">
                          {PROJECT_STATUS_LABELS[status]}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {count}
                        </span>
                        <span className="w-12 text-right text-xs text-gray-400 tabular-nums">
                          {Math.round((count / projects.length) * 100)} %
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>

            <Card
              title="Documentos recientes"
              action={
                <Link
                  href="/documentos"
                  className="text-xs font-medium text-amber-600 hover:text-amber-700"
                >
                  Ver todos →
                </Link>
              }
            >
              {recentDocs.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  Todavía no hay documentos: sube la primera factura
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {recentDocs.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 py-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                        <IconFileText size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-sm font-medium text-gray-800"
                          title={d.fileName}
                        >
                          {d.fileName}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatDate(d.createdAt.slice(0, 10))}
                        </p>
                      </div>
                      <DocStatusBadge status={d.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Accesos rápidos */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <QuickAction
              href="/obras"
              icon={<IconPlus size={19} />}
              title="Nueva obra"
              subtitle="Alta de una obra o proyecto"
            />
            <QuickAction
              href="/documentos"
              icon={<IconUpload size={19} />}
              title="Subir facturas"
              subtitle="PDF o foto, varias a la vez"
            />
            <QuickAction
              href="/contactos"
              icon={<IconUsers size={19} />}
              title="Nuevo contacto"
              subtitle="Proveedores y clientes"
            />
          </div>

          {/* Siguiente hito de la hoja de ruta */}
          <div className="mt-6 flex items-start gap-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 p-5 text-white shadow-lg shadow-amber-500/20">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
              <IconSparkles size={20} />
            </span>
            <div>
              <p className="font-semibold">
                Siguiente paso: lectura automática de facturas con IA
              </p>
              <p className="mt-1 text-sm text-amber-50">
                Los documentos que subas hoy quedarán listos para el pipeline
                OCR/IA: extraerá número, fecha, proveedor, importes e IVA, y tú
                solo tendrás que validar.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
