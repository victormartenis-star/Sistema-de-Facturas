import { Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { GrcModule } from '../grc/grc.module';
import { BancaController } from './banca.controller';
import { LiquidezService } from './liquidez.service';
import { RemesasService } from './remesas.service';

/** Bank Accounting: remesas SEPA XML y previsión de liquidez (fase 5). */
@Module({
  imports: [ContabilidadModule, GrcModule],
  controllers: [BancaController],
  providers: [RemesasService, LiquidezService],
})
export class BancaModule {}
