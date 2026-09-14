'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/components/toast';
import { IconAlertTriangle, IconCheck, IconInfo } from '@/components/icons';
import { DocumentoPRL } from '@/types/erp-finance';
import { formatDate } from '@/lib/api';

/**
 * Componente Panel de Documentación PRL
 *
 * Muestra el estado de la documentación de Prevención de Riesgos Laborales
 * para un proveedor/subcontrata concreto. Incluye badges de estado:
 * - Vigente: Todos los documentos obligatorios están al día
 * - Proximo Vencimiento: Algún documento vence en los próximos 30 días
 * - Vencido: Algun documento ya venció
 * - No Aplica: El proveedor no está sujeto a control PRL
 */

interface DocumentosPRLListProps {
  proveedorId: string;
  tipo: 'proveedor' | 'subcontrata';
  /** Datos opcionales del proveedor para mostrar nombre */
  proveedorNombre?: string;
  /** Callback opcional al seleccionar un documento */
  onVerDocumento?: (doc: DocumentoPRL) => void;
}

/**
 * Estados posibles de la documentación PRL
 */
enum EstadoPRL {
  VIGENTE = 'vigente',
  PROXIMO_VENCIMIENTO = 'proximo_vencimiento',
  VENCIDO = 'vencido',
  NO_APLICA = 'no_aplica',
}

/**
 * Componente DocumentosPRLList
 *
 * Muestra un resumen visual de la documentación PRL con badges de estado
 * y detalles de cada documento tipo.
 *
 * Ejemplo de uso:
 * <DocumentosPRLList
 *   proveedorId="uuid-123"
 *   tipo="subcontrata"
 *   proveedorNombre="Constructora S.A."
 * />
 */

function DocumentosPRLList({
  proveedorId,
  tipo,
  proveedorNombre,
  onVerDocumento,
}: DocumentosPRLListProps) {
  const [estado, setEstado] = useState<EstadoPRL>(EstadoPRL.VIGENTE);
  const [documentos, setDocumentos] = useState<DocumentoPRL[]>([]);
  const [cargando, setCargando] = useState(true);
  const toast = useToast();

  // Cargar documentación PRL desde la API
  useEffect(() => {
    const cargarDocumentos = async () => {
      setCargando(true);
      try {
        // En producción: llamar a la API /proveedores/:id/documentos-prl
        // Por ahora simulamos con datos estáticos
        const documentosSimulados: DocumentoPRL[] = [
          {
            id: 'doc-1',
            docType: 'plan_seguridad',
            numeroExpediente: 'PS-2024-001',
            fechaEmision: '2024-03-15',
            fechaVencimiento: '2025-03-15',
            status: 'vigente',
            storageKey: 'prl-proveedor-1-plan-seguridad.pdf',
            fileName: 'plan-seguridad.pdf',
            notes: 'Plan de seguridad y salud vigente',
          },
          {
            id: 'doc-2',
            docType: 'seguro_rc',
            numeroExpediente: 'RC-2024-045',
            fechaEmision: '2024-01-20',
            fechaVencimiento: '2025-01-20',
            status: 'vigente',
            storageKey: 'prl-proveedor-1-seguro-rc.pdf',
            fileName: 'seguro-rc.pdf',
            notes: 'Seguro de responsabilidad civil vigente',
          },
          {
            id: 'doc-3',
            docType: 'certificado_ss',
            numeroExpediente: 'SS-2024-112',
            fechaEmision: '2024-06-01',
            fechaVencimiento: '2025-06-01',
            status: 'proximo_vencimiento',
            storageKey: 'prl-proveedor-1-cert-ss.pdf',
            fileName: 'certificado-ss.pdf',
            notes: 'Certificado de condiciones de seguridad - vence en 45 días',
          },
        ];

        setDocumentos(documentosSimulados);

        // Determinar estado general basado en los documentos recién cargados
        const tieneVencido = documentosSimulados.some(
          (d) => d.status === 'vencido',
        );
        const proximoVencimiento =
          documentosSimulados.some((d) => d.status === 'proximo_vencimiento') &&
          !tieneVencido;

        if (tieneVencido) {
          setEstado(EstadoPRL.VENCIDO);
        } else if (proximoVencimiento) {
          setEstado(EstadoPRL.PROXIMO_VENCIMIENTO);
        } else {
          setEstado(EstadoPRL.VIGENTE);
        }
      } catch (error) {
        toast('Error al cargar documentación PRL', 'error');
        console.error(error);
      } finally {
        setCargando(false);
      }
    };

    cargarDocumentos();
  }, [proveedorId, toast]);

  // Determinar clase CSS y descripción según el estado
  const getEstadoInfo = () => {
    switch (estado) {
      case EstadoPRL.VIGENTE:
        return {
          clase:
            'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-600 bg-green-100 rounded',
          icono: <IconCheck size={12} className="text-green-500" />,
          texto: 'Documentación Vigente',
          descripcion:
            'Todos los documentos PRL obligatorios están al día y son válidos.',
        };
      case EstadoPRL.PROXIMO_VENCIMIENTO:
        return {
          clase:
            'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-600 bg-amber-100 rounded',
          icono: <IconInfo size={12} className="text-amber-500" />,
          texto: 'Proximo a Vencimiento',
          descripcion:
            'Algunos documentos vencen en los próximos 30 días. Se recomienda renovarlos.',
        };
      case EstadoPRL.VENCIDO:
        return {
          clase:
            'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 bg-red-100 rounded',
          icono: <IconAlertTriangle size={12} className="text-red-500" />,
          texto: 'Documentación Vencida',
          descripcion:
            'Uno o más documentos PRL han vencido. Se requiere renovación inmediata antes de autorizar pagos.',
        };
      case EstadoPRL.NO_APLICA:
        return {
          clase:
            'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 bg-gray-100 rounded',
          icono: null,
          texto: 'No Aplica PRL',
          descripcion:
            'Este proveedor/subcontrata no está sujeto a control documental PRL.',
        };
    }
  };

  const { clase, icono, texto, descripcion } = getEstadoInfo();

  return (
    <div className="p-5 bg-white rounded-lg border border-gray-200">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        {/* Badge de estado */}
        <div className={clase}>
          {icono}
          <span>{texto}</span>
        </div>

        {/* Información del proveedor */}
        <div className="w-full sm:w-auto text-sm text-gray-600">
          <span className="font-medium">
            {proveedorNombre || `Proveedor #${proveedorId.substring(0, 8)}...`}
          </span>{' '}
          <span>{tipo === 'subcontrata' ? 'Subcontrata' : 'Proveedor'}</span>
        </div>
      </div>

      {/* Descripción del estado */}
      <p className="mt-2 text-sm text-gray-400 line-clamp-2">{descripcion}</p>

      {/* Lista de documentos */}
      {cargando ? (
        <p className="mt-3 text-xs text-gray-400">Cargando documentos…</p>
      ) : documentos.length > 0 ? (
        <div className="mt-4 space-y-2">
          {documentos.map((doc) => {
            const tipoLabel: Record<string, string> = {
              plan_seguridad: 'Plan de Seguridad',
              seguro_rc: 'Seguro RC',
              certificado_ss: 'Cert. SS',
              itinerario_formativo: 'Itinerario Formativo',
              epi: 'EPI',
              otro: 'Otro',
            };

            const estadoDoc: Record<string, string> = {
              vigente: 'Vigente',
              proximo_vencimiento: 'Próximo a vencer',
              vencido: 'Vencido',
              rechazado: 'Rechazado',
            };

            const esBloqueante = [
              'plan_seguridad',
              'seguro_rc',
              'certificado_ss',
              'itinerario_formativo',
              'epi',
            ].includes(doc.docType);

            return (
              <div
                key={doc.id}
                className="flex items-center gap-3 p-2 rounded bg-gray-50"
              >
                <span className="text-xs font-medium text-gray-500">
                  {tipoLabel[doc.docType] || doc.docType}
                </span>
                <span className="text-xs font-medium text-gray-500">
                  {estadoDoc[doc.status] || doc.status}
                </span>
                <span className="text-xs text-gray-400">
                  Vence: {formatDate(doc.fechaVencimiento)}
                </span>
                {esBloqueante && (
                  <span className="text-[10px] uppercase tracking-wide text-red-400">
                    Bloqueante
                  </span>
                )}
                <button
                  onClick={() => onVerDocumento?.(doc)}
                  className="text-xs text-amber-500 hover:underline underline-offset-2"
                  title="Ver detalles"
                >
                  Ver
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-xs text-gray-400">
          No hay documentos registrados para este proveedor
        </p>
      )}
    </div>
  );
}

export { DocumentosPRLList, type DocumentosPRLListProps };
