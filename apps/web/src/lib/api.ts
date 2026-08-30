import { DOCUMENT_MAX_SIZE_MB } from '@erp/shared';
import type {
  CashflowGrouping,
  CashflowReportDto,
  CategoryDto,
  CertificationCreateInput,
  ComplianceDocCreateInput,
  ComplianceDocDto,
  ComplianceDocUpdateInput,
  ComplianceSummaryDto,
  ComplianceWaiverDto,
  ComplianceWaiverInput,
  CertificationDto,
  CertificationInvoiceInput,
  ContactCreateInput,
  ContactDto,
  ContactUpdateInput,
  DeliveryNoteCreateInput,
  DeliveryNoteDto,
  DeliveryNoteStatus,
  DeliveryNoteUpdateInput,
  DeviationReportDto,
  DocumentDto,
  DocumentUpdateInput,
  ExtractionValidateInput,
  InvoiceCreateInput,
  InvoiceDto,
  InvoiceUpdateInput,
  MilestoneDto,
  PhaseCreateInput,
  PhaseDto,
  PhaseUpdateInput,
  ProjectCreateInput,
  ProjectDto,
  ProjectUpdateInput,
  PurchaseOrderCreateInput,
  PurchaseOrderDto,
  PurchaseOrderStatus,
  PurchaseOrderUpdateInput,
  TraceabilityReportDto,
  ValidationItemDto,
  ValidationResultDto,
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
  get: (id: string) => request<ProjectDto>(`/projects/${id}`),
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

export const phasesApi = {
  list: (projectId: string) =>
    request<PhaseDto[]>(`/projects/${projectId}/phases`),
  create: (projectId: string, input: PhaseCreateInput) =>
    request<PhaseDto>(`/projects/${projectId}/phases`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: PhaseUpdateInput) =>
    request<PhaseDto>(`/phases/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) => request<void>(`/phases/${id}`, { method: 'DELETE' }),
  /** Presupuesto teórico vs. gasto imputado real. */
  deviation: (projectId: string) =>
    request<DeviationReportDto>(`/projects/${projectId}/desvio`),
};

export const invoicesApi = {
  list: (kind: string, status: string, search: string) => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    const qs = params.toString();
    return request<InvoiceDto[]>(`/invoices${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<InvoiceDto>(`/invoices/${id}`),
  create: (input: InvoiceCreateInput) =>
    request<InvoiceDto>('/invoices', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: InvoiceUpdateInput) =>
    request<InvoiceDto>(`/invoices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  approve: (id: string) =>
    request<InvoiceDto>(`/invoices/${id}/aprobar`, { method: 'POST' }),
  markPaid: (id: string) =>
    request<InvoiceDto>(`/invoices/${id}/pagar`, { method: 'POST' }),
  cancel: (id: string) =>
    request<InvoiceDto>(`/invoices/${id}/anular`, { method: 'POST' }),
  remove: (id: string) =>
    request<void>(`/invoices/${id}`, { method: 'DELETE' }),
};

export const certificationsApi = {
  list: (projectId: string) =>
    request<CertificationDto[]>(`/certifications?projectId=${projectId}`),
  create: (input: CertificationCreateInput) =>
    request<CertificationDto>('/certifications', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  invoice: (id: string, input: CertificationInvoiceInput) =>
    request<CertificationDto>(`/certifications/${id}/facturar`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/certifications/${id}`, { method: 'DELETE' }),
};

export const purchaseOrdersApi = {
  list: (options: {
    search?: string;
    status?: PurchaseOrderStatus | '';
    projectId?: string;
    contactId?: string;
    receiving?: boolean;
  }) => {
    const params = new URLSearchParams();
    if (options.search) params.set('search', options.search);
    if (options.status) params.set('status', options.status);
    if (options.projectId) params.set('projectId', options.projectId);
    if (options.contactId) params.set('contactId', options.contactId);
    if (options.receiving) params.set('receiving', 'true');
    const qs = params.toString();
    return request<PurchaseOrderDto[]>(`/purchase-orders${qs ? `?${qs}` : ''}`);
  },
  traceability: (projectId?: string) =>
    request<TraceabilityReportDto>(
      `/purchase-orders/trazabilidad${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  create: (input: PurchaseOrderCreateInput) =>
    request<PurchaseOrderDto>('/purchase-orders', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: PurchaseOrderUpdateInput) =>
    request<PurchaseOrderDto>(`/purchase-orders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  close: (id: string) =>
    request<PurchaseOrderDto>(`/purchase-orders/${id}/cerrar`, {
      method: 'POST',
    }),
  cancel: (id: string) =>
    request<PurchaseOrderDto>(`/purchase-orders/${id}/anular`, {
      method: 'POST',
    }),
  remove: (id: string) =>
    request<void>(`/purchase-orders/${id}`, { method: 'DELETE' }),
};

export const deliveryNotesApi = {
  list: (options: {
    search?: string;
    status?: DeliveryNoteStatus | '';
    contactId?: string;
    availableForContact?: string;
  }) => {
    const params = new URLSearchParams();
    if (options.search) params.set('search', options.search);
    if (options.status) params.set('status', options.status);
    if (options.contactId) params.set('contactId', options.contactId);
    if (options.availableForContact) {
      params.set('availableForContact', options.availableForContact);
    }
    const qs = params.toString();
    return request<DeliveryNoteDto[]>(`/delivery-notes${qs ? `?${qs}` : ''}`);
  },
  create: (input: DeliveryNoteCreateInput) =>
    request<DeliveryNoteDto>('/delivery-notes', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: DeliveryNoteUpdateInput) =>
    request<DeliveryNoteDto>(`/delivery-notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  validate: (id: string) =>
    request<DeliveryNoteDto>(`/delivery-notes/${id}/validar`, {
      method: 'POST',
    }),
  remove: (id: string) =>
    request<void>(`/delivery-notes/${id}`, { method: 'DELETE' }),
};

export const ocrApi = {
  /** Estado del pipeline: avisa en la interfaz si falta la clave de la API. */
  status: () =>
    request<{ enabled: boolean; model: string | null }>('/ocr/estado'),
};

export const validationApi = {
  list: (status: string) =>
    request<ValidationItemDto[]>(
      `/validacion${status ? `?status=${status}` : ''}`,
    ),
  /** Relanza la lectura del documento con el modelo de visión. */
  reprocess: (documentId: string) =>
    request<{ documentId: string; status: string }>(
      `/documents/${documentId}/extraer`,
      { method: 'POST' },
    ),
  validate: (documentId: string, input: ExtractionValidateInput) =>
    request<ValidationResultDto>(`/validacion/${documentId}/validar`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reject: (documentId: string) =>
    request<void>(`/validacion/${documentId}/rechazar`, { method: 'POST' }),
};

export const complianceApi = {
  /** Panel de homologación; `todos` incluye los no sujetos a control. */
  list: (todos = false) =>
    request<ComplianceSummaryDto[]>(`/cumplimiento${todos ? '?todos=1' : ''}`),
  summary: (contactId: string) =>
    request<ComplianceSummaryDto>(`/contacts/${contactId}/cumplimiento`),
  setRequired: (contactId: string, required: boolean) =>
    request<ComplianceSummaryDto>(
      `/contacts/${contactId}/cumplimiento/exigir`,
      { method: 'POST', body: JSON.stringify({ required }) },
    ),
  addDoc: (contactId: string, input: ComplianceDocCreateInput) =>
    request<ComplianceDocDto>(
      `/contacts/${contactId}/cumplimiento/documentos`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  updateDoc: (docId: string, input: ComplianceDocUpdateInput) =>
    request<ComplianceDocDto>(`/cumplimiento/documentos/${docId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeDoc: (docId: string) =>
    request<void>(`/cumplimiento/documentos/${docId}`, { method: 'DELETE' }),
  block: (contactId: string, reason: string) =>
    request<ComplianceSummaryDto>(
      `/contacts/${contactId}/cumplimiento/bloquear`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),
  unblock: (contactId: string) =>
    request<ComplianceSummaryDto>(
      `/contacts/${contactId}/cumplimiento/desbloquear`,
      { method: 'POST' },
    ),
  grantWaiver: (contactId: string, input: ComplianceWaiverInput) =>
    request<ComplianceWaiverDto>(
      `/contacts/${contactId}/cumplimiento/exencion`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  revokeWaiver: (contactId: string) =>
    request<void>(`/contacts/${contactId}/cumplimiento/exencion`, {
      method: 'DELETE',
    }),
};

export const treasuryApi = {
  milestones: (options: {
    direction?: string;
    status?: string;
    from?: string;
    to?: string;
  }) => {
    const params = new URLSearchParams();
    if (options.direction) params.set('direction', options.direction);
    if (options.status) params.set('status', options.status);
    if (options.from) params.set('from', options.from);
    if (options.to) params.set('to', options.to);
    const qs = params.toString();
    return request<MilestoneDto[]>(`/treasury/milestones${qs ? `?${qs}` : ''}`);
  },
  pay: (id: string) =>
    request<void>(`/treasury/milestones/${id}/pagar`, { method: 'POST' }),
  reopen: (id: string) =>
    request<void>(`/treasury/milestones/${id}/reabrir`, { method: 'POST' }),
  cashflow: (groupBy: CashflowGrouping, from?: string, to?: string) => {
    const params = new URLSearchParams({ groupBy });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request<CashflowReportDto>(`/treasury/cashflow?${params}`);
  },
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
