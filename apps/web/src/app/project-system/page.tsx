'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  TIPO_LIBERACION_RETENCION_LABELS,
  type LadoRetencion,
  type LiberacionRetencionDto,
  type ResumenRetencionLado,
  type TipoLiberacionRetencion,
} from '@erp/shared';
import {
  avalesApi,
  formatDate,
  formatEur,
  projectSystemApi,
  projectsApi,
  subcontratasApi,
} from '@/lib/api';
import { nuevoUuid } from '@/lib/api-error';
import { crearGuardaEnvio } from '@/lib/envio-unico';
import { usePermisos } from '@/lib/permisos';
import { Autorizado } from '@/components/autorizado';
import { useAvisarError, useToast } from '@/components/toast';
import {
  ErrorBanner,
  PageHeader,
  btnGhostCls,
  btnPrimaryCls,
  inputCls,
  selectCls,
} from '@/components/ui';

const hoy = () => new Date().toISOString().slice(0, 10);
const LADO: Record<LadoRetencion, string> = {
  cobro: 'Nos retiene el cliente (4301)',
  pago: 'Retenemos a subcontratas y proveedores (4001)',
};

function useRefrescar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['project-system'] });
    void qc.invalidateQueries({ queryKey: ['treasury'] });
    void qc.invalidateQueries({ queryKey: ['avales'] });
  };
}

export default function ProjectSystemPage() {
  const [projectId, setProjectId] = useState('');
  const obras = useQuery({
    queryKey: ['projects', 'project-system'],
    queryFn: () => projectsApi.list('', ''),
  });
  return (
    <div>
      <PageHeader
        title="Project System"
        subtitle="Retenciones de garantía de la obra (cliente y subcontratas), su liberación por hito o sustitución por aval bancario, y modificados de los contratos de subcontrata."
      >
        <select
          className={selectCls}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          aria-label="Obra"
        >
          <option value="">Obra…</option>
          {(obras.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
      </PageHeader>
      {projectId ? (
        <>
          <Retenciones key={`r-${projectId}`} projectId={projectId} />
          <Modificados key={`m-${projectId}`} projectId={projectId} />
        </>
      ) : (
        <p className="text-sm text-gray-500">Elige una obra.</p>
      )}
    </div>
  );
}

function Tarjeta({ titulo, r }: { titulo: string; r: ResumenRetencionLado }) {
  return (
    <div className="rounded-xl border bg-white p-3 text-sm shadow-sm">
      <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
        {titulo}
      </p>
      <p>
        Retenido {formatEur(r.retenido)} · liquidado {formatEur(r.liquidado)}
      </p>
      <p className="font-semibold">Pendiente {formatEur(r.pendiente)}</p>
      <p className="text-xs text-gray-600">
        Liberable {formatEur(r.liberable)} · sustituido por aval{' '}
        {formatEur(r.sustituidoAval)} · en garantía {formatEur(r.enGarantia)}
      </p>
    </div>
  );
}

function Retenciones({ projectId }: { projectId: string }) {
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [tipo, setTipo] = useState<TipoLiberacionRetencion>('hito');
  const [avalId, setAvalId] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [motivo, setMotivo] = useState('');
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const datos = useQuery({
    queryKey: ['project-system', 'retenciones', projectId],
    queryFn: () => projectSystemApi.retenciones(projectId),
  });
  const liberaciones = useQuery({
    queryKey: ['project-system', 'liberaciones', projectId],
    queryFn: () => projectSystemApi.liberaciones(projectId),
  });
  const seleccion = (datos.data?.retenciones ?? []).filter((r) =>
    elegidas.includes(r.vencimientoId),
  );
  const lado = seleccion[0]?.lado;
  const tercero = seleccion[0]?.contactId;
  const avales = useQuery({
    queryKey: ['avales', 'sustitucion', projectId, lado, tercero],
    queryFn: () =>
      avalesApi.listar({
        tipo: 'retencion_garantia',
        direccion: lado === 'pago' ? 'recibido' : 'emitido',
        vivos: 'true',
      }),
    enabled: tipo === 'aval' && Boolean(lado),
  });
  const liberar = useMutation({
    mutationFn: () =>
      projectSystemApi.liberar(
        projectId,
        {
          tipo,
          fecha,
          vencimientoIds: elegidas,
          motivo,
          ...(tipo === 'aval' ? { avalId } : {}),
        },
        clave.current,
      ),
    onSuccess: (l) => {
      clave.current = nuevoUuid();
      setElegidas([]);
      setMotivo('');
      toast(
        `Liberados ${formatEur(l.importe)} de retención (${TIPO_LIBERACION_RETENCION_LABELS[l.tipo]})`,
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const anular = useMutation({
    mutationFn: (l: LiberacionRetencionDto) =>
      projectSystemApi.anularLiberacion(l.id, motivo, l.version),
    onSuccess: () => {
      setMotivo('');
      toast('Liberación deshecha: la retención vuelve a su vencimiento');
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  const ocupado = liberar.isPending || anular.isPending;
  useEffect(() => {
    if (!ocupado) guarda.liberar();
  }, [ocupado, guarda]);
  const d = datos.data;
  const avalesDelTercero = (avales.data ?? []).filter(
    (a) => a.contactId === tercero,
  );
  const valido =
    elegidas.length > 0 &&
    motivo.trim().length >= 3 &&
    (tipo === 'hito' || avalId !== '');

  return (
    <section className="mb-8">
      {datos.isError && (
        <ErrorBanner message={(datos.error as Error).message} />
      )}
      {d && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <Tarjeta titulo={LADO.cobro} r={d.resumen.cobro} />
          <Tarjeta titulo={LADO.pago} r={d.resumen.pago} />
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2" />
              <th className="px-3 py-2">Lado</th>
              <th className="px-3 py-2">Tercero</th>
              <th className="px-3 py-2">Factura</th>
              <th className="px-3 py-2 text-right">Pendiente</th>
              <th className="px-3 py-2">Vence</th>
              <th className="px-3 py-2">Liberación</th>
            </tr>
          </thead>
          <tbody>
            {(d?.retenciones ?? []).map((r) => {
              const elegible =
                r.pendiente > 0 &&
                !r.liberacion &&
                r.vencimiento > hoy() &&
                (!lado || (lado === r.lado && tercero === r.contactId));
              return (
                <tr key={r.vencimientoId} className="border-t border-gray-100">
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      disabled={
                        !elegible && !elegidas.includes(r.vencimientoId)
                      }
                      checked={elegidas.includes(r.vencimientoId)}
                      onChange={(e) =>
                        setElegidas(
                          e.target.checked
                            ? [...elegidas, r.vencimientoId]
                            : elegidas.filter((x) => x !== r.vencimientoId),
                        )
                      }
                      aria-label={`Elegir retención ${r.invoiceNumber}`}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {r.lado === 'cobro' ? 'Cliente' : 'Subcontrata'}
                  </td>
                  <td className="px-3 py-1.5">{r.contactName}</td>
                  <td className="px-3 py-1.5">{r.invoiceNumber}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatEur(r.pendiente)}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {formatDate(r.vencimiento)}
                    {r.vencimientoOriginal && (
                      <span className="block text-[11px] text-gray-500">
                        antes {formatDate(r.vencimientoOriginal)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {r.liberacion
                      ? `${TIPO_LIBERACION_RETENCION_LABELS[r.liberacion.tipo]}${r.liberacion.avalReferencia ? ` · ${r.liberacion.avalReferencia}` : ''}`
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Autorizado accion="cambiarEstado" recurso="retencion">
        <form
          className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !can('cambiarEstado', 'retencion') ||
              !valido ||
              ocupado ||
              !guarda.intentar()
            )
              return;
            liberar.mutate();
          }}
        >
          <select
            className={selectCls}
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoLiberacionRetencion)}
            aria-label="Tipo de liberación"
          >
            {(['hito', 'aval'] as const).map((t) => (
              <option key={t} value={t}>
                {TIPO_LIBERACION_RETENCION_LABELS[t]}
              </option>
            ))}
          </select>
          {tipo === 'aval' && (
            <select
              className={selectCls}
              value={avalId}
              onChange={(e) => setAvalId(e.target.value)}
              aria-label="Aval sustituto"
            >
              <option value="">Aval de retención del tercero…</option>
              {avalesDelTercero.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.referencia} · {a.entidad} · vivo {formatEur(a.saldoVivo)}
                </option>
              ))}
            </select>
          )}
          <input
            type="date"
            className={inputCls}
            value={fecha}
            max={hoy()}
            onChange={(e) => setFecha(e.target.value)}
            aria-label="Fecha de liberación"
          />
          <input
            className={`${inputCls} flex-1`}
            placeholder="Motivo (hito, aval recibido…)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            aria-label="Motivo"
          />
          <button
            type="submit"
            className={btnPrimaryCls}
            disabled={!valido || ocupado}
          >
            Liberar {elegidas.length > 0 ? `(${elegidas.length})` : ''}
          </button>
        </form>
      </Autorizado>
      {(liberaciones.data ?? []).length > 0 && (
        <ul className="mt-3 text-xs">
          {(liberaciones.data ?? []).map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between border-b border-gray-100 py-1"
            >
              <span>
                {formatDate(l.fecha)} ·{' '}
                {TIPO_LIBERACION_RETENCION_LABELS[l.tipo]} ·{' '}
                {formatEur(l.importe)} · {l.motivo}
                <span
                  className={`ml-2 ${l.estado === 'anulado' ? 'text-gray-400 line-through' : 'text-emerald-700'}`}
                >
                  {l.estado}
                </span>
              </span>
              {l.estado === 'vigente' && (
                <Autorizado accion="anular" recurso="retencion">
                  <button
                    type="button"
                    className={btnGhostCls}
                    disabled={ocupado || motivo.trim().length < 3}
                    title="Escribe el motivo en el formulario"
                    onClick={() => {
                      if (
                        !can('anular', 'retencion') ||
                        ocupado ||
                        motivo.trim().length < 3 ||
                        !guarda.intentar()
                      )
                        return;
                      anular.mutate(l);
                    }}
                  >
                    Deshacer
                  </button>
                </Autorizado>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Modificados({ projectId }: { projectId: string }) {
  const [contratoId, setContratoId] = useState('');
  const [importe, setImporte] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [motivo, setMotivo] = useState('');
  const clave = useRef(nuevoUuid());
  const [guarda] = useState(crearGuardaEnvio);
  const { can } = usePermisos();
  const toast = useToast();
  const avisarError = useAvisarError();
  const refrescar = useRefrescar();
  const contratos = useQuery({
    queryKey: ['project-system', 'contratos', projectId],
    queryFn: () => subcontratasApi.contratos({ proyectoId: projectId }),
  });
  const lista = useQuery({
    queryKey: ['project-system', 'modificados', contratoId],
    queryFn: () => projectSystemApi.modificados(contratoId),
    enabled: contratoId !== '',
  });
  const crear = useMutation({
    mutationFn: () =>
      projectSystemApi.crearModificado(
        contratoId,
        { fecha, importe: Number(importe.replace(',', '.')), motivo },
        clave.current,
      ),
    onSuccess: (m) => {
      clave.current = nuevoUuid();
      setImporte('');
      setMotivo('');
      toast(
        `Modificado registrado: contrato en ${formatEur(m[m.length - 1].importeNuevo)}`,
      );
      refrescar();
    },
    onError: (e) => avisarError(e, refrescar),
  });
  useEffect(() => {
    if (!crear.isPending) guarda.liberar();
  }, [crear.isPending, guarda]);
  const actual = (contratos.data ?? []).find((c) => c.id === contratoId);
  const valido =
    contratoId !== '' &&
    Number(importe.replace(',', '.')) !== 0 &&
    motivo.trim().length >= 3;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">
        Modificados de contratos de subcontrata
      </h2>
      <select
        className={`${selectCls} mb-2`}
        value={contratoId}
        onChange={(e) => setContratoId(e.target.value)}
        aria-label="Contrato de subcontrata"
      >
        <option value="">Contrato…</option>
        {(contratos.data ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.numeroContrato} · {c.proveedorNombre} ·{' '}
            {formatEur(c.importeTotal)} ({c.pctEjecutado} % ejecutado)
          </option>
        ))}
      </select>
      {actual && (
        <p className="mb-2 text-xs text-gray-600">
          Contratado {formatEur(actual.importeTotal)} · ejecutado{' '}
          {formatEur(actual.importeEjecutado)} · retención{' '}
          {actual.retencionGarantiaPct} %
        </p>
      )}
      {(lista.data ?? []).length > 0 && (
        <ul className="mb-2 text-xs">
          {(lista.data ?? []).map((m) => (
            <li key={m.id}>
              Modificado {m.numero} · {formatDate(m.fecha)} ·{' '}
              {formatEur(m.importe)} ({formatEur(m.importeAnterior)} →{' '}
              {formatEur(m.importeNuevo)}) · {m.motivo}
            </li>
          ))}
        </ul>
      )}
      {contratoId && (
        <Autorizado accion="crear" recurso="retencion">
          <form
            className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                !can('crear', 'retencion') ||
                !valido ||
                crear.isPending ||
                !guarda.intentar()
              )
                return;
              crear.mutate();
            }}
          >
            <input
              className={`${inputCls} w-32`}
              placeholder="Importe (±)"
              inputMode="decimal"
              value={importe}
              onChange={(e) => setImporte(e.target.value)}
              aria-label="Importe del modificado"
            />
            <input
              type="date"
              className={inputCls}
              value={fecha}
              max={hoy()}
              onChange={(e) => setFecha(e.target.value)}
              aria-label="Fecha del modificado"
            />
            <input
              className={`${inputCls} flex-1`}
              placeholder="Motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              aria-label="Motivo del modificado"
            />
            <button
              type="submit"
              className={btnPrimaryCls}
              disabled={!valido || crear.isPending}
            >
              Registrar modificado
            </button>
          </form>
        </Autorizado>
      )}
    </section>
  );
}
