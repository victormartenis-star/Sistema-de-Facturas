'use client';

import type { ReactNode } from 'react';
import {
  IconAlertTriangle,
  IconArrowUpDown,
  IconChevronDown,
  IconChevronUp,
  IconSearch,
} from './icons';

/* Clases compartidas de formularios y botones, para mantener coherencia visual */

export const inputCls =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition placeholder:text-gray-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200';

export const selectCls =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200';

export const btnPrimaryCls =
  'inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 active:scale-[.98]';

export const btnGhostCls =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900';

/** Cabecera estándar de página: título, contador y controles a la derecha. */
export function PageHeader({
  title,
  subtitle,
  count,
  children,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {count !== undefined && (
          <span className="rounded-full bg-gray-200/80 px-2.5 py-0.5 text-xs font-semibold text-gray-600 tabular-nums">
            {count}
          </span>
        )}
      </div>
      {subtitle && (
        <p className="w-full text-sm text-gray-500 sm:w-auto">{subtitle}</p>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  );
}

/** Campo de búsqueda con icono de lupa integrado. */
export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <IconSearch
        size={15}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-400"
      />
      <input
        className={`${inputCls} w-60 pl-9`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Cabecera de columna ordenable para tablas. */
export function SortableTh({
  label,
  active,
  dir,
  onClick,
  right = false,
}: {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  right?: boolean;
}) {
  return (
    <th
      className={`px-4 py-3 font-medium ${right ? 'text-right' : 'text-left'}`}
    >
      <button
        onClick={onClick}
        className={`group inline-flex items-center gap-1 text-xs font-medium tracking-wide uppercase transition ${
          active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-800'
        }`}
      >
        {label}
        {active ? (
          dir === 1 ? (
            <IconChevronUp size={12} />
          ) : (
            <IconChevronDown size={12} />
          )
        ) : (
          <IconArrowUpDown
            size={12}
            className="opacity-0 transition group-hover:opacity-60"
          />
        )}
      </button>
    </th>
  );
}

/** Esqueleto animado que se muestra mientras carga una tabla. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 bg-gray-50/60 px-4 py-3.5">
        <div className="skeleton h-3 w-1/3" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-gray-100 px-4 py-4 last:border-0"
        >
          <div className="skeleton h-3 w-16" />
          <div className="skeleton h-3 flex-1" />
          <div className="skeleton h-5 w-20 rounded-full" />
          <div className="skeleton h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

/** Estado vacío de un listado, con icono y acción opcional. */
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="animate-fade-in-up rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-500">
        {icon}
      </span>
      <p className="mt-4 font-medium text-gray-700">{title}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

/** Modal genérico: fondo oscurecido, panel centrado y cierre al pulsar fuera. */
export function Modal({
  open,
  title,
  wide = false,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-gray-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`animate-fade-in-up max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl ${
          wide ? 'max-w-3xl' : 'max-w-lg'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Clases estándar de los formularios de los modales. */
export const fieldCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200';
export const labelCls = 'mb-1 block text-xs font-medium text-gray-600';

/** Aviso de error de carga (API caída, red, etc.). */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">No se pudo cargar la información</p>
        <p className="mt-0.5 text-red-600">
          {message}. ¿Está la API en marcha?
        </p>
      </div>
    </div>
  );
}
