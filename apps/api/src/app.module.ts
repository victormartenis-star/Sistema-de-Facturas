import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BudgetsModule } from './budgets/budgets.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { UsersModule } from './users/users.module';
import { CopilotoModule } from './copiloto/copiloto.module';
import { CategoriesModule } from './categories/categories.module';
import { CertificationsModule } from './certifications/certifications.module';
import { ComplianceModule } from './compliance/compliance.module';
import { ComparativosModule } from './modules/comparativos/comparativos.module';
import { ContactsModule } from './contacts/contacts.module';
import { CostControlModule } from './cost-control/cost-control.module';
import { ExportsModule } from './exports/exports.module';
import { CommonModule } from './common/common.module';
import { DbModule } from './db/db.module';
import { DeliveryNotesModule } from './delivery-notes/delivery-notes.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';
import { InvoicesModule } from './invoices/invoices.module';
import { MetricsModule } from './metrics/metrics.module';
import { OcrModule } from './ocr/ocr.module';
import { PartesDiariosModule } from './modules/partes-diarios/partes-diarios.module';
import { PhasesModule } from './phases/phases.module';
import { ProjectsModule } from './projects/projects.module';
import { ProveedoresModule } from './modules/proveedores/proveedores.module';
import { SubcontratasModule } from './modules/subcontratas/subcontratas.module';
import { PermisosModule } from './modules/permisos/permisos.module';
import { ContratosObraModule } from './modules/contratos-obra/contratos-obra.module';
import { ActasRecepcionModule } from './modules/actas-recepcion/actas-recepcion.module';
import { IncidenciasPRLModule } from './modules/incidencias-prl/incidencias-prl.module';
import { EquiposModule } from './modules/equipos/equipos.module';
import { TrabajadoresModule } from './modules/trabajadores/trabajadores.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { TreasuryModule } from './treasury/treasury.module';
import { ContabilidadModule } from './contabilidad/contabilidad.module';
import { ActivosModule } from './activos/activos.module';
import { AlmacenModule } from './almacen/almacen.module';
import { CarteraModule } from './cartera/cartera.module';
import { ComprasModule } from './compras/compras.module';
import { ProjectSystemModule } from './project-system/project-system.module';
import { TalonesModule } from './talones/talones.module';
import { BancaModule } from './banca/banca.module';
import { EamModule } from './eam/eam.module';
import { AprobacionesModule } from './aprobaciones/aprobaciones.module';
import { HoldingModule } from './holding/holding.module';
import { WipModule } from './wip/wip.module';
import { AvalesModule } from './avales/avales.module';
import { EsgModule } from './modules/esg/esg.module';
import { FleetIotModule } from './modules/fleet-iot/fleet-iot.module';
import { ChangeOrdersModule } from './modules/change-orders/change-orders.module';
import { ESignatureModule } from './modules/e-signature/e-signature.module';
import { BimModule } from './modules/bim/bim.module';
import { ContractAiModule } from './modules/contract-ai/contract-ai.module';
import { InvestorsModule } from './modules/investors/investors.module';
import { RealEstateModule } from './modules/real-estate/real-estate.module';
import { OfflineFieldModule } from './modules/offline-field/offline-field.module';
import { AlertsModule } from './alerts/alerts.module';
import { BankReconciliationModule } from './modules/bank-reconciliation/bank-reconciliation.module';
import { SearchModule } from './search/search.module';
import { InformesModule } from './modules/informes/informes.module';

@Module({
  imports: [
    // Límite global por defecto: 100 peticiones/min por IP. Rutas concretas
    // pueden apretar el límite con `@Throttle({ default: { limit, ttl } })`
    // — ver `POST /auth/login`, a 5/min. Va antes que AuthModule en la
    // lista: el orden de import determina el orden de los guards globales,
    // y conviene rechazar por exceso de peticiones antes de gastar tiempo
    // verificando el JWT.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    CommonModule,
    DbModule,
    AuditModule,
    AuthModule,
    HealthModule,
    MetricsModule,
    ProjectsModule,
    ContactsModule,
    CategoriesModule,
    DocumentsModule,
    PhasesModule,
    InvoicesModule,
    CertificationsModule,
    ComparativosModule,
    PartesDiariosModule,
    CostControlModule,
    ExportsModule,
    PurchaseOrdersModule,
    DeliveryNotesModule,
    TreasuryModule,
    ContabilidadModule,
    CarteraModule,
    ComprasModule,
    TalonesModule,
    BancaModule,
    EamModule,
    ProjectSystemModule,
    ActivosModule,
    AlmacenModule,
    AprobacionesModule,
    HoldingModule,
    WipModule,
    AvalesModule,
    OcrModule,
    ComplianceModule,
    BudgetsModule,
    DashboardModule,
    UsersModule,
    CopilotoModule,
    ProveedoresModule,
    SubcontratasModule,
    PermisosModule,
    ContratosObraModule,
    ActasRecepcionModule,
    IncidenciasPRLModule,
    EquiposModule,
    TrabajadoresModule,
    EsgModule,
    FleetIotModule,
    ChangeOrdersModule,
    ESignatureModule,
    BimModule,
    ContractAiModule,
    InvestorsModule,
    RealEstateModule,
    OfflineFieldModule,
    AlertsModule,
    BankReconciliationModule,
    SearchModule,
    InformesModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
