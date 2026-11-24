'use client';

/**
 * Certificaciones de subcontrata y retención de garantía.
 *
 * Lado de COSTE de la producción: el jefe de obra mide a origen lo ejecutado
 * por cada subcontratista contra su contrato; administración aprueba, paga y
 * devuelve la garantía. Toda la aritmética la hace la API (y el mismo
 * `computeCertSubcontrata` de `@erp/shared` para la vista previa del modal).
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CERT_SUBCONTRATA_STATUS_LABELS,
  computeCertSubcontrata,
  type CertSubcontrataDto,
  type ContratoSubcontrataResumenDto,
} from '@erp/shared';
import { formatDate, formatEur, subcontratasApi } from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { useAuth } from '@/lib/auth';
import { textoDeError } from '@/lib/errores';
import { usePermisos } from '@/lib/permisos';
import {
  accionesCert,
  anchoEjecucion,
  puedeGestionarDinero,
  puedeMedir,
  TONO_ESTADO_CERT,
} from '@/lib/subcontratas';
import { AprobacionDocumento } from '@/components/aprobacion-documento';
import { IconPlus, IconWrench } from '@/components/icons';
import { useAvisarError, useToast } from '@/components/toast';
import {
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  TableSkeleton,
  btnGhostCls,
  btnPrimaryCls,
  fieldCls,
  labelCls,
} from '@/components/ui';

const hoy = () => new Date().toISOString().slice(0, 10);

function Estado({ status }: { status: CertSubcontrataDto['status'] }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONO_ESTADO_CERT[status]}`}
    >
      {CERT_SUBCONTRATA_STATUS_LABELS[status]}
    </span>
  );
}

function BarraEjecucion({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-blue-600"
          style={{ width: `${anchoEjecucion(pct)}%` }}
        />
      </div>
      <span className="text-xs text-gray-600 tabular-nums">
        {pct.toLocaleString('es-ES')} %
      </span>
    </div>
  );
}

/* ───────────────────────── modales ───────────────────────── */

function ModalNuevaCert({
  contrato,
  anterior,
  onClose,
}: {
  contrato: ContratoSubcontrataResumenDto;
  anterior: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [clave] = useState(nuevoUuid);
  const [form, setForm] = useState({
    fecha: hoy(),
    periodoDesde: hoy().slice(0, 8) + '01',
    periodoHasta: hoy(),
    importeOrigen: '',
    notas: '',
  });
  const importe = Number(form.importeOrigen.replace(',', '.'));
  const previa = useMemo(() => {
    if (!form.importeOrigen || !Number.isFinite(importe)) return null;
    try {
      return {
        ok: computeCertSubcontrata(
          contrato.importeTotal,
          importe,
          anterior,
          contrato.retencionGarantiaPct,
        ),
      };
    } catch (e) {
      return { error: textoDeError(e) };
    }
  }, [form.importeOrigen, importe, anterior, contrato]);

  const crear = useMutation({
    mutationFn: () =>
      subcontratasApi.crear(
        contrato.id,
        {
          fecha: form.fecha,
          periodoDesde: form.periodoDesde,
          periodoHasta: form.periodoHasta,
          importeOrigen: importe,
          notas: form.notas || null,
        },
        clave,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['subcontratas'] });
      toast('Certificación creada en borrador');
      onClose();
    },
    onError: (e) => toast(textoDeError(e), 'error'),
  });

  const campo = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [k]: e.target.value }),
  });

  return (
    <Modal open title="Nueva certificación de subcontrata" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          crear.mutate();
        }}
      >
        <p className="text-xs text-gray-500">
          {contrato.proveedorNombre} · contrato {contrato.numeroContrato} ·{' '}
          {formatEur(contrato.importeTotal)} · ya certificado{' '}
          {formatEur(anterior)}
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Fecha</label>
            <input
              type="date"
              required
              className={fieldCls}
              {...campo('fecha')}
            />
          </div>
          <div>
            <label className={labelCls}>Periodo desde</label>
            <input
              type="date"
              required
              className={fieldCls}
              {...campo('periodoDesde')}
            />
          </div>
          <div>
            <label className={labelCls}>Periodo hasta</label>
            <input
              type="date"
              required
              className={fieldCls}
              {...campo('periodoHasta')}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Producción acumulada a origen (€)</label>
          <input
            inputMode="decimal"
            required
            className={fieldCls}
            placeholder="Total ejecutado desde el inicio del contrato"
            {...campo('importeOrigen')}
          />
        </div>
        {previa?.ok && (
          <dl className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3 text-xs">
            <div>
              <dt className="text-gray-500">Periodo</dt>
              <dd className="font-semibold tabular-nums">
                {formatEur(previa.ok.importePeriodo)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">
                Retención ({contrato.retencionGarantiaPct} %)
              </dt>
              <dd className="font-semibold tabular-nums">
                {formatEur(previa.ok.retencionImporte)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Líquido a pagar</dt>
              <dd className="font-semibold tabular-nums">
                {formatEur(previa.ok.importeLiquido)}
              </dd>
            </div>
          </dl>
        )}
        {previa?.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {previa.error}
          </p>
        )}
        <div>
          <label className={labelCls}>Notas</label>
          <input className={fieldCls} {...campo('notas')} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnGhostCls} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={crear.isPending || !previa?.ok}
          >
            Crear borrador
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Modal de un solo campo (fecha de pago, motivo de anulación, devolución). */
function ModalCampo({
  titulo,
  etiqueta,
  tipo,
  inicial,
  extra,
  confirmar,
  onConfirmar,
  onClose,
  pendiente,
}: {
  titulo: string;
  etiqueta: string;
  tipo: 'date' | 'text';
  inicial: string;
  extra?: React.ReactNode;
  confirmar: string;
  onConfirmar: (valor: string) => void;
  onClose: () => void;
  pendiente: boolean;
}) {
  const [valor, setValor] = useState(inicial);
  return (
    <Modal open title={titulo} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirmar(valor);
        }}
      >
        <div>
          <label className={labelCls}>{etiqueta}</label>
          <input
            type={tipo}
            required
            minLength={tipo === 'text' ? 3 : undefined}
            className={fieldCls}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </div>
        {extra}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnGhostCls} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className={btnPrimaryCls} disabled={pendiente}>
            {confirmar}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Registra la factura que envió el subcontratista por una certificación
 * aprobada: la API la crea y la aprueba con la base y la retención de la
 * certificación. Un 409 (versión, duplicado, PRL…) llega como problema
 * RFC 7807 y se muestra con su detalle; el de versión ofrece recargar.
 */
function ModalFacturaCompra({
  cert,
  onClose,
  onHecho,
}: {
  cert: CertSubcontrataDto;
  onClose: () => void;
  onHecho: () => void;
}) {
  const toast = useToast();
  const avisarError = useAvisarError();
  const [clave] = useState(nuevoUuid);
  const [form, setForm] = useState({
    invoiceNumber: '',
    issueDate: hoy(),
    isp: true,
    vatPct: '21',
  });
  const iva = form.isp ? 0 : Number(form.vatPct) || 0;
  const total = cert.importePeriodo * (1 + iva / 100);

  const facturar = useMutation({
    mutationFn: () =>
      subcontratasApi.facturarCompra(
        cert.id,
        {
          invoiceNumber: form.invoiceNumber,
          issueDate: form.issueDate,
          isp: form.isp,
          vatPct: Number(form.vatPct) || 0,
        },
        cert.version,
        clave,
      ),
    onSuccess: (r) => {
      toast(
        `Factura de compra ${r.facturaCompra?.invoiceNumber ?? ''} registrada y aprobada`,
      );
      onHecho();
    },
    onError: (e) => avisarError(e, onHecho),
  });

  return (
    <Modal
      open
      title={`Factura de compra — certificación nº ${cert.numero}`}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          facturar.mutate();
        }}
      >
        <dl className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3 text-xs">
          <div>
            <dt className="text-gray-500">Base (periodo)</dt>
            <dd className="font-semibold tabular-nums">
              {formatEur(cert.importePeriodo)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Retención ({cert.retencionPct} %)</dt>
            <dd className="font-semibold tabular-nums">
              {formatEur(cert.retencionImporte)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Total factura (est.)</dt>
            <dd className="font-semibold tabular-nums">{formatEur(total)}</dd>
          </div>
        </dl>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Nº de factura del subcontratista</label>
            <input
              required
              maxLength={60}
              className={fieldCls}
              value={form.invoiceNumber}
              onChange={(e) =>
                setForm({ ...form, invoiceNumber: e.target.value })
              }
            />
          </div>
          <div>
            <label className={labelCls}>Fecha de la factura</label>
            <input
              type="date"
              required
              className={fieldCls}
              value={form.issueDate}
              onChange={(e) => setForm({ ...form, issueDate: e.target.value })}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.isp}
            onChange={(e) => setForm({ ...form, isp: e.target.checked })}
          />
          Inversión del sujeto pasivo (subcontratación de obra)
        </label>
        {!form.isp && (
          <div>
            <label className={labelCls}>Tipo de IVA (%)</label>
            <input
              inputMode="decimal"
              className={fieldCls}
              value={form.vatPct}
              onChange={(e) => setForm({ ...form, vatPct: e.target.value })}
            />
          </div>
        )}
        <p className="text-xs text-gray-500">
          La factura se imputa a la obra del contrato y queda aprobada, con sus
          vencimientos de pago (ordinario y retención). La certificación hace de
          documento de conformidad en lugar de los albaranes.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnGhostCls} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={facturar.isPending || !form.invoiceNumber.trim()}
          >
            Generar y aprobar
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ───────────────────────── detalle ───────────────────────── */

type Dialogo =
  | { tipo: 'nueva' }
  | { tipo: 'pagar'; cert: CertSubcontrataDto }
  | { tipo: 'anular'; cert: CertSubcontrataDto }
  | { tipo: 'facturar'; cert: CertSubcontrataDto }
  | { tipo: 'devolver' }
  | null;

function DetalleContrato({
  contrato,
}: {
  contrato: ContratoSubcontrataResumenDto;
}) {
  const { user } = useAuth();
  const rol = user?.role;
  // Puerta común de la UI (lector y portal fuera) + regla de roles del módulo.
  const { can } = usePermisos();
  const qc = useQueryClient();
  const toast = useToast();
  const avisarError = useAvisarError();
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [importeDevolucion, setImporteDevolucion] = useState('');

  const certs = useQuery({
    queryKey: ['subcontratas', 'certificaciones', contrato.id],
    queryFn: () => subcontratasApi.certificaciones(contrato.id),
  });
  const garantia = useQuery({
    queryKey: ['subcontratas', 'retenciones', contrato.id],
    queryFn: () => subcontratasApi.retenciones(contrato.id),
  });

  const recargar = () =>
    void qc.invalidateQueries({ queryKey: ['subcontratas'] });
  const accion = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: () => {
      recargar();
      setDialogo(null);
      toast('Hecho');
    },
    onError: (e) => avisarError(e, recargar),
  });

  const lista = certs.data ?? [];
  const anterior = lista
    .filter((c) => c.status === 'aprobada' || c.status === 'pagada')
    .reduce((m, c) => Math.max(m, c.importeOrigen), 0);

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {contrato.proveedorNombre} · {contrato.numeroContrato}
          </h2>
          <p className="text-xs text-gray-500">
            {contrato.proyectoCodigo} — {contrato.proyectoNombre} · contrato{' '}
            {formatEur(contrato.importeTotal)} · garantía{' '}
            {contrato.retencionGarantiaPct} %
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {can('crear') &&
            puedeMedir(rol) &&
            contrato.status === 'activo' &&
            !contrato.hayBorrador && (
              <button
                className={btnPrimaryCls}
                onClick={() => setDialogo({ tipo: 'nueva' })}
              >
                <IconPlus size={16} /> Nueva certificación
              </button>
            )}
        </div>
      </div>

      {certs.isLoading ? (
        <TableSkeleton rows={3} />
      ) : certs.isError ? (
        <ErrorBanner message={textoDeError(certs.error)} />
      ) : lista.length === 0 ? (
        <p className="text-sm text-gray-500">
          Este contrato aún no tiene certificaciones.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="py-2 pr-3">Nº</th>
                <th className="py-2 pr-3">Periodo</th>
                <th className="py-2 pr-3 text-right">A origen</th>
                <th className="py-2 pr-3 text-right">Periodo</th>
                <th className="py-2 pr-3 text-right">Retención</th>
                <th className="py-2 pr-3 text-right">Líquido</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => {
                const acciones = can('cambiarEstado')
                  ? accionesCert(c, lista, rol)
                  : [];
                return (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 tabular-nums">{c.numero}</td>
                    <td className="py-2 pr-3 text-xs text-gray-600">
                      {formatDate(c.periodoDesde)} –{' '}
                      {formatDate(c.periodoHasta)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatEur(c.importeOrigen)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatEur(c.importePeriodo)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatEur(c.retencionImporte)}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium tabular-nums">
                      {formatEur(c.importeLiquido)}
                    </td>
                    <td className="py-2 pr-3">
                      <Estado status={c.status} />
                      {c.fechaPago && (
                        <span className="ml-1 text-[11px] text-gray-500">
                          {formatDate(c.fechaPago)}
                        </span>
                      )}
                      {c.facturaCompra && (
                        <span
                          className="mt-0.5 block text-[11px] text-gray-600"
                          title={`Base ${formatEur(c.facturaCompra.baseAmount)} · retención ${formatEur(c.facturaCompra.retentionAmount)}`}
                        >
                          Factura {c.facturaCompra.invoiceNumber} ·{' '}
                          {c.facturaCompra.status} ·{' '}
                          {formatEur(c.facturaCompra.totalAmount)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {acciones.includes('facturar') && (
                        <button
                          className={btnGhostCls}
                          onClick={() =>
                            setDialogo({ tipo: 'facturar', cert: c })
                          }
                        >
                          Generar factura de compra
                        </button>
                      )}
                      {acciones.includes('aprobar') && (
                        <AprobacionDocumento
                          operacion="certificacion_subcontrata"
                          entidadId={c.id}
                        />
                      )}
                      {acciones.includes('aprobar') && (
                        <button
                          className={btnGhostCls}
                          onClick={() =>
                            accion.mutate(() =>
                              subcontratasApi.aprobar(c.id, c.version),
                            )
                          }
                        >
                          Aprobar
                        </button>
                      )}
                      {acciones.includes('pagar') && (
                        <button
                          className={btnGhostCls}
                          onClick={() => setDialogo({ tipo: 'pagar', cert: c })}
                        >
                          Pagar
                        </button>
                      )}
                      {acciones.includes('anular') && (
                        <button
                          className={btnGhostCls}
                          onClick={() =>
                            setDialogo({ tipo: 'anular', cert: c })
                          }
                        >
                          Anular
                        </button>
                      )}
                      {acciones.includes('eliminar') && (
                        <button
                          className={`${btnGhostCls} text-red-600`}
                          onClick={() =>
                            accion.mutate(() =>
                              subcontratasApi.eliminar(c.id, c.version),
                            )
                          }
                        >
                          Eliminar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 rounded-xl bg-gray-50 p-4">
        <div className="flex flex-wrap items-center gap-6">
          <p className="text-xs font-semibold text-gray-600 uppercase">
            Retención de garantía
          </p>
          {garantia.data && (
            <dl className="flex gap-6 text-sm">
              <div>
                <dt className="text-xs text-gray-500">Retenido</dt>
                <dd className="tabular-nums">
                  {formatEur(garantia.data.retenido)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Devuelto</dt>
                <dd className="tabular-nums">
                  {formatEur(garantia.data.devuelto)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Pendiente</dt>
                <dd className="font-semibold tabular-nums">
                  {formatEur(garantia.data.pendiente)}
                </dd>
              </div>
            </dl>
          )}
          {can('cambiarEstado') &&
            puedeGestionarDinero(rol) &&
            contrato.status === 'completado' &&
            (garantia.data?.pendiente ?? 0) > 0 && (
              <button
                className={`${btnGhostCls} ml-auto`}
                onClick={() => {
                  setImporteDevolucion(String(garantia.data?.pendiente ?? ''));
                  setDialogo({ tipo: 'devolver' });
                }}
              >
                Devolver garantía
              </button>
            )}
        </div>
        {contrato.status !== 'completado' && (
          <p className="mt-2 text-xs text-gray-500">
            La garantía se devuelve cuando el contrato está completado.
          </p>
        )}
        {(garantia.data?.devoluciones.length ?? 0) > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-gray-600">
            {garantia.data!.devoluciones.map((d) => (
              <li key={d.id}>
                {formatDate(d.fecha)} · {formatEur(d.importe)} · {d.motivo}
              </li>
            ))}
          </ul>
        )}
      </div>

      {dialogo?.tipo === 'nueva' && (
        <ModalNuevaCert
          contrato={contrato}
          anterior={anterior}
          onClose={() => setDialogo(null)}
        />
      )}
      {dialogo?.tipo === 'pagar' && (
        <ModalCampo
          titulo={`Pagar certificación nº ${dialogo.cert.numero}`}
          etiqueta="Fecha de pago"
          tipo="date"
          inicial={hoy()}
          extra={
            <p className="text-xs text-gray-500">
              Líquido: {formatEur(dialogo.cert.importeLiquido)}. Se comprueba de
              nuevo la documentación PRL de la subcontrata.
            </p>
          }
          confirmar="Registrar pago"
          pendiente={accion.isPending}
          onClose={() => setDialogo(null)}
          onConfirmar={(fecha) =>
            accion.mutate(() =>
              subcontratasApi.pagar(
                dialogo.cert.id,
                fecha,
                dialogo.cert.version,
              ),
            )
          }
        />
      )}
      {dialogo?.tipo === 'facturar' && (
        <ModalFacturaCompra
          cert={dialogo.cert}
          onClose={() => setDialogo(null)}
          onHecho={() => {
            recargar();
            setDialogo(null);
          }}
        />
      )}
      {dialogo?.tipo === 'anular' && (
        <ModalCampo
          titulo={`Anular certificación nº ${dialogo.cert.numero}`}
          etiqueta="Motivo"
          tipo="text"
          inicial=""
          confirmar="Anular"
          pendiente={accion.isPending}
          onClose={() => setDialogo(null)}
          onConfirmar={(motivo) =>
            accion.mutate(() =>
              subcontratasApi.anular(
                dialogo.cert.id,
                motivo,
                dialogo.cert.version,
              ),
            )
          }
        />
      )}
      {dialogo?.tipo === 'devolver' && (
        <ModalCampo
          titulo="Devolver garantía"
          etiqueta="Motivo"
          tipo="text"
          inicial="Fin del plazo de garantía"
          extra={
            <div>
              <label className={labelCls}>Importe (€)</label>
              <input
                inputMode="decimal"
                required
                className={fieldCls}
                value={importeDevolucion}
                onChange={(e) => setImporteDevolucion(e.target.value)}
              />
            </div>
          }
          confirmar="Registrar devolución"
          pendiente={accion.isPending}
          onClose={() => setDialogo(null)}
          onConfirmar={(motivo) =>
            accion.mutate(() =>
              subcontratasApi.devolverGarantia(contrato.id, {
                fecha: hoy(),
                importe: Number(importeDevolucion.replace(',', '.')),
                motivo,
              }),
            )
          }
        />
      )}
    </section>
  );
}

/* ───────────────────────── página ───────────────────────── */

export default function SubcontratasPage() {
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const contratos = useQuery({
    queryKey: ['subcontratas', 'contratos'],
    queryFn: () => subcontratasApi.contratos(),
  });
  const lista = contratos.data ?? [];
  const elegido = lista.find((c) => c.id === seleccion) ?? null;

  return (
    <div>
      <PageHeader
        title="Certificaciones de subcontrata"
        subtitle="Producción a origen, retención de garantía y pagos a subcontratistas"
        count={contratos.data?.length}
      />
      {contratos.isLoading ? (
        <TableSkeleton />
      ) : contratos.isError ? (
        <ErrorBanner message={textoDeError(contratos.error)} />
      ) : lista.length === 0 ? (
        <EmptyState
          icon={<IconWrench size={24} />}
          title="No hay contratos de subcontrata"
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-4 py-2">Obra</th>
                <th className="px-4 py-2">Subcontrata</th>
                <th className="px-4 py-2">Contrato</th>
                <th className="px-4 py-2 text-right">Importe</th>
                <th className="px-4 py-2">Ejecutado</th>
                <th className="px-4 py-2 text-right">Garantía pendiente</th>
                <th className="px-4 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSeleccion(c.id)}
                  className={`cursor-pointer border-b last:border-0 hover:bg-blue-50/50 ${
                    c.id === seleccion ? 'bg-blue-50' : ''
                  }`}
                >
                  <td className="px-4 py-2">
                    <span className="font-medium">{c.proyectoCodigo}</span>{' '}
                    <span className="text-xs text-gray-500">
                      {c.proyectoNombre}
                    </span>
                  </td>
                  <td className="px-4 py-2">{c.proveedorNombre}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {c.numeroContrato}
                    {c.hayBorrador && (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 font-sans text-[10px] text-gray-600">
                        borrador abierto
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatEur(c.importeTotal)}
                  </td>
                  <td className="px-4 py-2">
                    <BarraEjecucion pct={c.pctEjecutado} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatEur(c.retencionPendiente)}
                  </td>
                  <td className="px-4 py-2 text-xs capitalize text-gray-600">
                    {c.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {elegido && <DetalleContrato key={elegido.id} contrato={elegido} />}
    </div>
  );
}
