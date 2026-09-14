import { Module } from '@nestjs/common';
import { AuditModule } from '../../src/audit/audit.module';
import { AuthModule } from '../../src/auth/auth.module';
import { CertificationsModule } from '../../src/certifications/certifications.module';
import { ContactsModule } from '../../src/contacts/contacts.module';
import { DbModule } from '../../src/db/db.module';
import { ProjectsModule } from '../../src/projects/projects.module';
import { UsersModule } from '../../src/users/users.module';

/**
 * Módulo raíz recortado para las pruebas de integración: los mismos
 * módulos reales de negocio y de identidad que `AppModule` (mismos guards
 * globales — `JwtAuthGuard`/`RolesGuard`, vienen con `AuthModule` —, mismo
 * `RequestContextInterceptor`), pero **sin** `ProveedoresModule`,
 * `HealthModule`, `MetricsModule` ni `ThrottlerModule`.
 *
 * `ProveedoresModule` es la exclusión que importa: su `schema.ts` tiene un
 * error de sintaxis real (`Argument expression expected`, obra en curso de
 * otro proceso, no de esta tarea — ver Roadmap y Fases, deuda técnica), y
 * como `apps/api/tsconfig.json` compila todo `src/` junto, cualquier cosa
 * que importe `AppModule` de verdad hereda ese error. Este módulo importa
 * los mismos ficheros de negocio pero ensamblados aparte, así que compila
 * limpio y las pruebas de integración pueden correr hoy sin esperar a que
 * ese módulo externo se arregle. `HealthModule`/`MetricsModule`/
 * `ThrottlerModule` se dejan fuera porque ningún spec de esta fase los
 * necesita — añadirlos no cambiaría el resultado de ningún test, solo
 * peso de arranque.
 *
 * Si `ProveedoresModule` se arregla, lo correcto es que estos tests pasen
 * a importar `AppModule` real y este fichero deje de hacer falta — de
 * momento el paralelismo con `AppModule` es intencional y hay que
 * mantenerlo a mano: un módulo nuevo de negocio en `AppModule` que las
 * pruebas de integración deban ejercitar hay que añadirlo aquí también.
 */
@Module({
  imports: [
    DbModule,
    AuditModule,
    AuthModule,
    ProjectsModule,
    ContactsModule,
    CertificationsModule, // importa InvoicesModule, que a su vez importa ComplianceModule
    UsersModule,
  ],
})
export class TestAppModule {}
