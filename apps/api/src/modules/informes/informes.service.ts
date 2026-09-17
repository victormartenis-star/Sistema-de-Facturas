import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { companies } from '@erp/db';
import { InformeMensualDto } from '@erp/shared';
import { DbService } from '../../db/db.service';
import { DashboardService } from '../../dashboard/dashboard.service';
import { CostControlService } from '../../cost-control/cost-control.service';

const DEFAULT_MODEL =
  process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `Eres el redactor de informes mensuales de gerencia de una empresa de construcción española.

Recibes los KPIs ya calculados de la empresa (o de una obra concreta) como JSON y escribes una narrativa breve en español, en formato Markdown, para que la dirección la lea en dos minutos. Reglas:
- No repitas los números tal cual: interprétalos (¿va bien, va mal, hay que vigilar algo?).
- Estructura: un titular de una frase, 2-4 párrafos cortos o una lista, y un cierre con lo que requiere atención (si lo hay).
- Los importes en euros con separador de miles (ej: 1.250.000 €); porcentajes con 1 decimal.
- No inventes datos que no estén en el JSON. Si un dato relevante falta, dilo en vez de estimarlo.
- No incluyas el JSON de entrada en la respuesta, solo el informe redactado.`;

@Injectable()
export class InformesService {
  private client: Anthropic | null = null;

  constructor(
    private readonly dbs: DbService,
    private readonly dashboard: DashboardService,
    private readonly costControl: CostControlService,
  ) {}

  get enabled(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async generarMensual(
    mes: string,
    projectId?: string,
  ): Promise<InformeMensualDto> {
    if (!this.enabled) {
      throw new BadRequestException(
        'El informe mensual no está disponible: configura `ANTHROPIC_API_KEY` en el .env de la API.',
      );
    }

    const companyId = this.dbs.getCompanyId();
    const [company] = await this.dbs.db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    const resumen = await this.dashboard.resumen();
    const obras = await this.dashboard.obrasKpi();

    let obraNombre: string | null = null;
    let costControl = null;
    if (projectId) {
      const obraRow = obras.find((o) => o.projectId === projectId);
      if (!obraRow) throw new NotFoundException('Obra no encontrada');
      obraNombre = obraRow.name;
      costControl = await this.costControl.get(projectId);
    }

    const markdown = await this.redactar({
      empresa: company?.name ?? 'la empresa',
      mes,
      alcance: obraNombre ? `obra: ${obraNombre}` : 'toda la empresa',
      resumenGlobal: resumen,
      obras: projectId ? undefined : obras,
      costControlObra: costControl ?? undefined,
    });

    return {
      markdown,
      mes,
      projectId: projectId ?? null,
      generatedAt: new Date().toISOString(),
    };
  }

  private async redactar(datos: Record<string, unknown>): Promise<string> {
    const response = await this.anthropic().messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Redacta el informe mensual con estos datos:\n\n${JSON.stringify(datos, null, 2)}`,
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!text.trim()) {
      throw new BadRequestException(
        `El modelo no devolvió resultado (stop_reason: ${response.stop_reason})`,
      );
    }
    return text;
  }

  private anthropic(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return this.client;
  }
}
