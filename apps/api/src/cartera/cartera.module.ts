import { Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { CarteraController } from './cartera.controller';
import { CarteraService } from './cartera.service';

/** Cartera de clientes y proveedores (subledgers AR/AP). */
@Module({
  imports: [ContabilidadModule],
  controllers: [CarteraController],
  providers: [CarteraService],
})
export class CarteraModule {}
