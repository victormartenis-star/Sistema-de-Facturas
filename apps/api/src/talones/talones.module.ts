import { Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { TalonesController } from './talones.controller';
import { TalonesService } from './talones.service';

/** Talonarios y talones / cheques bancarios (tesorería). */
@Module({
  imports: [ContabilidadModule],
  controllers: [TalonesController],
  providers: [TalonesService],
  exports: [TalonesService],
})
export class TalonesModule {}
