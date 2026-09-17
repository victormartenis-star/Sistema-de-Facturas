import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  AlertRule,
  Notification,
  alertRules,
  companies,
  notifications,
  users,
} from '@erp/db';
import {
  ALERT_RULE_DEFAULTS,
  ALERT_RULE_TYPES,
  AlertChannel,
  AlertRuleDto,
  AlertRuleType,
  AlertRuleUpdateInput,
  NotificationDto,
  NotificationsRunSummaryDto,
  alertRuleUpdateSchema,
  daysBetween,
  overSobrecosteThreshold,
  todayIso,
  withinAlertWindow,
} from '@erp/shared';
import { runWithRequestContext } from '../common/request-context';
import { AuditService } from '../audit/audit.service';
import { ComplianceService } from '../compliance/compliance.service';
import { CostControlService } from '../cost-control/cost-control.service';
import { DbService } from '../db/db.service';
import { PermisosService } from '../modules/permisos/permisos.service';
import { RealEstateService } from '../modules/real-estate/real-estate.service';
import { ProjectsService } from '../projects/projects.service';
import { EmailService } from './email.service';

interface AlertItem {
  dedupeKey: string;
  title: string;
  body: string;
  link: string | null;
}

function toRuleDto(row: AlertRule): AlertRuleDto {
  return {
    id: row.id,
    type: row.type,
    thresholdDays: row.thresholdDays,
    thresholdPct: row.thresholdPct === null ? null : Number(row.thresholdPct),
    channels: (row.channels as AlertChannel[] | null) ?? ['in_app'],
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toNotificationDto(row: Notification): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Reglas de alerta configurables por empresa + bandeja de notificaciones.
 * `runForCompany`/`runForAllCompanies` reevalúan las 4 fuentes existentes
 * (homologación, permisos, sobrecoste, garantía postventa) — no duplican su
 * cálculo, lo reutilizan vía los propios servicios, ejecutados dentro de un
 * `RequestContext` sintético porque el cron no tiene petición HTTP de la que
 * colgar `companyId`/`role`.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly permisos: PermisosService,
    private readonly compliance: ComplianceService,
    private readonly costControl: CostControlService,
    private readonly projects: ProjectsService,
    private readonly realEstate: RealEstateService,
    private readonly email: EmailService,
  ) {}

  /* ────────────────────── reglas ────────────────────── */

  async listRules(): Promise<AlertRuleDto[]> {
    const companyId = this.dbs.getCompanyId();
    await this.seedDefaults(companyId);
    const rows = await this.dbs.db
      .select()
      .from(alertRules)
      .where(eq(alertRules.companyId, companyId));
    return rows
      .map(toRuleDto)
      .sort(
        (a, b) =>
          ALERT_RULE_TYPES.indexOf(a.type) - ALERT_RULE_TYPES.indexOf(b.type),
      );
  }

  async updateRule(
    type: AlertRuleType,
    input: AlertRuleUpdateInput,
  ): Promise<AlertRuleDto> {
    const companyId = this.dbs.getCompanyId();
    await this.seedDefaults(companyId);
    const data = alertRuleUpdateSchema.parse(input);
    const [row] = await this.dbs.db
      .update(alertRules)
      .set({
        ...(data.thresholdDays !== undefined && {
          thresholdDays: data.thresholdDays,
        }),
        ...(data.thresholdPct !== undefined && {
          thresholdPct:
            data.thresholdPct === null ? null : data.thresholdPct.toFixed(2),
        }),
        ...(data.channels !== undefined && { channels: data.channels }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
        updatedAt: new Date(),
      })
      .where(
        and(eq(alertRules.companyId, companyId), eq(alertRules.type, type)),
      )
      .returning();
    void this.audit.log({
      entityType: 'alert_rule',
      entityId: row.id,
      action: 'update',
      newData: row,
    });
    return toRuleDto(row);
  }

  /** Crea las 4 reglas con sus valores por defecto si a la empresa aún le falta alguna. */
  private async seedDefaults(companyId: string): Promise<void> {
    const existing = await this.dbs.db
      .select({ type: alertRules.type })
      .from(alertRules)
      .where(eq(alertRules.companyId, companyId));
    const have = new Set(existing.map((r) => r.type));
    const missing = ALERT_RULE_TYPES.filter((t) => !have.has(t));
    if (missing.length === 0) return;
    await this.dbs.db.insert(alertRules).values(
      missing.map((type) => ({
        companyId,
        type,
        thresholdDays: ALERT_RULE_DEFAULTS[type].thresholdDays,
        thresholdPct:
          ALERT_RULE_DEFAULTS[type].thresholdPct === null
            ? null
            : ALERT_RULE_DEFAULTS[type].thresholdPct!.toFixed(2),
        channels: ['in_app'],
      })),
    );
  }

  /* ────────────────────── notificaciones ────────────────────── */

  async listNotifications(onlyUnread = false): Promise<NotificationDto[]> {
    const companyId = this.dbs.getCompanyId();
    const filters = [eq(notifications.companyId, companyId)];
    if (onlyUnread) filters.push(isNull(notifications.readAt));
    const rows = await this.dbs.db
      .select()
      .from(notifications)
      .where(and(...filters))
      .orderBy(desc(notifications.createdAt))
      .limit(200);
    return rows.map(toNotificationDto);
  }

  async unreadCount(): Promise<number> {
    const companyId = this.dbs.getCompanyId();
    const rows = await this.dbs.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.companyId, companyId),
          isNull(notifications.readAt),
        ),
      );
    return rows.length;
  }

  async markRead(id: string): Promise<void> {
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.id, id), eq(notifications.companyId, companyId)),
      );
  }

  async markAllRead(): Promise<void> {
    const companyId = this.dbs.getCompanyId();
    await this.dbs.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.companyId, companyId),
          isNull(notifications.readAt),
        ),
      );
  }

  /* ────────────────────── evaluación (cron) ────────────────────── */

  async runForAllCompanies(): Promise<NotificationsRunSummaryDto[]> {
    const companyRows = await this.dbs.db
      .select({ id: companies.id })
      .from(companies);
    const summaries: NotificationsRunSummaryDto[] = [];
    for (const company of companyRows) {
      summaries.push(await this.runForCompany(company.id));
    }
    return summaries;
  }

  /** Evalúa las reglas de una empresa. Pública también para un endpoint manual de administración (probar sin esperar al cron). */
  async runForCompany(companyId: string): Promise<NotificationsRunSummaryDto> {
    return runWithRequestContext(
      { userId: 'system', companyId, role: 'admin' },
      async () => {
        await this.seedDefaults(companyId);
        const rules = await this.dbs.db
          .select()
          .from(alertRules)
          .where(eq(alertRules.companyId, companyId));
        const byType = new Map(rules.map((r) => [r.type, r]));

        const evaluated: AlertRuleType[] = [];
        let created = 0;
        let emailsSent = 0;
        let emailsSkippedNoSmtp = false;
        let adminEmailsCache: string[] | null = null;

        for (const type of ALERT_RULE_TYPES) {
          const rule = byType.get(type);
          if (!rule || !rule.enabled) continue;
          evaluated.push(type);

          let items: AlertItem[];
          try {
            items = await this.evaluateType(type, rule);
          } catch (err) {
            this.logger.warn(
              `Fallo evaluando la regla "${type}" para la empresa ${companyId}: ${(err as Error).message}`,
            );
            continue;
          }

          const channels = (rule.channels as AlertChannel[] | null) ?? [
            'in_app',
          ];
          for (const item of items) {
            const inserted = await this.createIfNotExists(
              companyId,
              type,
              item,
            );
            if (!inserted) continue;
            created++;
            if (!channels.includes('email')) continue;
            if (!this.email.enabled) {
              emailsSkippedNoSmtp = true;
              continue;
            }
            adminEmailsCache ??= await this.adminEmails(companyId);
            const sent = await this.email.send({
              to: adminEmailsCache,
              subject: item.title,
              body: item.body,
            });
            if (sent) emailsSent++;
          }
        }
        return { evaluated, created, emailsSent, emailsSkippedNoSmtp };
      },
    );
  }

  private async createIfNotExists(
    companyId: string,
    type: AlertRuleType,
    item: AlertItem,
  ): Promise<boolean> {
    const [existing] = await this.dbs.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.companyId, companyId),
          eq(notifications.dedupeKey, item.dedupeKey),
        ),
      )
      .limit(1);
    if (existing) return false;
    await this.dbs.db.insert(notifications).values({
      companyId,
      type,
      title: item.title,
      body: item.body,
      link: item.link,
      dedupeKey: item.dedupeKey,
    });
    return true;
  }

  private async adminEmails(companyId: string): Promise<string[]> {
    const rows = await this.dbs.db
      .select({ email: users.email })
      .from(users)
      .where(
        and(
          eq(users.companyId, companyId),
          inArray(users.role, ['admin', 'gerente']),
          eq(users.isActive, true),
        ),
      );
    return rows.map((r) => r.email);
  }

  private async evaluateType(
    type: AlertRuleType,
    rule: AlertRule,
  ): Promise<AlertItem[]> {
    switch (type) {
      case 'compliance_doc':
        return this.evaluateComplianceDocs(
          rule.thresholdDays ??
            ALERT_RULE_DEFAULTS.compliance_doc.thresholdDays!,
        );
      case 'permiso':
        return this.evaluatePermisos(
          rule.thresholdDays ?? ALERT_RULE_DEFAULTS.permiso.thresholdDays!,
        );
      case 'sobrecoste':
        return this.evaluateSobrecoste(
          rule.thresholdPct === null ? 0 : Number(rule.thresholdPct),
        );
      case 'garantia_postventa':
        return this.evaluateGarantiaPostventa(
          rule.thresholdDays ??
            ALERT_RULE_DEFAULTS.garantia_postventa.thresholdDays!,
        );
      default:
        return [];
    }
  }

  private async evaluateComplianceDocs(
    thresholdDays: number,
  ): Promise<AlertItem[]> {
    const alerts = await this.compliance.alertas(thresholdDays);
    const out: AlertItem[] = [];
    for (const contact of alerts) {
      for (const item of contact.alerts) {
        out.push({
          dedupeKey: `compliance_doc:${contact.contactId}:${item.docType}:${item.expiresAt}`,
          title: `${item.docTypeLabel} de ${contact.legalName} ${item.expired ? 'caducado' : 'próximo a caducar'}`,
          body: item.expired
            ? `${item.docTypeLabel} de ${contact.legalName} caducó el ${item.expiresAt}.`
            : `${item.docTypeLabel} de ${contact.legalName} caduca el ${item.expiresAt} (en ${item.daysToExpiry} días).`,
          link: '/cumplimiento',
        });
      }
    }
    return out;
  }

  private async evaluatePermisos(thresholdDays: number): Promise<AlertItem[]> {
    const alerts = await this.permisos.alertas(undefined, thresholdDays);
    return alerts.map((item) => ({
      dedupeKey: `permiso:${item.id}:${item.fechaVencimiento}`,
      title: `Permiso "${item.tipo}" ${item.level === 'vencido' ? 'caducado' : 'próximo a caducar'}`,
      body: `El permiso "${item.tipo}" (${item.organismoPublico}) ${item.level === 'vencido' ? 'caducó' : 'caduca'} el ${item.fechaVencimiento}.`,
      link: '/permisos',
    }));
  }

  private async evaluateSobrecoste(thresholdPct: number): Promise<AlertItem[]> {
    const active = await this.projects.list(undefined, 'en_curso');
    const out: AlertItem[] = [];
    for (const project of active) {
      const detail = await this.costControl.get(project.id);
      for (const partida of detail.sobrecostePorPartida) {
        if (!overSobrecosteThreshold(partida.deviationPct, thresholdPct))
          continue;
        out.push({
          dedupeKey: `sobrecoste:${project.id}:${partida.phaseId}`,
          title: `Sobrecoste en ${project.name} — ${partida.name}`,
          body: `La partida "${partida.name}" de ${project.name} supera el umbral de sobrecoste (desviación del ${partida.deviationPct?.toFixed(1)}%).`,
          link: `/obras/${project.id}/control-costes`,
        });
      }
    }
    return out;
  }

  private async evaluateGarantiaPostventa(
    thresholdDays: number,
  ): Promise<AlertItem[]> {
    const incidents = await this.realEstate.listIncidents();
    const today = todayIso();
    const out: AlertItem[] = [];
    for (const incident of incidents) {
      if (incident.status === 'cerrada' || !incident.warrantyDeadline) continue;
      const days = daysBetween(today, incident.warrantyDeadline);
      if (!withinAlertWindow(days, thresholdDays)) continue;
      out.push({
        dedupeKey: `garantia_postventa:${incident.id}`,
        title: `Garantía de postventa próxima a vencer — ${incident.unitCode}`,
        body: `La incidencia de la unidad ${incident.unitCode} (${incident.category}) tiene garantía hasta ${incident.warrantyDeadline} y sigue sin cerrar.`,
        link: '/promocion',
      });
    }
    return out;
  }
}
