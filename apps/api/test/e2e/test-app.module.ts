import { Module } from '@nestjs/common';
import { AuditModule } from '../../src/audit/audit.module';
import { AuthModule } from '../../src/auth/auth.module';
import { BudgetsModule } from '../../src/budgets/budgets.module';
import { CertificationsModule } from '../../src/certifications/certifications.module';
import { ContactsModule } from '../../src/contacts/contacts.module';
import { CostControlModule } from '../../src/cost-control/cost-control.module';
import { DbModule } from '../../src/db/db.module';
import { DeliveryNotesModule } from '../../src/delivery-notes/delivery-notes.module';
import { ComparativosModule } from '../../src/modules/comparativos/comparativos.module';
import { PartesDiariosModule } from '../../src/modules/partes-diarios/partes-diarios.module';
import { PhasesModule } from '../../src/phases/phases.module';
import { ProjectsModule } from '../../src/projects/projects.module';
import { PurchaseOrdersModule } from '../../src/purchase-orders/purchase-orders.module';
import { UsersModule } from '../../src/users/users.module';

/**
 * Módulo raíz recortado para las pruebas de integración: los mismos
 * módulos reales de negocio y de identidad que `AppModule` (mismos guards
 * globales — `JwtAuthGuard`/`RolesGuard`, vienen con `AuthModule` —, mismo
 * `RequestContextInterceptor`), pero **sin** `HealthModule`,
 * `MetricsModule` ni `ThrottlerModule` (ningún spec de esta fase los
 * necesita — añadirlos no cambiaría el resultado de ningún test, solo
 * peso de arranque).
 *
 * `ProveedoresModule` ya NO se excluye (Fase 11, 14-sep-2026): su
 * `schema.ts` era un error de sintaxis real de otro proceso concurrente,
 * resuelto por esa misma sesión — hoy compila limpio y además
 * `InvoicesModule`/`PurchaseOrdersModule` lo importan directamente (guard
 * de compliance PRL, `assertAptoParaPago`), así que entra transitivamente
 * sin listarlo aquí aparte. Se deja esta nota porque durante buena parte
 * de la sesión fue justo la exclusión que explicaba por qué este fichero
 * existía en vez de usar `AppModule` directamente — sigue existiendo por
 * la otra razón (Health/Metrics/Throttler fuera), no por esa.
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
    CertificationsModule, // importa InvoicesModule, que a su vez importa ComplianceModule y ProveedoresModule
    ComparativosModule,
    PartesDiariosModule,
    CostControlModule,
    PurchaseOrdersModule, // importa ProveedoresModule (guard PRL)
    DeliveryNotesModule,
    UsersModule,
  ],
})
export class TestAppModule {}
