import { DOCUMENT_MAX_SIZE_MB } from '@erp/shared';
import {
  ApiError,
  errorDeRespuesta,
  idempotencyKey,
  ifMatch,
  nuevoUuid,
} from './api-error';
import type { ExportRecurso, PaginaDto } from '@erp/shared';
import type {
  AsientoCreateInput,
  AsientoDto,
  CuentaContableDto,
  LibroMayorDto,
  PeriodoContableDto,
  ResultadoInterfazDto,
  SumasSaldosDto,
  ActivoBajaInput,
  ActivoCreateInput,
  ActivoDetalleDto,
  ActivoDto,
  AlmacenCreateInput,
  AlmacenDto,
  AlmacenUpdateInput,
  ArticuloCreateInput,
  ArticuloDto,
  ConsumoObraDto,
  SolicitudMaterialCreateInput,
  SolicitudMaterialDto,
  PropuestaWipDto,
  ResultadoCierreWipDto,
  WipDto,
  PropuestaProvisionPerdidasDto,
  ProvisionPerdidasDto,
  AvalCreateInput,
  AvalDetalleDto,
  AvalDto,
  AvalEjecutarInput,
  AvalLiberarInput,
  AvalProrrogaInput,
  AvalComisionInput,
  ResumenAvalesDto,
  ResultadoAvisosAvalesDto,
  LineaAvalDto,
  LineaAvalCreateInput,
  LineaAvalUpdateInput,
  CierreEjercicioDto,
  PropuestaCierreEjercicioDto,
  EstimacionCierreObraDto,
  EstimacionCierreSetInput,
  CuentasAnualesDto,
  PropuestaAplicacionResultadoDto,
  AplicacionResultadoDto,
  AplicacionResultadoInput,
  DevengoAvalDto,
  ResultadoDevengoAvalesDto,
  ResultadoDevengoAutomaticoDto,
  EjecucionDevengoDto,
  ConciliacionCierreDto,
  ResultadoCierreProvisionPerdidasDto,
  AjusteConsolidacionCreateInput,
  AjusteConsolidacionDto,
  CierreConsolidacionDto,
  EstadosConsolidadosDto,
  GrupoDto,
  MiembroCreateInput,
  MiembroUpdateInput,
  PermisoConsolidacionDto,
  SociedadAccesibleDto,
  TesoreriaGrupoDto,
  EstadoAprobacionDto,
  OperacionAprobacion,
  ReglaAprobacionCreateInput,
  ReglaAprobacionDto,
  ReglaAprobacionUpdateInput,
  SolicitudAprobacionDto,
  ControlPresupuestarioDto,
  ControlPresupuestarioUpdateInput,
  CuadroMargenesDto,
  MargenesObraDto,
  ConsumoObraInput,
  DevolucionObraInput,
  EntradaStockInput,
  ExistenciaDto,
  MovimientoStockDto,
  RegularizacionStockInput,
  ResultadoAmortizacionDto,
  ResumenAlmacenDto,
  TraspasoStockInput,
} from '@erp/shared';
import type {
  CertSubcontrataCreateInput,
  CertSubcontrataFacturarInput,
  CertSubcontrataDto,
  CertSubcontrataUpdateInput,
  ContratoSubcontrataResumenDto,
  ContratosSubcontrataQuery,
  DevolucionGarantiaCreateInput,
  RetencionGarantiaDto,
} from '@erp/shared';
import type {
  AuditIntegrityReportDto,
  AuditLogDto,
  AuditQuery,
  ComplianceAlertDto,
} from '@erp/shared';
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
  CrossedMaturitiesReportDto,
  IlliquidityProjectionDto,
  SetPaymentInstrumentInput,
} from '@erp/shared';
import type {
  PostventaIncidentCreateInput,
  PostventaIncidentDto,
  PostventaIncidentUpdateStatusInput,
  RealEstateKeyHandoverCreateInput,
  RealEstateKeyHandoverDto,
  RealEstatePaymentMilestoneCreateInput,
  RealEstatePaymentMilestoneDto,
  RealEstateReservationCancelInput,
  RealEstateReservationContractInput,
  RealEstateReservationCreateInput,
  RealEstateReservationDeedInput,
  RealEstateReservationDto,
  RealEstateUnitCreateInput,
  RealEstateUnitDto,
  RealEstateUnitUpdateInput,
} from '@erp/shared';
import type {
  EsgFactorCreateInput,
  EsgFactorDto,
  EsgInformeDto,
  EsgRegistroCreateInput,
  EsgRegistroEmisionDto,
  RcdInformeDto,
  RcdValeCreateInput,
  RcdValeDto,
} from '@erp/shared';
import type {
  FichajeCreateInput,
  FichajeDto,
  PrlChecklistCreateInput,
  PrlChecklistDto,
} from '@erp/shared';
import type {
  ChangeOrderCreateInput,
  ChangeOrderDto,
  ChangeOrderEnviarInput,
  ChangeOrderResolverInput,
  ChangeOrderUpdateInput,
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
  AlertRuleDto,
  AlertRuleType,
  AlertRuleUpdateInput,
  NotificationDto,
  NotificationsRunSummaryDto,
} from '@erp/shared';
import type {
  BankImportSummaryDto,
  BankStatementFormat,
  BankTransactionDto,
  MatchCandidate,
} from '@erp/shared';
import type { SearchResultDto } from '@erp/shared';
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
  BudgetDuplicateInput,
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
  CertificationRectifyInput,
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
  SavingsOpportunityDto,
  ContactCreateInput,
  ContactDto,
  ContactUpdateInput,
  CostControlDto,
  ObraEconomicsDto,
  DeliveryNoteCreateInput,
  DeliveryNoteDto,
  DeliveryNoteStatus,
  DeliveryNoteReturnInput,
  DeliveryNoteUpdateInput,
  DeviationReportDto,
  DocumentDto,
  DocumentUpdateInput,
  EquipoCreateInput,
  EquipoDto,
  EquipoUpdateInput,
  ExtractionValidateInput,
  InvoiceCreateInput,
  InvoiceRectifyInput,
  InvoiceDto,
  InvoiceUpdateInput,
  LoginInput,
  MantenimientoCreateInput,
  MantenimientoEquipoDto,
  MilestoneDetailDto,
  MilestoneDto,
  SettlementCreateInput,
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
  TrabajadorCreateInput,
  TrabajadorDto,
  TrabajadorUpdateInput,
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

/** Query string de un listado: omite vacíos, conserva `0` y `false`. */
function filtrosAQuery(
  filtros: Record<string, string | number | boolean | null | undefined>,
): string {
  const params = new URLSearchParams();
  for (const k of Object.keys(filtros).sort()) {
    const v = filtros[k];
    if (v === '' || v === null || v === undefined) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export { ApiError };

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
    // Una por petición; el servidor la devuelve y queda en audit_log.
    'X-Request-Id': nuevoUuid(),
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
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // sin cuerpo JSON
    }
    const err = errorDeRespuesta(
      res.status,
      body,
      undefined,
      res.headers.get('X-Request-Id') ?? headers['X-Request-Id'],
    );
    if (res.status === 413) {
      throw new ApiError(
        `El archivo supera el máximo de ${DOCUMENT_MAX_SIZE_MB} MB`,
        res.status,
        err.fieldErrors,
        err.code,
        err.versionActual,
        err.correlationId,
      );
    }
    throw err;
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
  update: (id: string, input: ProjectUpdateInput, version: number) =>
    request<ProjectDto>(`/projects/${id}`, {
      method: 'PATCH',
      headers: ifMatch(version),
      body: JSON.stringify(input),
    }),
  remove: (id: string, version: number) =>
    request<void>(`/projects/${id}`, {
      method: 'DELETE',
      headers: ifMatch(version),
    }),
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
  update: (id: string, input: ContactUpdateInput, version: number) =>
    request<ContactDto>(`/contacts/${id}`, {
      method: 'PATCH',
      headers: ifMatch(version),
      body: JSON.stringify(input),
    }),
  remove: (id: string, version: number) =>
    request<void>(`/contacts/${id}`, {
      method: 'DELETE',
      headers: ifMatch(version),
    }),
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
  ahorro: () => request<SavingsOpportunityDto[]>('/comparativos/ahorro'),
  resumenAhorro: (opportunities: SavingsOpportunityDto[]) =>
    request<{ resumen: string }>('/comparativos/ahorro/resumen', {
      method: 'POST',
      body: JSON.stringify({ opportunities }),
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

export const trabajadoresApi = {
  list: (filter: { activo?: boolean; tipo?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.activo !== undefined)
      params.set('activo', String(filter.activo));
    if (filter.tipo) params.set('tipo', filter.tipo);
    const qs = params.toString();
    return request<TrabajadorDto[]>(`/trabajadores${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<TrabajadorDto>(`/trabajadores/${id}`),
  create: (input: TrabajadorCreateInput) =>
    request<TrabajadorDto>('/trabajadores', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: TrabajadorUpdateInput) =>
    request<TrabajadorDto>(`/trabajadores/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/trabajadores/${id}`, { method: 'DELETE' }),
};

export const costControlApi = {
  get: (projectId: string) =>
    request<CostControlDto>(`/projects/${projectId}/cost-control`),
  /** Margen bruto, desviación por partida, retenciones e IVA de la obra. */
  economics: (projectId: string) =>
    request<ObraEconomicsDto>(`/projects/${projectId}/economics`),
  /** Cuadro de márgenes de la cartera (presupuestado, comprometido, real…). */
  cuadro: (f: {
    estado?: string;
    q?: string;
    desde?: string;
    hasta?: string;
    soloAlertas?: boolean;
  }) =>
    request<CuadroMargenesDto>(
      `/cost-control/margenes${qs({
        estado: f.estado,
        q: f.q,
        desde: f.desde,
        hasta: f.hasta,
        soloAlertas: f.soloAlertas ? 'true' : undefined,
      })}`,
    ),
  margenesObra: (projectId: string, f: { desde?: string; hasta?: string }) =>
    request<MargenesObraDto>(`/projects/${projectId}/margenes${qs(f)}`),
  control: (projectId: string) =>
    request<ControlPresupuestarioDto>(
      `/projects/${projectId}/control-presupuestario`,
    ),
  configurarControl: (
    projectId: string,
    input: ControlPresupuestarioUpdateInput,
    version: number,
  ) =>
    request<ControlPresupuestarioDto>(
      `/projects/${projectId}/control-presupuestario`,
      {
        method: 'PUT',
        body: JSON.stringify(input),
        headers: version > 0 ? ifMatch(version) : {},
      },
    ),
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
  /** Listado paginado en servidor (la API responde `PaginaDto` si hay `page`). */
  listPaginado: (f: {
    kind?: string;
    status?: string;
    search?: string;
    projectId?: string;
    page: number;
    pageSize: number;
  }) => request<PaginaDto<InvoiceDto>>(`/invoices${filtrosAQuery(f)}`),
  get: (id: string) => request<InvoiceDto>(`/invoices/${id}`),
  /** `clave`: Idempotency-Key del intento; si falta se genera una nueva. */
  create: (input: InvoiceCreateInput, clave?: string) =>
    request<InvoiceDto>('/invoices', {
      method: 'POST',
      headers: idempotencyKey(clave ?? nuevoUuid()),
      body: JSON.stringify(input),
    }),
  update: (id: string, input: InvoiceUpdateInput, version?: number) =>
    request<InvoiceDto>(`/invoices/${id}`, {
      method: 'PATCH',
      headers: ifMatch(version),
      body: JSON.stringify(input),
    }),
  approve: (id: string) =>
    request<InvoiceDto>(`/invoices/${id}/aprobar`, { method: 'POST' }),
  markPaid: (id: string) =>
    request<InvoiceDto>(`/invoices/${id}/pagar`, { method: 'POST' }),
  /**
   * Anula la factura. Fuera de borrador la API exige `motivo` (5-500
   * caracteres); siempre se envía un cuerpo JSON, aunque sea `{}`.
   */
  cancel: (id: string, motivo?: string) =>
    request<InvoiceDto>(`/invoices/${id}/anular`, {
      method: 'POST',
      body: JSON.stringify(motivo ? { motivo } : {}),
    }),
  /** Crea la factura rectificativa (total o por diferencias) en borrador. */
  rectify: (id: string, input: InvoiceRectifyInput, clave?: string) =>
    request<InvoiceDto>(`/invoices/${id}/rectificar`, {
      method: 'POST',
      headers: idempotencyKey(clave ?? nuevoUuid()),
      body: JSON.stringify(input),
    }),
  remove: (id: string, version?: number) =>
    request<void>(`/invoices/${id}`, {
      method: 'DELETE',
      headers: ifMatch(version),
    }),
};

export const certificationsApi = {
  listPaginado: (f: {
    projectId: string;
    status?: string;
    page: number;
    pageSize: number;
  }) =>
    request<PaginaDto<CertificationDto>>(`/certifications${filtrosAQuery(f)}`),
  list: (projectId: string) =>
    request<CertificationDto[]>(`/certifications?projectId=${projectId}`),
  create: (input: CertificationCreateInput, clave?: string) =>
    request<CertificationDto>('/certifications', {
      method: 'POST',
      headers: idempotencyKey(clave ?? nuevoUuid()),
      body: JSON.stringify(input),
    }),
  invoice: (id: string, input: CertificationInvoiceInput) =>
    request<CertificationDto>(`/certifications/${id}/facturar`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** Certificación rectificativa: fija un nuevo acumulado a origen (puede bajar). */
  rectify: (id: string, input: CertificationRectifyInput) =>
    request<CertificationDto>(`/certifications/${id}/rectificar`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  remove: (id: string, version?: number) =>
    request<void>(`/certifications/${id}`, {
      method: 'DELETE',
      headers: ifMatch(version),
    }),
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
    version?: number,
  ) =>
    request<CertificationLineDto>(`/certifications/${certId}/lines/${lineId}`, {
      method: 'PATCH',
      headers: ifMatch(version),
      body: JSON.stringify(input),
    }),
  remove: (certId: string, lineId: string, version?: number) =>
    request<void>(`/certifications/${certId}/lines/${lineId}`, {
      method: 'DELETE',
      headers: ifMatch(version),
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
  get: (id: string) => request<PurchaseOrderDto>(`/purchase-orders/${id}`),
  update: (id: string, input: PurchaseOrderUpdateInput, version?: number) =>
    request<PurchaseOrderDto>(`/purchase-orders/${id}`, {
      method: 'PATCH',
      headers: ifMatch(version),
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
  remove: (id: string, version?: number) =>
    request<void>(`/purchase-orders/${id}`, {
      method: 'DELETE',
      headers: ifMatch(version),
    }),
};

export const deliveryNotesApi = {
  listPaginado: (f: {
    search?: string;
    status?: string;
    projectId?: string;
    page: number;
    pageSize: number;
  }) =>
    request<PaginaDto<DeliveryNoteDto>>(`/delivery-notes${filtrosAQuery(f)}`),
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
  update: (id: string, input: DeliveryNoteUpdateInput, version?: number) =>
    request<DeliveryNoteDto>(`/delivery-notes/${id}`, {
      method: 'PATCH',
      headers: ifMatch(version),
      body: JSON.stringify(input),
    }),
  validate: (id: string) =>
    request<DeliveryNoteDto>(`/delivery-notes/${id}/validar`, {
      method: 'POST',
    }),
  /** Devuelve un albarán validado (sin factura) a pendiente, con motivo. */
  returnToPending: (id: string, input: DeliveryNoteReturnInput) =>
    request<DeliveryNoteDto>(`/delivery-notes/${id}/devolver`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  remove: (id: string, version?: number) =>
    request<void>(`/delivery-notes/${id}`, {
      method: 'DELETE',
      headers: ifMatch(version),
    }),
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
    liquidacion?: string;
    from?: string;
    to?: string;
  }) => {
    const params = new URLSearchParams();
    if (options.direction) params.set('direction', options.direction);
    if (options.status) params.set('status', options.status);
    if (options.from) params.set('from', options.from);
    if (options.to) params.set('to', options.to);
    if (options.liquidacion) params.set('liquidacion', options.liquidacion);
    const qs = params.toString();
    return request<MilestoneDto[]>(`/treasury/milestones${qs ? `?${qs}` : ''}`);
  },
  milestoneDetail: (id: string) =>
    request<MilestoneDetailDto>(`/treasury/milestones/${id}`),
  /** Cobro o pago total o parcial; `clave` se reutiliza en los reintentos del mismo intento. */
  settle: (
    id: string,
    input: SettlementCreateInput,
    version: number,
    clave: string,
  ) =>
    request<MilestoneDetailDto>(`/treasury/milestones/${id}/liquidaciones`, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { ...ifMatch(version), ...idempotencyKey(clave) },
    }),
  cancelSettlement: (settlementId: string, motivo: string, version: number) =>
    request<MilestoneDetailDto>(
      `/treasury/liquidaciones/${settlementId}/anular`,
      {
        method: 'POST',
        body: JSON.stringify({ motivo }),
        headers: ifMatch(version),
      },
    ),
  pay: (id: string) =>
    request<void>(`/treasury/milestones/${id}/pagar`, { method: 'POST' }),
  reopen: (id: string) =>
    request<void>(`/treasury/milestones/${id}/reabrir`, { method: 'POST' }),
  setPaymentInstrument: (id: string, input: SetPaymentInstrumentInput) =>
    request<void>(`/treasury/milestones/${id}/instrumento`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  crossedMaturities: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return request<CrossedMaturitiesReportDto>(
      `/treasury/vencimientos-cruzados${qs ? `?${qs}` : ''}`,
    );
  },
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

export interface BankTransactionSuggestionDto {
  transactionId: string;
  candidates: MatchCandidate[];
}

export const bankReconciliationApi = {
  import: (bankAccountId: string, format: BankStatementFormat, file: File) => {
    const form = new FormData();
    form.append('bankAccountId', bankAccountId);
    form.append('format', format);
    form.append('file', file);
    return request<BankImportSummaryDto>('/bank-reconciliation/importar', {
      method: 'POST',
      body: form,
    });
  },
  list: (bankAccountId?: string, reconciled?: boolean) => {
    const params = new URLSearchParams();
    if (bankAccountId) params.set('bankAccountId', bankAccountId);
    if (reconciled !== undefined) params.set('reconciled', String(reconciled));
    const qs = params.toString();
    return request<BankTransactionDto[]>(
      `/bank-reconciliation/transacciones${qs ? `?${qs}` : ''}`,
    );
  },
  suggestions: (bankAccountId: string) =>
    request<BankTransactionSuggestionDto[]>(
      `/bank-reconciliation/sugerencias?bankAccountId=${bankAccountId}`,
    ),
  reconcile: (transactionId: string, milestoneId: string) =>
    request<void>(
      `/bank-reconciliation/transacciones/${transactionId}/conciliar`,
      {
        method: 'POST',
        body: JSON.stringify({ milestoneId }),
      },
    ),
  unreconcile: (transactionId: string) =>
    request<void>(
      `/bank-reconciliation/transacciones/${transactionId}/desconciliar`,
      { method: 'POST' },
    ),
};

export const changeOrdersApi = {
  list: (filter: { projectId?: string; estado?: string }) => {
    const params = new URLSearchParams();
    if (filter.projectId) params.set('projectId', filter.projectId);
    if (filter.estado) params.set('estado', filter.estado);
    const qs = params.toString();
    return request<ChangeOrderDto[]>(`/change-orders${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<ChangeOrderDto>(`/change-orders/${id}`),
  create: (input: ChangeOrderCreateInput) =>
    request<ChangeOrderDto>('/change-orders', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: ChangeOrderUpdateInput) =>
    request<ChangeOrderDto>(`/change-orders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/change-orders/${id}`, { method: 'DELETE' }),
  enviar: (id: string, input: ChangeOrderEnviarInput) =>
    request<ChangeOrderDto>(`/change-orders/${id}/enviar`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  resolver: (id: string, input: ChangeOrderResolverInput) =>
    request<ChangeOrderDto>(`/change-orders/${id}/resolver`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

export const offlineFieldApi = {
  listFichajes: (projectId?: string) =>
    request<FichajeDto[]>(
      `/fichajes${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  createFichaje: (input: FichajeCreateInput) =>
    request<FichajeDto>('/fichajes', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listChecklists: (projectId?: string) =>
    request<PrlChecklistDto[]>(
      `/checklist-prl${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  createChecklist: (input: PrlChecklistCreateInput) =>
    request<PrlChecklistDto>('/checklist-prl', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

export const esgApi = {
  listFactores: (activo?: boolean) =>
    request<EsgFactorDto[]>(
      `/esg/factores${activo !== undefined ? `?activo=${activo}` : ''}`,
    ),
  createFactor: (input: EsgFactorCreateInput) =>
    request<EsgFactorDto>('/esg/factores', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listRegistros: (projectId?: string) =>
    request<EsgRegistroEmisionDto[]>(
      `/esg/registros${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  createRegistro: (input: EsgRegistroCreateInput) =>
    request<EsgRegistroEmisionDto>('/esg/registros', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  removeRegistro: (id: string) =>
    request<void>(`/esg/registros/${id}`, { method: 'DELETE' }),
  informe: (projectId: string) =>
    request<EsgInformeDto>(`/esg/informe?projectId=${projectId}`),
  listVales: (projectId?: string) =>
    request<RcdValeDto[]>(
      `/esg/rcd/vales${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  createVale: (input: RcdValeCreateInput) =>
    request<RcdValeDto>('/esg/rcd/vales', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  removeVale: (id: string) =>
    request<void>(`/esg/rcd/vales/${id}`, { method: 'DELETE' }),
  informeRcd: (projectId: string) =>
    request<RcdInformeDto>(`/esg/rcd/informe?projectId=${projectId}`),
};

export const realEstateApi = {
  listUnits: (projectId?: string) =>
    request<RealEstateUnitDto[]>(
      `/real-estate/units${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  getUnit: (id: string) =>
    request<RealEstateUnitDto>(`/real-estate/units/${id}`),
  createUnit: (input: RealEstateUnitCreateInput) =>
    request<RealEstateUnitDto>('/real-estate/units', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateUnit: (id: string, input: RealEstateUnitUpdateInput) =>
    request<RealEstateUnitDto>(`/real-estate/units/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeUnit: (id: string) =>
    request<void>(`/real-estate/units/${id}`, { method: 'DELETE' }),
  commercialization: (projectId: string) =>
    request<{
      projectId: string;
      vendidasPct: number;
      entregadasPct: number;
      total: number;
    }>(`/real-estate/comercializacion?projectId=${projectId}`),
  listReservations: (unitId?: string) =>
    request<RealEstateReservationDto[]>(
      `/real-estate/reservations${unitId ? `?unitId=${unitId}` : ''}`,
    ),
  createReservation: (input: RealEstateReservationCreateInput) =>
    request<RealEstateReservationDto>('/real-estate/reservations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  cancelReservation: (id: string, input: RealEstateReservationCancelInput) =>
    request<RealEstateReservationDto>(
      `/real-estate/reservations/${id}/cancelar`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),
  signContract: (id: string, input: RealEstateReservationContractInput) =>
    request<RealEstateReservationDto>(
      `/real-estate/reservations/${id}/contrato`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),
  signDeed: (id: string, input: RealEstateReservationDeedInput) =>
    request<RealEstateReservationDto>(
      `/real-estate/reservations/${id}/escritura`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),
  listPayments: (reservationId: string) =>
    request<RealEstatePaymentMilestoneDto[]>(
      `/real-estate/reservations/${reservationId}/cobros`,
    ),
  createPayment: (
    reservationId: string,
    input: RealEstatePaymentMilestoneCreateInput,
  ) =>
    request<RealEstatePaymentMilestoneDto>(
      `/real-estate/reservations/${reservationId}/cobros`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  payPayment: (id: string) =>
    request<void>(`/real-estate/cobros/${id}/cobrar`, { method: 'POST' }),
  getKeyHandover: (reservationId: string) =>
    request<RealEstateKeyHandoverDto | null>(
      `/real-estate/reservations/${reservationId}/entrega-llaves`,
    ),
  createKeyHandover: (
    reservationId: string,
    input: RealEstateKeyHandoverCreateInput,
  ) =>
    request<RealEstateKeyHandoverDto>(
      `/real-estate/reservations/${reservationId}/entrega-llaves`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  listIncidents: (unitId?: string) =>
    request<PostventaIncidentDto[]>(
      `/real-estate/postventa${unitId ? `?unitId=${unitId}` : ''}`,
    ),
  createIncident: (input: PostventaIncidentCreateInput) =>
    request<PostventaIncidentDto>('/real-estate/postventa', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateIncidentStatus: (
    id: string,
    input: PostventaIncidentUpdateStatusInput,
  ) =>
    request<PostventaIncidentDto>(`/real-estate/postventa/${id}/estado`, {
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
  /** Presupuestos de una obra, paginados en servidor. */
  listPaginadoPorObra: (
    projectId: string,
    f: { status?: string; page: number; pageSize: number },
  ) =>
    request<PaginaDto<BudgetDto>>(
      `/projects/${projectId}/budgets${filtrosAQuery(f)}`,
    ),
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
  update: (id: string, input: BudgetUpdateInput, version?: number) =>
    request<BudgetDto>(`/budgets/${id}`, {
      method: 'PATCH',
      headers: ifMatch(version),
      body: JSON.stringify(input),
    }),

  /** Nueva versión (borrador) con las mismas partidas: así se corrige un presupuesto activo o cerrado. */
  duplicate: (id: string, input: BudgetDuplicateInput = {}) =>
    request<BudgetDto>(`/budgets/${id}/duplicar`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Borrado lógico del presupuesto. */
  remove: (id: string, version?: number) =>
    request<void>(`/budgets/${id}`, {
      method: 'DELETE',
      headers: ifMatch(version),
    }),

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

  updateItem: (
    itemId: string,
    input: BudgetItemUpdateInput,
    version?: number,
  ) =>
    request<BudgetItemDto>(`/budget-items/${itemId}`, {
      method: 'PATCH',
      headers: ifMatch(version),
      body: JSON.stringify(input),
    }),

  removeItem: (itemId: string, version?: number) =>
    request<void>(`/budget-items/${itemId}`, {
      method: 'DELETE',
      headers: ifMatch(version),
    }),
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
    version: number,
  ) =>
    request<UserDto>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: ifMatch(version),
    }),
  remove: (id: string, version: number) =>
    request<void>(`/users/${id}`, {
      method: 'DELETE',
      headers: ifMatch(version),
    }),
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

export type CopilotoStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'done'; toolsUsed: string[] }
  | { type: 'error'; message: string };

/**
 * `POST /copiloto/query/stream` — Server-Sent Events, no JSON: `EventSource`
 * no admite `POST` con cuerpo ni cabeceras propias, así que se consume con
 * `fetch` + el `ReadableStream` de `res.body`, troceando por `\n\n` (cada
 * evento SSE) y parseando la línea `data: {...}` de cada uno.
 *
 * Simplificación deliberada frente a `request()`: sin el reintento
 * automático de `POST /auth/refresh` en un 401 a mitad de sesión — añadirlo
 * a un flujo de streaming complica bastante el manejo (habría que reabrir
 * la conexión y no perder lo ya emitido) para un caso borde poco frecuente
 * en un panel de chat que el usuario ya tiene abierto con sesión iniciada.
 */
async function streamCopiloto(
  question: string,
  history: CopilotoMessage[],
  onEvent: (event: CopilotoStreamEvent) => void,
): Promise<void> {
  const session = readStoredSession();
  const res = await fetch(`${API_URL}/copiloto/query/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.accessToken
        ? { Authorization: `Bearer ${session.accessToken}` }
        : {}),
    },
    body: JSON.stringify({ question, history }),
  });
  if (!res.ok || !res.body) {
    throw new ApiError(`Error ${res.status}`, res.status, []);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (line) onEvent(JSON.parse(line.slice(6)) as CopilotoStreamEvent);
    }
  }
}

export const copilotoApi = {
  query: (question: string, history: CopilotoMessage[]) =>
    request<CopilotoResponseDto>('/copiloto/query', {
      method: 'POST',
      body: JSON.stringify({ question, history }),
    }),
  queryStream: streamCopiloto,
};

export interface InformeMensualDto {
  markdown: string;
  mes: string;
  projectId: string | null;
  generatedAt: string;
}

export const informesApi = {
  generarMensual: (mes: string, projectId?: string) =>
    request<InformeMensualDto>(
      `/informes/mensual?mes=${mes}${projectId ? `&projectId=${projectId}` : ''}`,
      { method: 'POST' },
    ),
  enviarEmail: (markdown: string, mes: string, to: string[]) =>
    request<{ sent: boolean }>('/informes/mensual/email', {
      method: 'POST',
      body: JSON.stringify({ markdown, mes, to }),
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

export const alertsApi = {
  listRules: () => request<AlertRuleDto[]>('/alerts/rules'),
  updateRule: (type: AlertRuleType, input: AlertRuleUpdateInput) =>
    request<AlertRuleDto>(`/alerts/rules/${type}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  listNotifications: (onlyUnread = false) =>
    request<NotificationDto[]>(
      `/alerts/notifications${onlyUnread ? '?unread=true' : ''}`,
    ),
  unreadCount: () =>
    request<{ count: number }>('/alerts/notifications/no-leidas'),
  markRead: (id: string) =>
    request<void>(`/alerts/notifications/${id}/leer`, { method: 'PATCH' }),
  markAllRead: () =>
    request<void>('/alerts/notifications/marcar-todas-leidas', {
      method: 'POST',
    }),
  run: () =>
    request<NotificationsRunSummaryDto>('/alerts/run', { method: 'POST' }),
};

export const searchApi = {
  search: (q: string) =>
    request<SearchResultDto[]>(`/search?q=${encodeURIComponent(q)}`),
};

export const auditApi = {
  list: (query?: Partial<AuditQuery>) => {
    const params = new URLSearchParams();
    if (query?.entityType) params.set('entityType', query.entityType);
    if (query?.entityId) params.set('entityId', query.entityId);
    if (query?.userId) params.set('userId', query.userId);
    if (query?.action) params.set('action', query.action);
    if (query?.correlationId) params.set('correlationId', query.correlationId);
    if (query?.limit !== undefined) params.set('limit', String(query.limit));
    if (query?.offset !== undefined) params.set('offset', String(query.offset));
    const qs = params.toString();
    return request<AuditLogDto[]>(`/audit${qs ? `?${qs}` : ''}`);
  },
  /** Solo admin (403 para el resto). Siempre 200: el veredicto va en `integra`. */
  verifyIntegrity: () =>
    request<AuditIntegrityReportDto>('/audit/verify-integrity'),
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

/**
 * Exportaciones (CSV con `;` y BOM para Excel, o JSON). Descarga con el token
 * de la sesión y dispara el guardado en el navegador.
 */
export const exportsApi = {
  download: async (
    recurso: ExportRecurso,
    params: Record<string, string | undefined> = {},
    format: 'csv' | 'json' = 'csv',
  ): Promise<void> => {
    const qs = new URLSearchParams({ format });
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const session = readStoredSession();
    const res = await fetch(`${API_URL}/exports/${recurso}?${qs.toString()}`, {
      headers: session?.accessToken
        ? { Authorization: `Bearer ${session.accessToken}` }
        : {},
    });
    if (!res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        // sin cuerpo JSON
      }
      throw errorDeRespuesta(res.status, body);
    }
    const nombre =
      /filename="([^"]+)"/.exec(
        res.headers.get('Content-Disposition') ?? '',
      )?.[1] ?? `${recurso}.${format}`;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  },
};

/** Certificaciones de subcontrata y retención de garantía. */
export const subcontratasApi = {
  contratos: (filtros: ContratosSubcontrataQuery = {}) => {
    const p = new URLSearchParams();
    if (filtros.proyectoId) p.set('proyectoId', filtros.proyectoId);
    if (filtros.proveedorId) p.set('proveedorId', filtros.proveedorId);
    const qs = p.toString();
    return request<ContratoSubcontrataResumenDto[]>(
      `/subcontratas/contratos${qs ? `?${qs}` : ''}`,
    );
  },
  certificaciones: (contratoId: string) =>
    request<CertSubcontrataDto[]>(
      `/subcontratas/contratos/${contratoId}/certificaciones`,
    ),
  /** `clave`: Idempotency-Key del intento; si falta se genera una nueva. */
  crear: (
    contratoId: string,
    input: CertSubcontrataCreateInput,
    clave?: string,
  ) =>
    request<CertSubcontrataDto>(
      `/subcontratas/contratos/${contratoId}/certificaciones`,
      {
        method: 'POST',
        headers: idempotencyKey(clave ?? nuevoUuid()),
        body: JSON.stringify(input),
      },
    ),
  editar: (id: string, input: CertSubcontrataUpdateInput, version: number) =>
    request<CertSubcontrataDto>(`/subcontratas/certificaciones/${id}`, {
      method: 'PATCH',
      headers: ifMatch(version),
      body: JSON.stringify(input),
    }),
  eliminar: (id: string, version: number) =>
    request<void>(`/subcontratas/certificaciones/${id}`, {
      method: 'DELETE',
      headers: ifMatch(version),
    }),
  aprobar: (id: string, version: number) =>
    request<CertSubcontrataDto>(`/subcontratas/certificaciones/${id}/aprobar`, {
      method: 'POST',
      headers: ifMatch(version),
    }),
  pagar: (id: string, fechaPago: string, version: number) =>
    request<CertSubcontrataDto>(`/subcontratas/certificaciones/${id}/pagar`, {
      method: 'POST',
      headers: ifMatch(version),
      body: JSON.stringify({ fechaPago }),
    }),
  /**
   * Genera y aprueba la factura de compra del subcontratista desde una
   * certificación aprobada o pagada (If-Match de la certificación).
   */
  facturarCompra: (
    id: string,
    input: CertSubcontrataFacturarInput,
    version: number,
    clave?: string,
  ) =>
    request<CertSubcontrataDto>(
      `/subcontratas/certificaciones/${id}/factura-compra`,
      {
        method: 'POST',
        headers: {
          ...ifMatch(version),
          ...idempotencyKey(clave ?? nuevoUuid()),
        },
        body: JSON.stringify(input),
      },
    ),
  anular: (id: string, motivo: string, version: number) =>
    request<CertSubcontrataDto>(`/subcontratas/certificaciones/${id}/anular`, {
      method: 'POST',
      headers: ifMatch(version),
      body: JSON.stringify({ motivo }),
    }),
  retenciones: (contratoId: string) =>
    request<RetencionGarantiaDto>(
      `/subcontratas/contratos/${contratoId}/retenciones`,
    ),
  devolverGarantia: (
    contratoId: string,
    input: DevolucionGarantiaCreateInput,
    clave?: string,
  ) =>
    request<RetencionGarantiaDto>(
      `/subcontratas/contratos/${contratoId}/devoluciones-garantia`,
      {
        method: 'POST',
        headers: idempotencyKey(clave ?? nuevoUuid()),
        body: JSON.stringify(input),
      },
    ),
};

/* ───────────────────────── Contabilidad general ───────────────────────── */

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const contabilidadApi = {
  cuentas: (q?: string, imputables?: boolean) =>
    request<CuentaContableDto[]>(
      `/contabilidad/cuentas${qs({ q, imputables: imputables ? 'true' : undefined })}`,
    ),
  inicializarPlan: () =>
    request<{ creadas: number }>('/contabilidad/cuentas/inicializar', {
      method: 'POST',
    }),
  asientos: (f: {
    desde?: string;
    hasta?: string;
    origen?: string;
    limit?: number;
    offset?: number;
  }) =>
    request<{ items: AsientoDto[]; total: number }>(
      `/contabilidad/asientos${qs(f)}`,
    ),
  crearAsiento: (input: AsientoCreateInput, clave: string) =>
    request<AsientoDto>('/contabilidad/asientos', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: idempotencyKey(clave),
    }),
  anularAsiento: (id: string, version: number, motivo: string) =>
    request<AsientoDto>(`/contabilidad/asientos/${id}/anular`, {
      method: 'POST',
      body: JSON.stringify({ motivo }),
      headers: ifMatch(version),
    }),
  contabilizarPendientes: () =>
    request<ResultadoInterfazDto>('/contabilidad/interfaz/contabilizar', {
      method: 'POST',
    }),
  mayor: (cuenta: string, desde?: string, hasta?: string) =>
    request<LibroMayorDto>(
      `/contabilidad/mayor/${encodeURIComponent(cuenta)}${qs({ desde, hasta })}`,
    ),
  sumasSaldos: (desde?: string, hasta?: string) =>
    request<SumasSaldosDto>(
      `/contabilidad/sumas-saldos${qs({ desde, hasta })}`,
    ),
  periodos: (ejercicio: number) =>
    request<PeriodoContableDto[]>(`/contabilidad/periodos/${ejercicio}`),
  cambiarPeriodo: (
    ejercicio: number,
    mes: number,
    accion: 'cerrar' | 'reabrir',
  ) =>
    request<PeriodoContableDto>(
      `/contabilidad/periodos/${ejercicio}/${mes}/${accion}`,
      { method: 'POST' },
    ),
};

/* ───────────────────────── Activos fijos ───────────────────────── */

export const activosApi = {
  listar: (f: { estado?: string; categoria?: string; q?: string } = {}) =>
    request<ActivoDto[]>(`/activos${qs(f)}`),
  detalle: (id: string) => request<ActivoDetalleDto>(`/activos/${id}`),
  crear: (input: ActivoCreateInput, clave: string) =>
    request<ActivoDetalleDto>('/activos', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: idempotencyKey(clave),
    }),
  amortizar: (hasta: string) =>
    request<ResultadoAmortizacionDto>('/activos/amortizar', {
      method: 'POST',
      body: JSON.stringify({ hasta }),
    }),
  baja: (id: string, input: ActivoBajaInput, version: number, clave: string) =>
    request<ActivoDetalleDto>(`/activos/${id}/baja`, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { ...ifMatch(version), ...idempotencyKey(clave) },
    }),
};

/* ───────────────────────── Almacén y stock ───────────────────────── */

const postJson = (body: unknown, clave: string, version?: number) => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers: {
    ...idempotencyKey(clave),
    ...(version !== undefined ? ifMatch(version) : {}),
  },
});

export const almacenApi = {
  resumen: () => request<ResumenAlmacenDto>('/almacen/resumen'),
  almacenes: () => request<AlmacenDto[]>('/almacen/almacenes'),
  crearAlmacen: (input: AlmacenCreateInput, clave: string) =>
    request<AlmacenDto>('/almacen/almacenes', postJson(input, clave)),
  actualizarAlmacen: (id: string, input: AlmacenUpdateInput, version: number) =>
    request<AlmacenDto>(`/almacen/almacenes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: ifMatch(version),
    }),
  articulos: (q?: string) =>
    request<ArticuloDto[]>(`/almacen/articulos${qs({ q })}`),
  crearArticulo: (input: ArticuloCreateInput, clave: string) =>
    request<ArticuloDto>('/almacen/articulos', postJson(input, clave)),
  existencias: (
    f: { almacenId?: string; q?: string; bajoMinimo?: boolean } = {},
  ) =>
    request<ExistenciaDto[]>(
      `/almacen/existencias${qs({
        almacenId: f.almacenId,
        q: f.q,
        bajoMinimo: f.bajoMinimo ? 'true' : undefined,
      })}`,
    ),
  stockMinimo: (id: string, stockMinimo: number, version: number) =>
    request<ExistenciaDto>(`/almacen/existencias/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ stockMinimo }),
      headers: ifMatch(version),
    }),
  movimientos: (f: {
    almacenId?: string;
    projectId?: string;
    tipo?: string;
    desde?: string;
    hasta?: string;
    page: number;
    pageSize: number;
  }) => request<PaginaDto<MovimientoStockDto>>(`/almacen/movimientos${qs(f)}`),
  entrada: (input: EntradaStockInput, clave: string) =>
    request<MovimientoStockDto[]>('/almacen/entradas', postJson(input, clave)),
  consumo: (input: ConsumoObraInput, clave: string) =>
    request<MovimientoStockDto[]>('/almacen/consumos', postJson(input, clave)),
  devolucion: (input: DevolucionObraInput, clave: string) =>
    request<MovimientoStockDto[]>(
      '/almacen/devoluciones',
      postJson(input, clave),
    ),
  traspaso: (input: TraspasoStockInput, clave: string, version?: number) =>
    request<MovimientoStockDto>(
      '/almacen/traspasos',
      postJson(input, clave, version),
    ),
  regularizacion: (
    input: RegularizacionStockInput,
    clave: string,
    version?: number,
  ) =>
    request<MovimientoStockDto>(
      '/almacen/regularizaciones',
      postJson(input, clave, version),
    ),
  consumosObra: (projectId: string) =>
    request<ConsumoObraDto>(`/almacen/obras/${projectId}/consumos`),
};

/* ─────────────────────── Aprobaciones por umbral ─────────────────────── */

export const aprobacionesApi = {
  reglas: (operacion?: string) =>
    request<ReglaAprobacionDto[]>(`/aprobaciones/reglas${qs({ operacion })}`),
  crearRegla: (input: ReglaAprobacionCreateInput, clave: string) =>
    request<ReglaAprobacionDto>('/aprobaciones/reglas', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: idempotencyKey(clave),
    }),
  actualizarRegla: (
    id: string,
    input: ReglaAprobacionUpdateInput,
    version: number,
  ) =>
    request<ReglaAprobacionDto>(`/aprobaciones/reglas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: ifMatch(version),
    }),
  solicitudes: (f: { estado?: string; operacion?: string; paraMi?: boolean }) =>
    request<SolicitudAprobacionDto[]>(
      `/aprobaciones/solicitudes${qs({
        estado: f.estado,
        operacion: f.operacion,
        paraMi: f.paraMi ? 'true' : undefined,
      })}`,
    ),
  estado: (operacion: OperacionAprobacion, entidadId: string) =>
    request<EstadoAprobacionDto>(
      `/aprobaciones/estado${qs({ operacion, entidadId })}`,
    ),
  solicitar: (
    operacion: OperacionAprobacion,
    entidadId: string,
    comentario: string | null,
    clave: string,
  ) =>
    request<SolicitudAprobacionDto>('/aprobaciones/solicitudes', {
      method: 'POST',
      body: JSON.stringify({ operacion, entidadId, comentario }),
      headers: idempotencyKey(clave),
    }),
  decidir: (
    id: string,
    accion: 'aprobar' | 'rechazar' | 'anular',
    body: { comentario?: string | null; motivo?: string },
    version: number,
    clave: string,
  ) =>
    request<SolicitudAprobacionDto>(
      `/aprobaciones/solicitudes/${id}/${accion}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { ...ifMatch(version), ...idempotencyKey(clave) },
      },
    ),
};

/* ─────────────────────── Consolidación de grupo ─────────────────────── */

const postHolding = (body: unknown, clave?: string) => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers: clave ? idempotencyKey(clave) : {},
});

export const holdingApi = {
  sociedades: () => request<SociedadAccesibleDto[]>('/holding/sociedades'),
  permisos: () => request<PermisoConsolidacionDto[]>('/holding/permisos'),
  conceder: (email: string, clave: string) =>
    request<PermisoConsolidacionDto[]>(
      '/holding/permisos',
      postHolding({ email }, clave),
    ),
  revocar: (id: string) =>
    request<PermisoConsolidacionDto[]>(
      `/holding/permisos/${id}/revocar`,
      postHolding({}),
    ),
  grupos: () => request<GrupoDto[]>('/holding/grupos'),
  crearGrupo: (nombre: string, clave: string) =>
    request<GrupoDto>('/holding/grupos', postHolding({ nombre }, clave)),
  integrar: (grupoId: string, input: MiembroCreateInput, clave: string) =>
    request<GrupoDto>(
      `/holding/grupos/${grupoId}/miembros`,
      postHolding(input, clave),
    ),
  actualizarMiembro: (
    grupoId: string,
    miembroId: string,
    input: MiembroUpdateInput,
    version: number,
  ) =>
    request<GrupoDto>(`/holding/grupos/${grupoId}/miembros/${miembroId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: ifMatch(version),
    }),
  estados: (grupoId: string, desde: string, hasta: string) =>
    request<EstadosConsolidadosDto>(
      `/holding/grupos/${grupoId}/estados${qs({ desde, hasta })}`,
    ),
  tesoreria: (grupoId: string, hasta: string) =>
    request<TesoreriaGrupoDto>(
      `/holding/grupos/${grupoId}/tesoreria${qs({ hasta })}`,
    ),
  ajustes: (grupoId: string) =>
    request<AjusteConsolidacionDto[]>(`/holding/grupos/${grupoId}/ajustes`),
  crearAjuste: (
    grupoId: string,
    input: AjusteConsolidacionCreateInput,
    clave: string,
  ) =>
    request<AjusteConsolidacionDto>(
      `/holding/grupos/${grupoId}/ajustes`,
      postHolding(input, clave),
    ),
  anularAjuste: (
    grupoId: string,
    ajusteId: string,
    motivo: string,
    version: number,
    clave: string,
  ) =>
    request<AjusteConsolidacionDto>(
      `/holding/grupos/${grupoId}/ajustes/${ajusteId}/anular`,
      {
        method: 'POST',
        body: JSON.stringify({ motivo }),
        headers: { ...ifMatch(version), ...idempotencyKey(clave) },
      },
    ),
  cierres: (grupoId: string) =>
    request<CierreConsolidacionDto[]>(`/holding/grupos/${grupoId}/cierres`),
  cerrar: (
    grupoId: string,
    p: { desde: string; hasta: string; forzar: boolean },
    clave: string,
  ) =>
    request<CierreConsolidacionDto[]>(
      `/holding/grupos/${grupoId}/cierres`,
      postHolding(p, clave),
    ),
};

/* ───────────────────── Solicitudes de material de obra ───────────────────── */

const postSolicitud = (body: unknown, clave: string, version?: number) => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers: {
    ...idempotencyKey(clave),
    ...(version !== undefined ? ifMatch(version) : {}),
  },
});

export const solicitudesMaterialApi = {
  listar: (f: { estado?: string; conFaltante?: boolean } = {}) =>
    request<SolicitudMaterialDto[]>(
      `/almacen/solicitudes${qs({
        estado: f.estado,
        conFaltante: f.conFaltante ? 'true' : undefined,
      })}`,
    ),
  crear: (input: SolicitudMaterialCreateInput, clave: string) =>
    request<SolicitudMaterialDto>(
      '/almacen/solicitudes',
      postSolicitud(input, clave),
    ),
  reservar: (id: string, version: number) =>
    request<SolicitudMaterialDto>(`/almacen/solicitudes/${id}/reservar`, {
      method: 'POST',
      headers: ifMatch(version),
    }),
  servir: (
    id: string,
    body: { fecha: string; lineas?: { lineaId: string; cantidad: number }[] },
    version: number,
    clave: string,
  ) =>
    request<{ solicitud: SolicitudMaterialDto }>(
      `/almacen/solicitudes/${id}/servir`,
      postSolicitud(body, clave, version),
    ),
  cancelar: (id: string, motivo: string, version: number, clave: string) =>
    request<SolicitudMaterialDto>(
      `/almacen/solicitudes/${id}/cancelar`,
      postSolicitud({ motivo }, clave, version),
    ),
  pedido: (
    id: string,
    body: {
      contactId: string;
      fecha: string;
      lineas: { lineaId: string; costeUnitario: number }[];
    },
    clave: string,
  ) =>
    request<{ solicitud: SolicitudMaterialDto; pedido: PurchaseOrderDto }>(
      `/almacen/solicitudes/${id}/pedido`,
      postSolicitud(body, clave),
    ),
};

/* ─────────────────────── Obra en curso (WIP) al cierre ─────────────────────── */

export const wipApi = {
  propuesta: (periodo: string) =>
    request<PropuestaWipDto[]>(`/wip/propuesta${qs({ periodo })}`),
  listar: (f: { periodo?: string; projectId?: string } = {}) =>
    request<WipDto[]>(`/wip${qs(f)}`),
  contabilizar: (periodo: string, projectId: string, clave: string) =>
    request<WipDto>('/wip', {
      method: 'POST',
      body: JSON.stringify({ periodo, projectId }),
      headers: idempotencyKey(clave),
    }),
  cierre: (periodo: string, clave: string) =>
    request<ResultadoCierreWipDto>('/wip/cierre', {
      method: 'POST',
      body: JSON.stringify({ periodo }),
      headers: idempotencyKey(clave),
    }),
  anular: (id: string, motivo: string, version: number, clave: string) =>
    request<WipDto>(`/wip/${id}/anular`, {
      method: 'POST',
      body: JSON.stringify({ motivo }),
      headers: { ...ifMatch(version), ...idempotencyKey(clave) },
    }),
};

/** Provisión por pérdidas previstas (contratos onerosos) al cierre de obra. */
export const provisionPerdidasApi = {
  propuesta: (periodo: string) =>
    request<PropuestaProvisionPerdidasDto[]>(
      `/provision-perdidas/propuesta${qs({ periodo })}`,
    ),
  listar: (f: { periodo?: string; projectId?: string } = {}) =>
    request<ProvisionPerdidasDto[]>(`/provision-perdidas${qs(f)}`),
  contabilizar: (periodo: string, projectId: string, clave: string) =>
    request<ProvisionPerdidasDto>('/provision-perdidas', {
      method: 'POST',
      body: JSON.stringify({ periodo, projectId }),
      headers: idempotencyKey(clave),
    }),
  cierre: (periodo: string, clave: string) =>
    request<ResultadoCierreProvisionPerdidasDto>('/provision-perdidas/cierre', {
      method: 'POST',
      body: JSON.stringify({ periodo }),
      headers: idempotencyKey(clave),
    }),
  anular: (id: string, motivo: string, version: number, clave: string) =>
    request<ProvisionPerdidasDto>(`/provision-perdidas/${id}/anular`, {
      method: 'POST',
      body: JSON.stringify({ motivo }),
      headers: { ...ifMatch(version), ...idempotencyKey(clave) },
    }),
};

/* ───────────────────────── Avales bancarios y garantías ───────────────────────── */

const accionAval =
  <T>(ruta: string) =>
  (id: string, input: T, version: number, clave: string) =>
    request<AvalDetalleDto>(`/avales/${id}/${ruta}`, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { ...ifMatch(version), ...idempotencyKey(clave) },
    });

export const avalesApi = {
  listar: (
    f: {
      projectId?: string;
      estado?: string;
      tipo?: string;
      direccion?: string;
      vivos?: string;
      venceEnDias?: number;
      q?: string;
    } = {},
  ) => request<AvalDto[]>(`/avales${qs(f)}`),
  resumen: (dias = 30) =>
    request<ResumenAvalesDto>(`/avales/resumen${qs({ dias })}`),
  detalle: (id: string) => request<AvalDetalleDto>(`/avales/${id}`),
  crear: (input: AvalCreateInput, clave: string) =>
    request<AvalDetalleDto>('/avales', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: idempotencyKey(clave),
    }),
  liberar: accionAval<AvalLiberarInput>('liberar'),
  ejecutar: accionAval<AvalEjecutarInput>('ejecutar'),
  prorrogar: accionAval<AvalProrrogaInput>('prorrogar'),
  comision: accionAval<AvalComisionInput>('comision'),
  avisos: (dias: number, clave: string) =>
    request<ResultadoAvisosAvalesDto>('/avales/avisos-vencimiento', {
      method: 'POST',
      body: JSON.stringify({ dias }),
      headers: idempotencyKey(clave),
    }),
  devengos: (f: { periodo?: string; avalId?: string } = {}) =>
    request<DevengoAvalDto[]>(`/avales/devengos${qs(f)}`),
  devengar: (periodo: string, clave: string) =>
    request<ResultadoDevengoAvalesDto>('/avales/devengos', {
      method: 'POST',
      body: JSON.stringify({ periodo }),
      headers: idempotencyKey(clave),
    }),
  anularDevengo: (id: string, motivo: string, version: number, clave: string) =>
    request<DevengoAvalDto>(`/avales/devengos/${id}/anular`, {
      method: 'POST',
      body: JSON.stringify({ motivo }),
      headers: {
        ...(version > 0 ? ifMatch(version) : {}),
        ...idempotencyKey(clave),
      },
    }),
  devengoAutomatico: (hasta: string | undefined, clave: string) =>
    request<ResultadoDevengoAutomaticoDto>('/avales/devengos/automatico', {
      method: 'POST',
      body: JSON.stringify(hasta ? { hasta } : {}),
      headers: idempotencyKey(clave),
    }),
  ejecucionesDevengo: () =>
    request<EjecucionDevengoDto[]>('/avales/devengos/ejecuciones'),
  lineas: () => request<LineaAvalDto[]>('/avales/lineas'),
  crearLinea: (input: LineaAvalCreateInput, clave: string) =>
    request<LineaAvalDto>('/avales/lineas', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: idempotencyKey(clave),
    }),
  actualizarLinea: (id: string, input: LineaAvalUpdateInput, version: number) =>
    request<LineaAvalDto>(`/avales/lineas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: ifMatch(version),
    }),
};

/* ───────────────────── Cierre y apertura del ejercicio ───────────────────── */

export const cierreEjercicioApi = {
  listar: () => request<CierreEjercicioDto[]>('/contabilidad/ejercicios'),
  propuesta: (ejercicio: number) =>
    request<PropuestaCierreEjercicioDto>(
      `/contabilidad/ejercicios/${ejercicio}/cierre`,
    ),
  cerrar: (ejercicio: number, clave: string) =>
    request<CierreEjercicioDto>(
      `/contabilidad/ejercicios/${ejercicio}/cerrar`,
      {
        method: 'POST',
        headers: idempotencyKey(clave),
      },
    ),
  revertir: (
    ejercicio: number,
    motivo: string,
    version: number,
    clave: string,
  ) =>
    request<CierreEjercicioDto>(
      `/contabilidad/ejercicios/${ejercicio}/revertir`,
      {
        method: 'POST',
        body: JSON.stringify({ motivo }),
        headers: { ...ifMatch(version), ...idempotencyKey(clave) },
      },
    ),
  cuentasAnuales: (ejercicio: number) =>
    request<CuentasAnualesDto>(
      `/contabilidad/ejercicios/${ejercicio}/cuentas-anuales`,
    ),
  aplicacion: (ejercicio: number) =>
    request<PropuestaAplicacionResultadoDto>(
      `/contabilidad/ejercicios/${ejercicio}/aplicacion-resultado`,
    ),
  aplicarResultado: (
    ejercicio: number,
    input: AplicacionResultadoInput,
    clave: string,
  ) =>
    request<AplicacionResultadoDto>(
      `/contabilidad/ejercicios/${ejercicio}/aplicar-resultado`,
      {
        method: 'POST',
        body: JSON.stringify(input),
        headers: idempotencyKey(clave),
      },
    ),
  anularAplicacion: (
    ejercicio: number,
    motivo: string,
    version: number,
    clave: string,
  ) =>
    request<AplicacionResultadoDto>(
      `/contabilidad/ejercicios/${ejercicio}/aplicacion-resultado/anular`,
      {
        method: 'POST',
        body: JSON.stringify({ motivo }),
        headers: {
          ...(version > 0 ? ifMatch(version) : {}),
          ...idempotencyKey(clave),
        },
      },
    ),
};

/* ───────────────────── Conciliación de cierre (auxiliar ↔ mayor) ───────────────────── */

export const conciliacionApi = {
  consultar: () => request<ConciliacionCierreDto>('/contabilidad/conciliacion'),
  historial: () =>
    request<ConciliacionCierreDto[]>('/contabilidad/conciliacion/historial'),
  registrar: (clave: string) =>
    request<ConciliacionCierreDto>('/contabilidad/conciliacion', {
      method: 'POST',
      headers: idempotencyKey(clave),
    }),
};

/* ───────────────────── Estimación al cierre (EAC) por obra ───────────────────── */

export const estimacionCierreApi = {
  obtener: (projectId: string) =>
    request<EstimacionCierreObraDto>(
      `/projects/${projectId}/estimacion-cierre`,
    ),
  /** Con versión 0 (nunca fijada) no se envía If-Match. */
  fijar: (
    projectId: string,
    input: EstimacionCierreSetInput,
    version: number,
    clave: string,
  ) =>
    request<EstimacionCierreObraDto>(
      `/projects/${projectId}/estimacion-cierre`,
      {
        method: 'POST',
        body: JSON.stringify(input),
        headers: {
          ...(version > 0 ? ifMatch(version) : {}),
          ...idempotencyKey(clave),
        },
      },
    ),
};
