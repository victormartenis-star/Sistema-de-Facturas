import { DOCUMENT_MAX_SIZE_MB } from '@erp/shared';
import type {
  CategoryDto,
  ContactCreateInput,
  ContactDto,
  ContactUpdateInput,
  DocumentDto,
  DocumentUpdateInput,
  ProjectCreateInput,
  ProjectDto,
  ProjectUpdateInput,
} from '@erp/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fieldErrors: { field: string; message: string }[] = [],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Con FormData el navegador fija el Content-Type (incluye el boundary)
  const isFormData =
    typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = `Error ${res.status}`;
    let fieldErrors: { field: string; message: string }[] = [];
    try {
      const body = await res.json();
      message = body.message ?? message;
      fieldErrors = body.errors ?? [];
    } catch {
      // sin cuerpo JSON
    }
    if (res.status === 413) {
      message = `El archivo supera el máximo de ${DOCUMENT_MAX_SIZE_MB} MB`;
    }
    throw new ApiError(message, res.status, fieldErrors);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const projectsApi = {
  list: (search: string, status: string) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    const qs = params.toString();
    return request<ProjectDto[]>(`/projects${qs ? `?${qs}` : ''}`);
  },
  create: (input: ProjectCreateInput) =>
    request<ProjectDto>('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: ProjectUpdateInput) =>
    request<ProjectDto>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),
};

export const contactsApi = {
  list: (search: string, kind: string) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (kind) params.set('kind', kind);
    const qs = params.toString();
    return request<ContactDto[]>(`/contacts${qs ? `?${qs}` : ''}`);
  },
  create: (input: ContactCreateInput) =>
    request<ContactDto>('/contacts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: ContactUpdateInput) =>
    request<ContactDto>(`/contacts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/contacts/${id}`, { method: 'DELETE' }),
};

export const categoriesApi = {
  list: () => request<CategoryDto[]>('/categories'),
};

export const documentsApi = {
  list: (search: string, status: string, docType: string) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (docType) params.set('docType', docType);
    const qs = params.toString();
    return request<DocumentDto[]>(`/documents${qs ? `?${qs}` : ''}`);
  },
  upload: (file: File, meta?: { projectId?: string; docType?: string }) => {
    const form = new FormData();
    form.append('file', file);
    if (meta?.projectId) form.append('projectId', meta.projectId);
    if (meta?.docType) form.append('docType', meta.docType);
    return request<DocumentDto>('/documents', { method: 'POST', body: form });
  },
  update: (id: string, input: DocumentUpdateInput) =>
    request<DocumentDto>(`/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/documents/${id}`, { method: 'DELETE' }),
};

/** URL del original (visor); la sirve la API en streaming. */
export function documentFileUrl(id: string): string {
  return `${API_URL}/documents/${id}/file`;
}

export function formatEur(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
