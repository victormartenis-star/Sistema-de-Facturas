import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  CostForecastInput,
  MonthlyPlanSaveInput,
  costForecastSchema,
  monthlyPlanSaveSchema,
} from '@erp/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ForecastService } from './forecast.service';

@Controller('forecast')
export class ForecastController {
  constructor(private readonly service: ForecastService) {}

  /** La fotografía económica completa de la obra. */
  @Get(':projectId/economia')
  economics(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.service.economics(projectId);
  }

  @Get(':projectId/plan')
  getPlan(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.service.getPlan(projectId);
  }

  @Put(':projectId/plan')
  savePlan(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(monthlyPlanSaveSchema))
    body: MonthlyPlanSaveInput,
  ) {
    return this.service.savePlan(projectId, body);
  }

  @Get(':projectId/previsiones')
  listForecasts(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.service.listForecasts(projectId);
  }

  /** Declaración mensual del coste pendiente de contratar y ejecutar. */
  @Post(':projectId/previsiones')
  saveForecast(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(costForecastSchema)) body: CostForecastInput,
  ) {
    return this.service.saveForecast(projectId, body);
  }
}
