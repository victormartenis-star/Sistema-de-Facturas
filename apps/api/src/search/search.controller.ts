import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  /** Buscador global (documentos + facturas), tolerante a errores tipográficos vía trigramas. */
  @Get()
  search(@Query('q') q?: string) {
    return this.service.search(q ?? '');
  }
}
