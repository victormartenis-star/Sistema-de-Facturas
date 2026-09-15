import { DOCUMENT_MAX_SIZE_MB } from '@erp/shared';
import type { AuditLogDto, AuditQuery, ComplianceAlertDto } from '@erp/shared';
import type {
  BimElementLinkDto,
  BimElementLinkUpsertInput,
  BimModelDto,
} from '@erp/shared';
import type { ContractAuditDto, ContractAuditRequestInput } from '@erp/shared';
import type {
  BankAccountCreateInput,
  BankAccountDto,
  BankAccountUpdateInput,
  IlliquidityProjectionDto,
} from '@erp/shared';
import type {
  DistributeDividendInput,
  DistributeDividendResultDto,
  InvestmentAccountCreateInput,
  InvestmentAccountDto,
  InvestmentAccountReportDto,
  InvestmentAccountUpdateInput,
  InvestmentCashflowCreateInput,
  InvestmentCashflowDto,
  InvestorCreateInput,
  InvestorDto,
  InvestorUpdateInput,
  ParticipationCreateInput,
  ParticipationDto,
  ParticipationUpdateInput,
} from '@erp/shared';
import type {
  ActaRecepcionCreateInput,
  ActaRecepcionDto,
  ActaRecepcionRepasoDto,
  ActaRecepcionTipo,
  ActaRecepcionUpdateInput,
  ContratoObraAnexoCreateInput,
  ContratoObraAnexoDto,
  ContratoObraCreateInput,
  ContratoObraDto,
  ContratoObraEstadoFirma,
  ContratoObraUpdateInput,
  IncidenciaPRLCreateInput,
  IncidenciaPRLDto,
  IncidenciaPRLEstado,
  IncidenciaPRLUpdateInput,
  PermisoAlertItem,
  PermisoCreateInput,
  PermisoPublicoDto,
  PermisoStatus,
  PermisoUpdateInput,
  RepasoCreateInput,
  RepasoUpdateInput,
} from '@erp/shared';
import type {
  Bc3ImportResultDto,
  BudgetCreateInput,
  BudgetDetailDto,
  BudgetDto,
  BudgetItemCreateInput,
  BudgetItemDto,
  BudgetItemUpdateInput,
  BudgetUpdateInput,
  AuthTokensDto,
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
  CertificationLineDto,
  CertificationLineCreateInput,
  ComparativoAdjudicarInput,
  ComparativoCreateInput,
  ComparativoDto,
  ComparativoMatrizDto,
  ComparativoOfertaCreateInput,
  ComparativoOfertaDto,
  ComparativoOfertaUpdateInput,
  ComparativoUpdateInput,
  ContactCreateInput,
  ContactDto,
  ContactUpdateInput,
  CostControlDto,
  DeliveryNoteCreateInput,
  DeliveryNoteDto,
  DeliveryNoteStatus,
  DeliveryNoteUpdateInput,
  DeviationReportDto,
  DocumentDto,
  DocumentUpdateInput,
  EquipoCreateInput,
  EquipoDto,
  EquipoUpdateInput,
  ExtractionValidateInput,
  InvoiceCreateInput,
  InvoiceDto,
  InvoiceUpdateInput,
  LoginInput,
  MantenimientoCreateInput,
  MantenimientoEquipoDto,
  MilestoneDto,
  ParteMaquinariaCreateInput,
  ParteMaquinariaDto,
  ParteMaquinariaUpdateInput,
  PartePersonalCreateInput,
  PartePersonalDto,
  PartePersonalUpdateInput,
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
  RegisterInput,
  TraceabilityReportDto,
  UserCreateInput,
  UserDto,
  ValidationItemDto,
  ValidationResultDto,
} from '@erp/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const ACCESS_KEY = 'erp.accessToken';
const REFRESH_KEY = 'erp.refreshToken';
const USER_KEY = 'erp.user';

export type StoredSession = {
  accessToken: string;
  refreshToken: string;
  user: UserDto;
};

export function readStoredSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const accessToken = localStorage.getItem(ACCESS_KEY);
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    const rawUser = localStorage.getItem(USER_KEY);
    if (!accessToken || !refreshToken || !rawUser) return null;
    return {
      accessToken,
      refreshToken,
      user: JSON.parse(rawUser) as UserDto,
    };
  } catch {
    return null;
  }
}

export function writeStoredSession(tokens: AuthTokensDto): void {
  localStorage.setItem(ACCESS_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(tokens.user));
}

export function clearStoredSession(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fieldErrors: { field: string; message: string }[] = [],
  ) {
    super(message);
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const session = readStoredSession();
  if (!session?.refreshToken) return false;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (!res.ok) {
      clearStoredSession();
      return false;
    }
    const tokens = (await res.json()) as AuthTokensDto;
    writeStoredSession(tokens);
    return true;
  } catch {
    clearStoredSession();
    return false;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  retried = false,
): Promise<T> {
  const isFormData =
    typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const session = readStoredSession();
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (session?.accessToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });

  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    refreshInFlight ??= tryRefresh().finally(() => {
      refreshInFlight = null;
    });
    const ok = await refreshInFlight;
    if (ok) return request<T>(path, init, true);
  }

  if (!res.ok) {
    let message = `Error ${res.status}`;
    let fieldErrors: { field: string; message: string }[] = [];
    try {
      const body = await res.json();
      message = body.message ?? message;
      if (Array.isArray(body.message)) {
        message = body.message.join(', ');
      }
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

export const authApi = {
  login: (input: LoginInput) =>
    request<AuthTokensDto>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  register: (input: RegisterInput) =>
    request<AuthTokensDto>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  refresh: (refreshToken: string) =>
    request<AuthTokensDto>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),
  logout: (refreshToken: string) =>
    request<void>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),
  me: () => request<UserDto>('/auth/me'),
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

export const comparativosApi = {
  list: (projectId?: string) =>
    request<ComparativoDto[]>(
      `/comparativos${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  matriz: (id: string) =>
    request<ComparativoMatrizDto>(`/comparativos/${id}/matriz`),
  create: (input: ComparativoCreateInput) =>
    request<ComparativoDto>('/comparativos', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: ComparativoUpdateInput) =>
    request<ComparativoDto>(`/comparativos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/comparativos/${id}`, { method: 'DELETE' }),
  addOferta: (comparativoId: string, input: ComparativoOfertaCreateInput) =>
    request<ComparativoOfertaDto>(`/comparativos/${comparativoId}/ofertas`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateOferta: (
    comparativoId: string,
    ofertaId: string,
    input: ComparativoOfertaUpdateInput,
  ) =>
    request<ComparativoOfertaDto>(
      `/comparativos/${comparativoId}/ofertas/${ofertaId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    ),
  removeOferta: (comparativoId: string, ofertaId: string) =>
    request<void>(`/comparativos/${comparativoId}/ofertas/${ofertaId}`, {
      method: 'DELETE',
    }),
  adjudicar: (id: string, input: ComparativoAdjudicarInput) =>
    request<ComparativoDto>(`/comparativos/${id}/adjudicar`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

export const partesDiariosApi = {
  listPersonal: (filter: {
    projectId?: string;
    from?: string;
    to?: string;
  }) => {
    const params = new URLSearchParams();
    if (filter.projectId) params.set('projectId', filter.projectId);
    if (filter.from) params.set('from', filter.from);
    if (filter.to) params.set('to', filter.to);
    const qs = params.toString();
    return request<PartePersonalDto[]>(
      `/partes-diarios/personal${qs ? `?${qs}` : ''}`,
    );
  },
  createPersonal: (input: PartePersonalCreateInput) =>
    request<PartePersonalDto>('/partes-diarios/personal', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updatePersonal: (id: string, input: PartePersonalUpdateInput) =>
    request<PartePersonalDto>(`/partes-diarios/personal/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removePersonal: (id: string) =>
    request<void>(`/partes-diarios/personal/${id}`, { method: 'DELETE' }),
  approvePersonal: (id: string) =>
    request<PartePersonalDto>(`/partes-diarios/personal/${id}/aprobar`, {
      method: 'POST',
    }),
  listMaquinaria: (filter: {
    projectId?: string;
    from?: string;
    to?: string;
  }) => {
    const params = new URLSearchParams();
    if (filter.projectId) params.set('projectId', filter.projectId);
    if (filter.from) params.set('from', filter.from);
    if (filter.to) params.set('to', filter.to);
    const qs = params.toString();
    return request<ParteMaquinariaDto[]>(
      `/partes-diarios/maquinaria${qs ? `?${qs}` : ''}`,
    );
  },
  createMaquinaria: (input: ParteMaquinariaCreateInput) =>
    request<ParteMaquinariaDto>('/partes-diarios/maquinaria', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateMaquinaria: (id: string, input: ParteMaquinariaUpdateInput) =>
    request<ParteMaquinariaDto>(`/partes-diarios/maquinaria/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeMaquinaria: (id: string) =>
    request<void>(`/partes-diarios/maquinaria/${id}`, { method: 'DELETE' }),
  approveMaquinaria: (id: string) =>
    request<ParteMaquinariaDto>(`/partes-diarios/maquinaria/${id}/aprobar`, {
      method: 'POST',
    }),
};

export const equiposApi = {
  list: (filter: { estado?: string; ownership?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.estado) params.set('estado', filter.estado);
    if (filter.ownership) params.set('ownership', filter.ownership);
    const qs = params.toString();
    return request<EquipoDto[]>(`/equipos${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<EquipoDto>(`/equipos/${id}`),
  create: (input: EquipoCreateInput) =>
    request<EquipoDto>('/equipos', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: EquipoUpdateInput) =>
    request<EquipoDto>(`/equipos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) => request<void>(`/equipos/${id}`, { method: 'DELETE' }),
  listMantenimientos: (equipoId: string) =>
    request<MantenimientoEquipoDto[]>(`/equipos/${equipoId}/mantenimientos`),
  createMantenimiento: (input: MantenimientoCreateInput) =>
    request<MantenimientoEquipoDto>('/equipos/mantenimientos', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  removeMantenimiento: (id: string) =>
    request<void>(`/equipos/mantenimientos/${id}`, { method: 'DELETE' }),
};

export const costControlApi = {
  get: (projectId: string) =>
    request<CostControlDto>(`/projects/${projectId}/cost-control`),
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

export const certificationLinesApi = {
  list: (certId: string) =>
    request<CertificationLineDto[]>(`/certifications/${certId}/lines`),
  create: (certId: string, input: CertificationLineCreateInput) =>
    request<CertificationLineDto>(`/certifications/${certId}/lines`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (
    certId: string,
    lineId: string,
    input: Partial<CertificationLineCreateInput>,
  ) =>
    request<CertificationLineDto>(`/certifications/${certId}/lines/${lineId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (certId: string, lineId: string) =>
    request<void>(`/certifications/${certId}/lines/${lineId}`, {
      method: 'DELETE',
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
  alertas: (days = 30) =>
    request<ComplianceAlertDto[]>(`/cumplimiento/alertas?days=${days}`),
};

export const permisosApi = {
  list: (projectId?: string, status?: PermisoStatus) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (status) params.set('status', status);
    const qs = params.toString();
    return request<PermisoPublicoDto[]>(`/permisos${qs ? `?${qs}` : ''}`);
  },
  alertas: (projectId?: string) =>
    request<PermisoAlertItem[]>(
      `/permisos/alertas${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  get: (id: string) => request<PermisoPublicoDto>(`/permisos/${id}`),
  create: (input: PermisoCreateInput) =>
    request<PermisoPublicoDto>('/permisos', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: PermisoUpdateInput) =>
    request<PermisoPublicoDto>(`/permisos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/permisos/${id}`, { method: 'DELETE' }),
};

export const contratosObraApi = {
  list: (projectId?: string, estadoFirma?: ContratoObraEstadoFirma) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (estadoFirma) params.set('estadoFirma', estadoFirma);
    const qs = params.toString();
    return request<ContratoObraDto[]>(`/contratos-obra${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<ContratoObraDto>(`/contratos-obra/${id}`),
  create: (input: ContratoObraCreateInput) =>
    request<ContratoObraDto>('/contratos-obra', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: ContratoObraUpdateInput) =>
    request<ContratoObraDto>(`/contratos-obra/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/contratos-obra/${id}`, { method: 'DELETE' }),
  listAnexos: (id: string) =>
    request<ContratoObraAnexoDto[]>(`/contratos-obra/${id}/anexos`),
  addAnexo: (id: string, input: ContratoObraAnexoCreateInput) =>
    request<ContratoObraAnexoDto>(`/contratos-obra/${id}/anexos`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  validarCAE: (id: string) =>
    request<ComplianceSummaryDto>(`/contratos-obra/${id}/cae`),
};

export const actasRecepcionApi = {
  list: (projectId?: string, tipo?: ActaRecepcionTipo) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (tipo) params.set('tipo', tipo);
    const qs = params.toString();
    return request<ActaRecepcionDto[]>(`/actas-recepcion${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<ActaRecepcionDto>(`/actas-recepcion/${id}`),
  create: (input: ActaRecepcionCreateInput) =>
    request<ActaRecepcionDto>('/actas-recepcion', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: ActaRecepcionUpdateInput) =>
    request<ActaRecepcionDto>(`/actas-recepcion/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/actas-recepcion/${id}`, { method: 'DELETE' }),
  listRepasos: (id: string) =>
    request<ActaRecepcionRepasoDto[]>(`/actas-recepcion/${id}/repasos`),
  progreso: (id: string) =>
    request<{ total: number; subsanados: number; pctSubsanado: number }>(
      `/actas-recepcion/${id}/progreso`,
    ),
  addRepaso: (id: string, input: RepasoCreateInput) =>
    request<ActaRecepcionRepasoDto>(`/actas-recepcion/${id}/repasos`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateRepaso: (repasoId: string, input: RepasoUpdateInput) =>
    request<ActaRecepcionRepasoDto>(`/actas-recepcion/repasos/${repasoId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  firmar: (id: string) =>
    request<ActaRecepcionDto>(`/actas-recepcion/${id}/firmar`, {
      method: 'POST',
    }),
};

export const incidenciasPRLApi = {
  list: (projectId?: string, estado?: IncidenciaPRLEstado) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (estado) params.set('estado', estado);
    const qs = params.toString();
    return request<IncidenciaPRLDto[]>(`/incidencias-prl${qs ? `?${qs}` : ''}`);
  },
  fueraDePlazo: (projectId?: string) =>
    request<IncidenciaPRLDto[]>(
      `/incidencias-prl/fuera-de-plazo${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  get: (id: string) => request<IncidenciaPRLDto>(`/incidencias-prl/${id}`),
  create: (input: IncidenciaPRLCreateInput) =>
    request<IncidenciaPRLDto>('/incidencias-prl', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: IncidenciaPRLUpdateInput) =>
    request<IncidenciaPRLDto>(`/incidencias-prl/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/incidencias-prl/${id}`, { method: 'DELETE' }),
};

export const bimApi = {
  list: (projectId: string) =>
    request<BimModelDto[]>(`/bim/models?projectId=${projectId}`),
  get: (id: string) => request<BimModelDto>(`/bim/models/${id}`),
  upload: (file: File, projectId: string, name: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('projectId', projectId);
    form.append('name', name);
    return request<BimModelDto>('/bim/models', { method: 'POST', body: form });
  },
  remove: (id: string) =>
    request<void>(`/bim/models/${id}`, { method: 'DELETE' }),
  listLinks: (modelId: string) =>
    request<BimElementLinkDto[]>(`/bim/models/${modelId}/links`),
  upsertLink: (
    modelId: string,
    globalId: string,
    input: BimElementLinkUpsertInput,
  ) =>
    request<BimElementLinkDto>(
      `/bim/models/${modelId}/links/${encodeURIComponent(globalId)}`,
      { method: 'PUT', body: JSON.stringify(input) },
    ),
  /**
   * Descarga el `.ifc` original ya autenticado, como buffer — el visor 3D
   * lo necesita en memoria (`IfcAPI.OpenModel`), y `/bim/models/:id/file`
   * exige `Authorization: Bearer`, que un `<img>`/`src` de navegador nunca
   * manda por su cuenta.
   */
  fetchModelBuffer: async (id: string): Promise<ArrayBuffer> => {
    const session = readStoredSession();
    const res = await fetch(`${API_URL}/bim/models/${id}/file`, {
      headers: session?.accessToken
        ? { Authorization: `Bearer ${session.accessToken}` }
        : {},
    });
    if (!res.ok) throw new ApiError(`Error ${res.status}`, res.status);
    return res.arrayBuffer();
  },
};

export const contractAiApi = {
  auditar: (input: ContractAuditRequestInput) =>
    request<ContractAuditDto>('/contract-ai/auditar', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  list: (projectId?: string) =>
    request<ContractAuditDto[]>(
      `/contract-ai/auditorias${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  get: (id: string) =>
    request<ContractAuditDto>(`/contract-ai/auditorias/${id}`),
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
  illiquidity: (from?: string) =>
    request<IlliquidityProjectionDto>(
      `/treasury/iliquidez${from ? `?from=${from}` : ''}`,
    ),
  listBankAccounts: (activa?: boolean) =>
    request<BankAccountDto[]>(
      `/treasury/cuentas${activa !== undefined ? `?activa=${activa}` : ''}`,
    ),
  createBankAccount: (input: BankAccountCreateInput) =>
    request<BankAccountDto>('/treasury/cuentas', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateBankAccount: (id: string, input: BankAccountUpdateInput) =>
    request<BankAccountDto>(`/treasury/cuentas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};

export const investorsApi = {
  listInvestors: () => request<InvestorDto[]>('/investors'),
  createInvestor: (input: InvestorCreateInput) =>
    request<InvestorDto>('/investors', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateInvestor: (id: string, input: InvestorUpdateInput) =>
    request<InvestorDto>(`/investors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  listAccounts: (projectId?: string) =>
    request<InvestmentAccountDto[]>(
      `/investment-accounts${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  getAccount: (id: string) =>
    request<InvestmentAccountDto>(`/investment-accounts/${id}`),
  createAccount: (input: InvestmentAccountCreateInput) =>
    request<InvestmentAccountDto>('/investment-accounts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateAccount: (id: string, input: InvestmentAccountUpdateInput) =>
    request<InvestmentAccountDto>(`/investment-accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeAccount: (id: string) =>
    request<void>(`/investment-accounts/${id}`, { method: 'DELETE' }),
  report: (id: string, discountRate: number, asOfDate?: string) => {
    const params = new URLSearchParams({ discountRate: String(discountRate) });
    if (asOfDate) params.set('asOfDate', asOfDate);
    return request<InvestmentAccountReportDto>(
      `/investment-accounts/${id}/informe?${params}`,
    );
  },
  listParticipations: (accountId: string) =>
    request<ParticipationDto[]>(
      `/investment-accounts/${accountId}/participations`,
    ),
  createParticipation: (accountId: string, input: ParticipationCreateInput) =>
    request<ParticipationDto>(
      `/investment-accounts/${accountId}/participations`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),
  updateParticipation: (
    accountId: string,
    participationId: string,
    input: ParticipationUpdateInput,
  ) =>
    request<ParticipationDto>(
      `/investment-accounts/${accountId}/participations/${participationId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    ),
  removeParticipation: (accountId: string, participationId: string) =>
    request<void>(
      `/investment-accounts/${accountId}/participations/${participationId}`,
      { method: 'DELETE' },
    ),
  listCashflows: (accountId: string) =>
    request<InvestmentCashflowDto[]>(
      `/investment-accounts/${accountId}/cashflows`,
    ),
  createCashflow: (accountId: string, input: InvestmentCashflowCreateInput) =>
    request<InvestmentCashflowDto>(
      `/investment-accounts/${accountId}/cashflows`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),
  distribute: (accountId: string, input: DistributeDividendInput) =>
    request<DistributeDividendResultDto>(
      `/investment-accounts/${accountId}/distribuir`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
};

export const budgetsApi = {
  /** Lista los presupuestos de una obra (sin partidas). */
  listByProject: (projectId: string) =>
    request<BudgetDto[]>(`/projects/${projectId}/budgets`),

  /** Detalle de un presupuesto con el árbol de partidas. */
  getDetail: (id: string) => request<BudgetDetailDto>(`/budgets/${id}`),

  /** Crea un presupuesto manual vacío para una obra. */
  create: (projectId: string, input: BudgetCreateInput) =>
    request<BudgetDto>(`/projects/${projectId}/budgets`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Actualiza nombre, estado o notas de un presupuesto. */
  update: (id: string, input: BudgetUpdateInput) =>
    request<BudgetDto>(`/budgets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  /** Borrado lógico del presupuesto. */
  remove: (id: string) => request<void>(`/budgets/${id}`, { method: 'DELETE' }),

  /**
   * Importa un archivo .bc3 (Presto/FIEBDC-3) como nuevo presupuesto.
   * @param projectId  UUID de la obra
   * @param file       Archivo .bc3 seleccionado por el usuario
   * @param name       Nombre del presupuesto (por defecto = nombre del archivo)
   */
  importBc3: (
    projectId: string,
    file: File,
    name?: string,
  ): Promise<Bc3ImportResultDto> => {
    const form = new FormData();
    form.append('file', file);
    if (name) form.append('name', name);
    return request<Bc3ImportResultDto>(
      `/projects/${projectId}/budgets/import/bc3`,
      { method: 'POST', body: form },
    );
  },

  // ── Partidas ────────────────────────────────────────────────────────────────

  createItem: (budgetId: string, input: BudgetItemCreateInput) =>
    request<BudgetItemDto>(`/budgets/${budgetId}/items`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateItem: (itemId: string, input: BudgetItemUpdateInput) =>
    request<BudgetItemDto>(`/budget-items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  removeItem: (itemId: string) =>
    request<void>(`/budget-items/${itemId}`, { method: 'DELETE' }),
};

export interface DashboardResumenDto {
  obras: { total: number; enCurso: number; contratado: number };
  certificaciones: {
    totalCertificado: number;
    retencionAcumulada: number;
    certsPendientesFacturar: number;
  };
  tesoreria: {
    pendienteCobro: number;
    pendientePago: number;
    vencidoCobro: number;
    vencidoPago: number;
  };
  compras: { pedidosPendientes: number; importePedidosPendientes: number };
  facturas: { ventaBorradores: number; compraBorradores: number };
}

export const usersApi = {
  list: () => request<UserDto[]>('/users'),
  create: (input: UserCreateInput) =>
    request<UserDto>('/users', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (
    id: string,
    input: Partial<{ fullName: string; role: string; isActive: boolean }>,
  ) =>
    request<UserDto>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) => request<void>(`/users/${id}`, { method: 'DELETE' }),
  listAccess: (id: string) => request<string[]>(`/users/${id}/acceso-obras`),
  setAccess: (id: string, projectIds: string[]) =>
    request<void>(`/users/${id}/acceso-obras`, {
      method: 'PUT',
      body: JSON.stringify({ projectIds }),
    }),
};

export interface CopilotoMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotoResponseDto {
  answer: string;
  toolsUsed: string[];
}

export const copilotoApi = {
  query: (question: string, history: CopilotoMessage[]) =>
    request<CopilotoResponseDto>('/copiloto/query', {
      method: 'POST',
      body: JSON.stringify({ question, history }),
    }),
};

export interface ObrasKpiRow {
  projectId: string;
  code: string;
  name: string;
  status: string;
  contractAmount: number;
  totalCertificado: number;
  pctCertificado: number;
  costReal: number;
  margenBruto: number;
  margenPct: number;
}

export const dashboardApi = {
  resumen: () => request<DashboardResumenDto>('/dashboard/resumen'),
  obrasKpi: () => request<ObrasKpiRow[]>('/dashboard/obras'),
};

export const auditApi = {
  list: (query?: Partial<AuditQuery>) => {
    const params = new URLSearchParams();
    if (query?.entityType) params.set('entityType', query.entityType);
    if (query?.entityId) params.set('entityId', query.entityId);
    if (query?.userId) params.set('userId', query.userId);
    if (query?.action) params.set('action', query.action);
    if (query?.limit !== undefined) params.set('limit', String(query.limit));
    if (query?.offset !== undefined) params.set('offset', String(query.offset));
    const qs = params.toString();
    return request<AuditLogDto[]>(`/audit${qs ? `?${qs}` : ''}`);
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
