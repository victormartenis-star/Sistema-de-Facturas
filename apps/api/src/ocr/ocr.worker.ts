import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Document, documents } from '@erp/db';
import { DbService } from '../db/db.service';
import { ExtractionService } from './extraction.service';

const DEFAULT_INTERVAL_MS = 10_000;

/**
 * Worker del pipeline OCR/IA: cada pocos segundos toma los documentos en
 * estado `subido` y los pasa por el modelo de visión. Es un poller simple
 * (un documento por ciclo) suficiente para el volumen de la Fase 1; cuando
 * haga falta paralelismo o reintentos con backoff se sustituye por
 * Redis/BullMQ (05-stack-tecnologico.md) sin tocar ExtractionService.
 */
@Injectable()
export class OcrWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OcrWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly dbs: DbService,
    private readonly extraction: ExtractionService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.extraction.enabled) {
      this.logger.warn(
        'Pipeline OCR/IA desactivado: falta ANTHROPIC_API_KEY en el .env',
      );
      return;
    }
    const interval = Number(
      process.env.OCR_WORKER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
    );
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
    this.logger.log(
      `Pipeline OCR/IA activo (modelo ${this.extraction.model}, cada ${interval} ms)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Procesa un documento pendiente; ignora los errores (ya quedan en estado `error`). */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const next = await this.claimNext();
      if (next) await this.extraction.extract(next);
    } catch {
      // extract() ya ha registrado el fallo y marcado el documento
    } finally {
      this.running = false;
    }
  }

  private async claimNext(): Promise<Document | undefined> {
    const [row] = await this.dbs.db
      .select()
      .from(documents)
      .where(and(eq(documents.status, 'subido'), isNull(documents.deletedAt)))
      .orderBy(asc(documents.createdAt))
      .limit(1);
    return row;
  }
}
