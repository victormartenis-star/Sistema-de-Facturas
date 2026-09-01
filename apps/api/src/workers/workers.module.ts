import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';

@Module({
  // Reutiliza el criterio de bloqueo de empresa del módulo de homologación
  imports: [ComplianceModule],
  controllers: [WorkersController],
  providers: [WorkersService],
  exports: [WorkersService],
})
export class WorkersModule {}
