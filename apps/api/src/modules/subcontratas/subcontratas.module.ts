import { Module } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { ProveedoresModule } from '../proveedores/proveedores.module';
import { SubcontratasController } from './subcontratas.controller';
import { SubcontratasService } from './subcontratas.service';

/** Certificaciones de subcontrata y retención de garantía. */
@Module({
  imports: [ProveedoresModule],
  controllers: [SubcontratasController],
  providers: [SubcontratasService, DbService],
})
export class SubcontratasModule {}
