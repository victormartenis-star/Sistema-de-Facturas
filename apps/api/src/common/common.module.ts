import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TransicionInvalidaFilter } from './transicion-invalida.filter';

/** Piezas transversales: hoy, el filtro de transiciones de estado inválidas. */
@Module({
  providers: [{ provide: APP_FILTER, useClass: TransicionInvalidaFilter }],
})
export class CommonModule {}
