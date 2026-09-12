import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { DbService } from '../db/db.service';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';
const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
const MAX_TURNS = 8;

export interface CopilotoMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotoResponseDto {
  answer: string;
  /** Herramientas invocadas durante el razonamiento (para transparencia). */
  toolsUsed: string[];
}

/** Herramientas disponibles para el copiloto (subset de las MCP). */
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'resumen_empresa',
    description:
      'KPIs globales de la empresa: obras en curso, contratado, certificado, tesorería, pedidos y facturas.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'listar_obras',
    description: 'Lista todas las obras de la empresa con su estado y datos económicos básicos.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Texto a buscar en nombre o código' },
        status: {
          type: 'string',
          enum: ['oferta', 'adjudicada', 'en_curso', 'pausada', 'finalizada', 'garantia', 'cerrada'],
          description: 'Filtrar por estado',
        },
      },
    },
  },
  {
    name: 'resumen_obra',
    description:
      'Ficha económica completa de una obra: contrato, certificaciones, % ejecutado, retención y desvío por fase.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'UUID de la obra' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'listar_certificaciones',
    description: 'Lista certificaciones de una obra con importe de periodo y retención.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'UUID de la obra (opcional)' },
      },
    },
  },
  {
    name: 'resumen_tesoreria',
    description:
      'Vencimientos de cobro y pago pendientes, con importes vencidos y cashflow próximo.',
    input_schema: {
      type: 'object',
      properties: {
        dias: {
          type: 'number',
          description: 'Horizonte en días (default 90)',
        },
      },
    },
  },
  {
    name: 'listar_pedidos',
    description: 'Lista pedidos de compra con estado, importe y proveedor.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Filtrar por obra (opcional)' },
        status: {
          type: 'string',
          enum: ['emitido', 'servido_parcial', 'servido', 'facturado', 'cerrado', 'anulado'],
        },
      },
    },
  },
  {
    name: 'listar_contactos',
    description: 'Lista proveedores y clientes con su estado de homologación.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['proveedor', 'cliente', 'ambos'] },
        search: { type: 'string' },
      },
    },
  },
];

@Injectable()
export class CopilotoService {
  private readonly logger = new Logger(CopilotoService.name);
  private client: Anthropic | null = null;

  constructor(private readonly dbs: DbService) {}

  get enabled(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return this.client;
  }

  /** Llama a la API interna usando el token JWT del usuario actual. */
  private async callApi(path: string, accessToken: string): Promise<unknown> {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`API ${path} → ${res.status}: ${text}`);
    }
    return res.json();
  }

  private async executeTool(
    name: string,
    input: Record<string, unknown>,
    accessToken: string,
  ): Promise<unknown> {
    switch (name) {
      case 'resumen_empresa':
        return this.callApi('/dashboard/resumen', accessToken);

      case 'listar_obras': {
        const params = new URLSearchParams();
        if (input.search) params.set('search', String(input.search));
        if (input.status) params.set('status', String(input.status));
        const qs = params.toString();
        return this.callApi(`/projects${qs ? `?${qs}` : ''}`, accessToken);
      }

      case 'resumen_obra': {
        const id = String(input.projectId);
        const [obra, certs, desvio] = await Promise.all([
          this.callApi(`/projects/${id}`, accessToken),
          this.callApi(`/certifications?projectId=${id}`, accessToken),
          this.callApi(`/projects/${id}/desvio`, accessToken),
        ]);
        return { obra, certs, desvio };
      }

      case 'listar_certificaciones': {
        const qs = input.projectId ? `?projectId=${input.projectId}` : '';
        return this.callApi(`/certifications${qs}`, accessToken);
      }

      case 'resumen_tesoreria': {
        const dias = Number(input.dias ?? 90);
        const from = new Date().toISOString().slice(0, 10);
        const to = new Date(Date.now() + dias * 86400_000).toISOString().slice(0, 10);
        const [milestones, cashflow] = await Promise.all([
          this.callApi(
            `/treasury/milestones?status=previsto&from=${from}&to=${to}`,
            accessToken,
          ),
          this.callApi(`/treasury/cashflow?groupBy=mes&from=${from}&to=${to}`, accessToken),
        ]);
        return { milestones, cashflow };
      }

      case 'listar_pedidos': {
        const params = new URLSearchParams();
        if (input.projectId) params.set('projectId', String(input.projectId));
        if (input.status) params.set('status', String(input.status));
        const qs = params.toString();
        return this.callApi(`/purchase-orders${qs ? `?${qs}` : ''}`, accessToken);
      }

      case 'listar_contactos': {
        const params = new URLSearchParams();
        if (input.kind) params.set('kind', String(input.kind));
        if (input.search) params.set('search', String(input.search));
        const qs = params.toString();
        return this.callApi(`/contacts${qs ? `?${qs}` : ''}`, accessToken);
      }

      default:
        return { error: `Herramienta desconocida: ${name}` };
    }
  }

  async query(
    question: string,
    history: CopilotoMessage[],
    accessToken: string,
  ): Promise<CopilotoResponseDto> {
    if (!this.enabled) {
      return {
        answer:
          'El copiloto no está disponible: configura `ANTHROPIC_API_KEY` en el fichero `.env` de la API.',
        toolsUsed: [],
      };
    }

    const client = this.getClient();
    const toolsUsed: string[] = [];

    const systemPrompt = `Eres el copiloto inteligente del ERP Dintel, un sistema de gestión para empresas de construcción española.

Tu objetivo es responder preguntas sobre el estado económico y operativo de la empresa usando las herramientas disponibles. Reglas:
- Responde siempre en español, de forma concisa y directa.
- Los importes en euros con separador de miles (ej: 1.250.000 €).
- Los porcentajes con 1 decimal (ej: 73,4 %).
- Las fechas en formato DD/MM/AAAA.
- Si no tienes suficiente información, usa las herramientas para obtenerla antes de responder.
- Cuando consultes una obra específica por nombre, primero usa listar_obras para encontrar su UUID.
- Sé preciso con los números; no redondees a menos que el usuario lo pida.
- Si algo no está disponible en los datos, dilo claramente en lugar de inventar.`;

    const messages: Anthropic.MessageParam[] = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: question },
    ];

    let turn = 0;
    while (turn < MAX_TURNS) {
      turn++;
      const response = await client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      });

      if (response.stop_reason === 'end_turn') {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        return { answer: text, toolsUsed };
      }

      if (response.stop_reason === 'tool_use') {
        // Añadir la respuesta del asistente (con los tool_use blocks)
        messages.push({ role: 'assistant', content: response.content });

        // Ejecutar las herramientas en paralelo
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );

        const toolResults = await Promise.all(
          toolUseBlocks.map(async (block) => {
            if (!toolsUsed.includes(block.name)) toolsUsed.push(block.name);
            this.logger.debug(`Tool: ${block.name}`, block.input);
            try {
              const result = await this.executeTool(
                block.name,
                block.input as Record<string, unknown>,
                accessToken,
              );
              return {
                type: 'tool_result' as const,
                tool_use_id: block.id,
                content: JSON.stringify(result),
              };
            } catch (err) {
              this.logger.warn(`Tool ${block.name} error:`, err);
              return {
                type: 'tool_result' as const,
                tool_use_id: block.id,
                content: JSON.stringify({ error: String(err) }),
                is_error: true,
              };
            }
          }),
        );

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // stop_reason desconocido — devolver lo que tengamos
      break;
    }

    return {
      answer:
        'No he podido completar la consulta tras varios intentos. Prueba con una pregunta más concreta.',
      toolsUsed,
    };
  }
}
