'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/obras', label: 'Obras' },
  { href: '/contactos', label: 'Contactos' },
  { href: '/documentos', label: 'Documentos' },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((l) => {
        const active = pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              active
                ? 'bg-amber-50 text-amber-700'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
