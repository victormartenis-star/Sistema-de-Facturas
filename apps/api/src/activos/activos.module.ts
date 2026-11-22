import { Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { ActivosController } from './activos.controller';
import { ActivosService } from './activos.service';

@Module({
  imports: [ContabilidadModule],
  controllers: [ActivosController],
  providers: [ActivosService],
})
export class ActivosModule {}
