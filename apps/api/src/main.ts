import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { logger } from './common/logging/logger';
import { PinoNestLogger } from './common/logging/pino-nest-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new PinoNestLogger());

  // Cabeceras de seguridad estándar (CSP, X-Content-Type-Options,
  // Strict-Transport-Security, X-Frame-Options…). `crossOriginResourcePolicy`
  // a `cross-origin`: esta API la consume el frontend desde otro origen
  // (puerto 3000 en local, otro dominio en staging), no solo peticiones
  // same-origin. Sin CSP propia todavía: la API sirve JSON, no HTML, así
  // que el CSP por defecto de helmet no bloquea nada real hoy; si el visor
  // de documentos (`GET /documents/:id/file`) empieza a incrustarse en un
  // <iframe> del frontend, revisar `frameguard`/CSP aquí primero.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    exposedHeaders: [
      'X-Request-Id',
      'X-Budget-Warning',
      'X-Content-SHA256',
      'Content-Disposition',
    ],
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  new Logger('Bootstrap').log(`API escuchando en http://localhost:${port}`);
}

bootstrap().catch((err: unknown) => {
  // Con bufferLogs un fallo de arranque podría perderse: se escribe siempre.
  logger.fatal({ err }, 'Fallo de arranque');
  process.exit(1);
});
