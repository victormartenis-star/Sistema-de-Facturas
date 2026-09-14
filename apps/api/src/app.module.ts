import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
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
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
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
import { PermisosModule } from './modules/permisos/permisos.module';
import { ContratosObraModule } from './modules/contratos-obra/contratos-obra.module';
import { ActasRecepcionModule } from './modules/actas-recepcion/actas-recepcion.module';
import { IncidenciasPRLModule } from './modules/incidencias-prl/incidencias-prl.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { TreasuryModule } from './treasury/treasury.module';

@Module({
  imports: [
    // Límite global por defecto: 100 peticiones/min por IP. Rutas concretas
    // pueden apretar el límite con `@Throttle({ default: { limit, ttl } })`
    // — ver `POST /auth/login`, a 5/min. Va antes que AuthModule en la
    // lista: el orden de import determina el orden de los guards globales,
    // y conviene rechazar por exceso de peticiones antes de gastar tiempo
    // verificando el JWT.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
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
    PurchaseOrdersModule,
    DeliveryNotesModule,
    TreasuryModule,
    OcrModule,
    ComplianceModule,
    BudgetsModule,
    DashboardModule,
    UsersModule,
    CopilotoModule,
    ProveedoresModule,
    PermisosModule,
    ContratosObraModule,
    ActasRecepcionModule,
    IncidenciasPRLModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Middleware, no interceptor: debe correr antes que los guards para que
    // el ID de correlación quede fijado incluso en peticiones que un guard
    // rechaza (401 de JwtAuthGuard, 429 de ThrottlerGuard). Ver el propio
    // fichero para el porqué completo.
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
