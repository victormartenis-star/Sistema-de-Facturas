import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  new Logger('Bootstrap').log(`API escuchando en http://localhost:${port}`);
}

bootstrap();
