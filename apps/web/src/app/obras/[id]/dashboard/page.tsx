'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '@/lib/api';
import { DashboardEjecutivo } from '@/components/obra-dashboard/dashboard-ejecutivo';

export default function DashboardObraPage() {
  const { id } = useParams<{ id: string }>();
  const project = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id),
  });

  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <Link
          href={`/obras/${id}`}
          className="text-xs font-medium text-gray-500 hover:text-amber-600"
        >
          ← Ficha de la obra
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          Dashboard ejecutivo
          {project.data && (
            <span className="font-normal text-gray-500">
              {' '}
              · {project.data.name}
            </span>
          )}
        </h1>
      </div>
      <DashboardEjecutivo projectId={id} />
    </div>
  );
}
