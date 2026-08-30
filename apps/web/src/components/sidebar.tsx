'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import {
  IconBuilding,
  IconChart,
  IconDashboard,
  IconFileText,
  IconClipboard,
  IconInbox,
  IconLock,
  IconReceipt,
  IconSparkles,
  IconUsers,
  IconWallet,
  type IconProps,
} from './icons';

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
  exact?: boolean;
}

const MAIN: NavItem[] = [
  { href: '/', label: 'Panel', icon: IconDashboard, exact: true },
];

const GESTION: NavItem[] = [
  { href: '/obras', label: 'Obras', icon: IconBuilding },
  { href: '/contactos', label: 'Contactos', icon: IconUsers },
  { href: '/documentos', label: 'Documentos', icon: IconFileText },
  { href: '/validacion', label: 'Validación IA', icon: IconSparkles },
  { href: '/pedidos', label: 'Pedidos', icon: IconClipboard },
  { href: '/facturas', label: 'Facturas', icon: IconReceipt },
  { href: '/albaranes', label: 'Albaranes', icon: IconInbox },
  { href: '/tesoreria', label: 'Tesorería', icon: IconWallet },
  { href: '/cumplimiento', label: 'Homologación', icon: IconLock },
];

/** Módulos previstos en la hoja de ruta que aún no están construidos. */
const PROXIMAMENTE: { label: string; icon: ComponentType<IconProps> }[] = [
  { label: 'Informes', icon: IconChart },
];

function SectionTitle({ children }: { children: string }) {
  return (
    <p className="mt-6 mb-2 hidden px-3 text-[11px] font-semibold tracking-wider text-slate-500 uppercase lg:block">
      {children}
    </p>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  const renderItem = (item: NavItem) => {
    const active = isActive(item);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        title={item.label}
        className={`flex items-center justify-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition lg:justify-start ${
          active
            ? 'bg-amber-500/15 text-amber-300'
            : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
        }`}
      >
        <Icon size={18} className="shrink-0" />
        <span className="hidden lg:inline">{item.label}</span>
      </Link>
    );
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-16 flex-col border-r border-white/10 bg-slate-900 lg:w-56">
      {/* Logo */}
      <div className="flex h-16 items-center justify-center gap-3 border-b border-white/10 px-3 lg:justify-start lg:px-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-sm font-bold text-white shadow-lg shadow-amber-500/25">
          SF
        </span>
        <div className="hidden min-w-0 lg:block">
          <p className="truncate text-sm font-semibold text-white">
            Sistema de Facturas
          </p>
          <p className="text-[11px] text-slate-500">ERP Construcción</p>
        </div>
      </div>

      {/* Navegación */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 lg:px-3">
        <div className="space-y-1">{MAIN.map(renderItem)}</div>

        <SectionTitle>Gestión</SectionTitle>
        <div className="space-y-1">{GESTION.map(renderItem)}</div>

        <SectionTitle>Próximamente</SectionTitle>
        <div className="space-y-1">
          {PROXIMAMENTE.map(({ label, icon: Icon }) => (
            <div
              key={label}
              title={`${label} (próximamente)`}
              className="flex cursor-not-allowed items-center justify-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 lg:justify-start"
            >
              <Icon size={18} className="shrink-0" />
              <span className="hidden flex-1 lg:inline">{label}</span>
              <IconLock size={12} className="hidden text-slate-700 lg:block" />
            </div>
          ))}
        </div>
      </nav>

      {/* Pie */}
      <div className="border-t border-white/10 px-4 py-3">
        <p className="hidden text-[11px] text-slate-500 lg:block">
          v0.1 · Fase 1
        </p>
        <p className="text-center text-[11px] text-slate-600 lg:hidden">v0.1</p>
      </div>
    </aside>
  );
}
