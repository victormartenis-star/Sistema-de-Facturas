import { DOCUMENT_MAX_SIZE_MB } from '@erp/shared';
import type {
  AuditEntryDto,
  AuditQuery,
  Capability,
  StoppageCreateInput,
  StoppageDto,
  StoppageReportDto,
  StoppageUpdateInput,
  ThirteenWeekDto,
  CategoryDto,
  ChecklistDto,
  ChecklistMarkInput,
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
  CostForecastDto,
  CostForecastInput,
  DeliveryNoteCreateInput,
  DeliveryNoteDto,
  DeliveryNoteStatus,
  DeliveryNoteUpdateInput,
  DeviationReportDto,
  MonthlyPlanRowDto,
  MonthlyPlanSaveInput,
  ProjectEconomicsDto,
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
  PermitBoardDto,
  PermitCreateInput,
  PermitDto,
  PermitUpdateInput,
  ProjectCreateInput,
  ProjectDto,
  ProjectUpdateInput,
  PurchaseOrderCreateInput,
  PurchaseOrderDto,
  PurchaseOrderStatus,
  PurchaseOrderUpdateInput,
  TraceabilityReportDto,
  ValidationItemDto,
  GateListDto,
  WorkerAssignmentInput,
  WorkerCreateInput,
  WorkerDocInput,
  WorkerDto,
  WorkerUpdateInput,
  VariationApproveInput,
  VariationCreateInput,
  VariationDto,
  VariationRejectInput,
  VariationReportDto,
  VariationUpdateInput,
  ValidationResultDto,
  LoginInput,
  SessionDto,
  UserCreateInput,
  UserDto,
  UserUpdateInput,
} from '@erp/shared';

import { clearSession, sessionToken } from './session';

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
  const token = sessionToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  // Sesión caducada o revocada: se limpia y se vuelve a la pantalla de acceso
  // en lugar de dejar la interfaz mostrando errores sueltos.
  if (res.status === 401 && typeof window !== 'undefined') {
    clearSession();
    if (!window.location.pathname.startsWith('/acceso')) {
      window.location.href = '/acceso';
    }
  }
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

export const workersApi = {
  list: (options: { contactId?: string; projectId?: string } = {}) => {
    const params = new URLSearchParams();
    if (options.contactId) params.set('contactId', options.contactId);
    if (options.projectId) params.set('projectId', options.projectId);
    const qs = params.toString();
    return request<WorkerDto[]>(`/workers${qs ? `?${qs}` : ''}`);
  },
  gateList: (projectId: string) =>
    request<GateListDto>(`/workers/valla/${projectId}`),
  create: (input: WorkerCreateInput) =>
    request<WorkerDto>('/workers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: WorkerUpdateInput) =>
    request<WorkerDto>(`/workers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  saveDoc: (id: string, input: WorkerDocInput) =>
    request<WorkerDto>(`/workers/${id}/documentos`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  setAssignment: (id: string, input: WorkerAssignmentInput) =>
    request<WorkerDto>(`/workers/${id}/obras`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  remove: (id: string) => request<void>(`/workers/${id}`, { method: 'DELETE' }),
};

export const auditApi = {
  list: (query: AuditQuery) => {
    const params = new URLSearchParams();
    if (query.entity) params.set('entity', query.entity);
    if (query.entityId) params.set('entityId', query.entityId);
    if (query.userId) params.set('userId', query.userId);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.limit) params.set('limit', String(query.limit));
    const qs = params.toString();
    return request<AuditEntryDto[]>(`/audit${qs ? `?${qs}` : ''}`);
  },
};

export const authApi = {
  login: (input: LoginInput) =>
    request<SessionDto>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  me: () => request<UserDto & { capabilities: Capability[] }>('/auth/me'),
  listUsers: () => request<UserDto[]>('/auth/users'),
  createUser: (input: UserCreateInput) =>
    request<UserDto>('/auth/users', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateUser: (id: string, input: UserUpdateInput) =>
    request<UserDto>(`/auth/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};

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

export const checklistApi = {
  get: (projectId: string) => request<ChecklistDto>(`/checklist/${projectId}`),
  mark: (projectId: string, input: ChecklistMarkInput) =>
    request<ChecklistDto>(`/checklist/${projectId}`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

export const permitsApi = {
  list: (projectId?: string) =>
    request<PermitDto[]>(
      `/permits${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  board: (projectId: string) =>
    request<PermitBoardDto>(`/permits/semaforo/${projectId}`),
  alerts: () => request<PermitDto[]>('/permits/avisos'),
  create: (input: PermitCreateInput) =>
    request<PermitDto>('/permits', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: PermitUpdateInput) =>
    request<PermitDto>(`/permits/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) => request<void>(`/permits/${id}`, { method: 'DELETE' }),
};

export const variationsApi = {
  list: (projectId?: string) =>
    request<VariationDto[]>(
      `/variations${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  report: (projectId: string) =>
    request<VariationReportDto>(`/variations/informe/${projectId}`),
  create: (input: VariationCreateInput) =>
    request<VariationDto>('/variations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: VariationUpdateInput) =>
    request<VariationDto>(`/variations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  approve: (id: string, input: VariationApproveInput) =>
    request<VariationDto>(`/variations/${id}/aprobar`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reject: (id: string, input: VariationRejectInput) =>
    request<VariationDto>(`/variations/${id}/rechazar`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reopen: (id: string) =>
    request<VariationDto>(`/variations/${id}/reabrir`, { method: 'POST' }),
  remove: (id: string) =>
    request<void>(`/variations/${id}`, { method: 'DELETE' }),
};

export const forecastApi = {
  economics: (projectId: string) =>
    request<ProjectEconomicsDto>(`/forecast/${projectId}/economia`),
  getPlan: (projectId: string) =>
    request<MonthlyPlanRowDto[]>(`/forecast/${projectId}/plan`),
  savePlan: (projectId: string, input: MonthlyPlanSaveInput) =>
    request<MonthlyPlanRowDto[]>(`/forecast/${projectId}/plan`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  listForecasts: (projectId: string) =>
    request<CostForecastDto[]>(`/forecast/${projectId}/previsiones`),
  saveForecast: (projectId: string, input: CostForecastInput) =>
    request<CostForecastDto>(`/forecast/${projectId}/previsiones`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
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
  thirteenWeek: (saldoInicial: number | null) => {
    const params = new URLSearchParams();
    if (saldoInicial !== null) params.set('saldoInicial', String(saldoInicial));
    return request<ThirteenWeekDto>(`/treasury/13-semanas?${params}`);
  },
};

/** URL del original (visor); la sirve la API en streaming. */
/**
 * URL del original de un documento. Lleva el token en la query porque la
 * abre el navegador (etiqueta `img` o pestaña nueva) y ahí no se pueden poner
 * cabeceras. La API solo acepta esa vía en peticiones GET.
 */
export function documentFileUrl(id: string): string {
  const token = sessionToken();
  return `${API_URL}/documents/${id}/file${token ? `?token=${encodeURIComponent(token)}` : ''}`;
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

export const stoppagesApi = {
  list: (projectId?: string) =>
    request<StoppageDto[]>(
      `/stoppages${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  report: (projectId: string) =>
    request<StoppageReportDto>(`/stoppages/informe/${projectId}`),
  create: (body: StoppageCreateInput) =>
    request<StoppageDto>('/stoppages', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (id: string, body: StoppageUpdateInput) =>
    request<StoppageDto>(`/stoppages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    request<void>(`/stoppages/${id}`, { method: 'DELETE' }),
};
