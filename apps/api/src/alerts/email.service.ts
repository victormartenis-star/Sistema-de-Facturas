import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';

export interface EmailMessage {
  to: string[];
  subject: string;
  body: string;
}

/**
 * Envío de email opt-in, igual que `ExtractionService.enabled` con
 * `ANTHROPIC_API_KEY`: si no hay SMTP configurado no falla, simplemente no
 * envía (`AlertsService` sigue creando la notificación in-app igualmente).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  get enabled(): boolean {
    return Boolean(
      process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
    );
  }

  private client(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }
    return this.transporter;
  }

  /** No lanza si falla el envío: un email no entregado no debe tumbar el cron de alertas. */
  async send(message: EmailMessage): Promise<boolean> {
    if (!this.enabled || message.to.length === 0) return false;
    try {
      await this.client().sendMail({
        from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
        to: message.to.join(', '),
        subject: message.subject,
        text: message.body,
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `No se pudo enviar el email "${message.subject}": ${(err as Error).message}`,
      );
      return false;
    }
  }
}
