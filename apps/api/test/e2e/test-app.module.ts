import { Module } from '@nestjs/common';
import { AlertsModule } from '../../src/alerts/alerts.module';
import { SearchModule } from '../../src/search/search.module';
import { InformesModule } from '../../src/modules/informes/informes.module';
import { AuditModule } from '../../src/audit/audit.module';
import { AuthModule } from '../../src/auth/auth.module';
import { BudgetsModule } from '../../src/budgets/budgets.module';
import { CertificationsModule } from '../../src/certifications/certifications.module';
import { ContactsModule } from '../../src/contacts/contacts.module';
import { CopilotoModule } from '../../src/copiloto/copiloto.module';
import { CostControlModule } from '../../src/cost-control/cost-control.module';
import { DashboardModule } from '../../src/dashboard/dashboard.module';
import { DbModule } from '../../src/db/db.module';
import { DeliveryNotesModule } from '../../src/delivery-notes/delivery-notes.module';
import { DocumentsModule } from '../../src/documents/documents.module';
import { BimModule } from '../../src/modules/bim/bim.module';
import { ContractAiModule } from '../../src/modules/contract-ai/contract-ai.module';
import { InvestorsModule } from '../../src/modules/investors/investors.module';
import { RealEstateModule } from '../../src/modules/real-estate/real-estate.module';
import { OfflineFieldModule } from '../../src/modules/offline-field/offline-field.module';
import { ComparativosModule } from '../../src/modules/comparativos/comparativos.module';
import { EquiposModule } from '../../src/modules/equipos/equipos.module';
import { EsgModule } from '../../src/modules/esg/esg.module';
import { PartesDiariosModule } from '../../src/modules/partes-diarios/partes-diarios.module';
import { OcrModule } from '../../src/ocr/ocr.module';
import { PhasesModule } from '../../src/phases/phases.module';
import { PermisosModule } from '../../src/modules/permisos/permisos.module';
import { IncidenciasPRLModule } from '../../src/modules/incidencias-prl/incidencias-prl.module';
import { ProjectsModule } from '../../src/projects/projects.module';
import { PurchaseOrdersModule } from '../../src/purchase-orders/purchase-orders.module';
import { TreasuryModule } from '../../src/treasury/treasury.module';
import { UsersModule } from '../../src/users/users.module';

/**
 * Módulo raíz recortado para las pruebas de integración: los mismos
 * módulos reales de negocio y de identidad que `AppModule` (mismos guards
 * globales — `JwtAuthGuard`/`RolesGuard`, vienen con `AuthModule` —, mismo
 * `RequestContextInterceptor`), pero **sin** `HealthModule`,
 * `MetricsModule` ni `ThrottlerModule`: `health.e2e-spec.ts` y
 * `metrics.e2e-spec.ts` los montan en su propio módulo de pruebas aparte
 * (no necesitan auth ni el resto de negocio, y así no le suman peso de
 * arranque — registro de Prometheus incluido — a los demás specs).
 *
 * `ProveedoresModule` ya NO se excluye (Fase 11, 14-sep-2026): su
 * `schema.ts` era un error de sintaxis real de otro proceso concurrente,
 * resuelto por esa misma sesión — hoy compila limpio y además
 * `InvoicesModule`/`PurchaseOrdersModule` lo importan directamente (guard
 * de compliance PRL, `assertAptoParaPago`), así que entra transitivamente
 * sin listarlo aquí aparte.
 *
 * `OcrModule`/`CopilotoModule`/`ContractAiModule`/`InformesModule` llaman a
 * la API de Anthropic, pero sus puntos de entrada que la tocarían de verdad
 * (`ValidationService.reprocess()`, `CopilotoService.query()`/`queryStream()`,
 * `ContractAiService.auditar()`, `InformesService.generarMensual()`)
 * comprueban `ANTHROPIC_API_KEY` primero y degradan o devuelven 400 si
 * falta — sin llamada de red real en ningún test siempre que el spec la
 * quite explícitamente de `process.env` (el `.env` de desarrollo local sí
 * trae una clave real; `copiloto.e2e-spec.ts`, `contract-ai.e2e-spec.ts` e
 * `informes.e2e-spec.ts` la borran en su `beforeAll`).
 * `OcrWorker.onApplicationBootstrap()` hace el mismo chequeo antes de
 * arrancar su `setInterval`, así que tampoco deja un timer vivo en los tests.
 *
 * Un módulo nuevo de negocio en `AppModule` que las pruebas de
 * integración deban ejercitar hay que añadirlo aquí también a mano.
 */
@Module({
  imports: [
    DbModule,
    AuditModule,
    AuthModule,
    ProjectsModule,
    ContactsModule,
    PhasesModule,
    BudgetsModule,
    CertificationsModule, // importa InvoicesModule (-> ComplianceModule, ProveedoresModule) y ChangeOrdersModule (bloqueo de certificación)
    ComparativosModule,
    PartesDiariosModule,
    EquiposModule,
    EsgModule,
    BimModule,
    ContractAiModule,
    InvestorsModule,
    RealEstateModule,
    OfflineFieldModule,
    CostControlModule,
    PurchaseOrdersModule, // importa ProveedoresModule (guard PRL)
    DeliveryNotesModule,
    DocumentsModule,
    OcrModule, // importa DocumentsModule (de nuevo, Nest lo deduplica) e InvoicesModule
    TreasuryModule,
    DashboardModule,
    CopilotoModule,
    UsersModule,
    PermisosModule,
    IncidenciasPRLModule,
    AlertsModule,
    SearchModule,
    InformesModule,
  ],
})
export class TestAppModule {}
