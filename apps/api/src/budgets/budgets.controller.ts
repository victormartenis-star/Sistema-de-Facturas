import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  Bc3ImportResultDto,
  BudgetCreateInput,
  BudgetDetailDto,
  BudgetDto,
  BudgetItemCreateInput,
  BudgetItemDto,
  BudgetItemUpdateInput,
  BudgetUpdateInput,
} from '@erp/shared';
import { BudgetsService } from './budgets.service';

@Controller()
export class BudgetsController {
  constructor(private readonly svc: BudgetsService) {}

  // ── Presupuestos por obra ─────────────────────────────────────────────────

  /** GET /projects/:projectId/budgets */
  @Get('projects/:projectId/budgets')
  listByProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<BudgetDto[]> {
    return this.svc.listByProject(projectId);
  }

  /** POST /projects/:projectId/budgets — crear presupuesto manual */
  @Post('projects/:projectId/budgets')
  createForProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: BudgetCreateInput,
  ): Promise<BudgetDto> {
    return this.svc.create(projectId, body);
  }

  /**
   * POST /projects/:projectId/budgets/import/bc3
   * Importa un archivo .bc3 (FIEBDC-3) como nuevo presupuesto.
   * Multipart: campo `file` (el .bc3) + campo `name` (nombre del presupuesto).
   */
  @Post('projects/:projectId/budgets/import/bc3')
  @UseInterceptors(FileInterceptor('file'))
  async importBc3(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name?: string,
  ): Promise<Bc3ImportResultDto> {
    if (!file) {
      throw new Error('Se requiere el archivo .bc3');
    }
    // BC3 suele ser Latin-1; intentamos decodificarlo correctamente
    const content = decodeFileContent(file.buffer);
    const budgetName = name?.trim() || file.originalname.replace(/\.bc3$/i, '');
    return this.svc.importBc3(projectId, budgetName, content);
  }

  // ── Presupuesto individual ────────────────────────────────────────────────

  /** GET /budgets/:id — detalle con todas las partidas */
  @Get('budgets/:id')
  getDetail(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BudgetDetailDto> {
    return this.svc.getDetail(id);
  }

  /** PATCH /budgets/:id — actualizar nombre, estado o notas */
  @Patch('budgets/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BudgetUpdateInput,
  ): Promise<BudgetDto> {
    return this.svc.update(id, body);
  }

  /** DELETE /budgets/:id → 204 */
  @Delete('budgets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.svc.remove(id);
  }

  // ── Partidas ──────────────────────────────────────────────────────────────

  /** POST /budgets/:budgetId/items — añadir partida manualmente */
  @Post('budgets/:budgetId/items')
  createItem(
    @Param('budgetId', ParseUUIDPipe) budgetId: string,
    @Body() body: BudgetItemCreateInput,
  ): Promise<BudgetItemDto> {
    return this.svc.createItem(budgetId, body);
  }

  /** PATCH /budget-items/:id */
  @Patch('budget-items/:id')
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BudgetItemUpdateInput,
  ): Promise<BudgetItemDto> {
    return this.svc.updateItem(id, body);
  }

  /** DELETE /budget-items/:id → 204 */
  @Delete('budget-items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeItem(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.svc.removeItem(id);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Intenta decodificar el buffer como UTF-8; si falla por caracteres inválidos
 * recurre a Latin-1 (ISO-8859-1), que es el encoding habitual de BC3 antiguo.
 */
function decodeFileContent(buffer: Buffer): string {
  const utf8 = buffer.toString('utf-8');
  // Heurística: si contiene el marcador de sustitución Unicode, probablemente era Latin-1
  if (utf8.includes('�')) {
    return buffer.toString('latin1');
  }
  return utf8;
}
