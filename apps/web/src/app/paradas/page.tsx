'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  STOPPAGE_ATTRIBUTIONS,
  STOPPAGE_ATTRIBUTION_LABELS,
  STOPPAGE_CAUSES,
  STOPPAGE_CAUSE_LABELS,
  STOPPAGE_COST_CONCEPTS,
  STOPPAGE_COST_CONCEPT_LABELS,
  type StoppageAttribution,
  type StoppageCause,
  type StoppageCostConcept,
  type StoppageDto,
} from '@erp/shared';
import { formatDate, formatEur, projectsApi, stoppagesApi } from '@/lib/api';
import { useToast } from '@/components/toast';
import { IconAlertTriangle, IconPause, IconPlus } from '@/components/icons';
import {
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  TableSkeleton,
  btnPrimaryCls,
  fieldCls,
  labelCls,
  selectCls,
} from '@/components/ui';

const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Error inesperado';

const hoy = () => new Date().toISOString().slice(0, 10);

/** Ficha de un expediente, con su valoración y lo que hay que leer de él. */
function Expediente({ s }: { s: StoppageDto }) {
  const abierta = s.status === 'abierta';
  return (
    <article
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
        abierta ? 'border-red-200' : 'border-gray-200'
      }`}
    >
      <header
        className={`flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4 ${
          abierta ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'
        }`}
      >
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="font-mono text-xs text-gray-500">
              {s.stoppageNumber}
            </span>
            {STOPPAGE_CAUSE_LABELS[s.cause]}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
                abierta ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-700'
              }`}
            >
              {abierta ? 'Obra parada' : 'Reanudada'}
            </span>
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Del {formatDate(s.startDate)}
            {s.endDate
              ? ` al ${formatDate(s.endDate)}`
              : ' (sin reanudar)'} · {s.valuation.days} día(s) naturales ·
            Imputable a {STOPPAGE_ATTRIBUTION_LABELS[s.attribution]}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            Coste acumulado
          </p>
          <p className="text-lg font-bold tabular-nums">
            {formatEur(s.valuation.accruedTotal)}
          </p>
          {abierta && s.valuation.dailyTotal > 0 && (
            <p className="text-xs font-medium text-red-600">
              +{formatEur(s.valuation.dailyTotal)} cada día
            </p>
          )}
        </div>
      </header>

      <div className="px-5 py-4">
        <p className="text-sm text-gray-700">{s.description}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
              Expediente abierto
            </p>
            {/* El manual dice «el mismo día». Cero es lo correcto; cualquier
                otra cosa es lo primero que la otra parte va a discutir. */}
            <p className="mt-0.5 text-sm">
              {formatDate(s.openedAt)}
              {s.daysToOpen > 0 ? (
                <span className="ml-1 text-xs font-semibold text-red-600">
                  ({s.daysToOpen} días tarde)
                </span>
              ) : (
                <span className="ml-1 text-xs text-emerald-600">
                  (el mismo día)
                </span>
              )}
            </p>
            {s.openedBy && (
              <p className="text-xs text-gray-500">{s.openedBy}</p>
            )}
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
              Comunicación
            </p>
            <p className="mt-0.5 text-sm">
              {s.notifiedAt ? (
                formatDate(s.notifiedAt)
              ) : (
                <span className="text-red-600">Sin comunicar</span>
              )}
            </p>
            {s.notifiedTo && (
              <p className="text-xs text-gray-500">{s.notifiedTo}</p>
            )}
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
              Reclamado
            </p>
            <p className="mt-0.5 text-sm">
              {s.claimedAmount === null ? (
                <span className="text-gray-500">Sin reclamar</span>
              ) : (
                <>
                  {formatEur(s.claimedAmount)}
                  {s.claimedAt && (
                    <span className="ml-1 text-xs text-gray-500">
                      {formatDate(s.claimedAt)}
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
        </div>

        {s.valuation.lines.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[11px] tracking-wide text-gray-500 uppercase">
                <th className="py-1.5 font-medium">Coste corriente</th>
                <th className="py-1.5 text-right font-medium">€/día</th>
                <th className="py-1.5 text-right font-medium">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {s.valuation.lines.map((l) => (
                <tr key={l.concept} className="border-b border-gray-100">
                  <td className="py-1.5">
                    {STOPPAGE_COST_CONCEPT_LABELS[l.concept]}
                    {l.description && (
                      <span className="ml-2 text-xs text-gray-500">
                        {l.description}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatEur(l.dailyAmount)}
                  </td>
                  <td className="py-1.5 text-right font-medium tabular-nums">
                    {formatEur(l.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {s.warnings.length > 0 && (
          <ul className="mt-4 space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
            {s.warnings.map((w) => (
              <li key={w} className="text-xs text-amber-800">
                · {w}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

interface CosteForm {
  concept: StoppageCostConcept;
  description: string;
  dailyAmount: string;
}

export default function ParadasPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [projectId, setProjectId] = useState('');
  const [open, setOpen] = useState(false);

  const [startDate, setStartDate] = useState(hoy());
  const [endDate, setEndDate] = useState('');
  const [cause, setCause] = useState<StoppageCause>(
    'falta_definicion_proyecto',
  );
  const [attribution, setAttribution] =
    useState<StoppageAttribution>('propiedad');
  const [description, setDescription] = useState('');
  const [openedAt, setOpenedAt] = useState(hoy());
  const [openedBy, setOpenedBy] = useState('');
  const [notifiedAt, setNotifiedAt] = useState('');
  const [notifiedTo, setNotifiedTo] = useState('');
  // Los cuatro conceptos salen en el formulario aunque vayan a cero: si no se
  // enseñan, no se valoran, y lo que no se valora no se reclama.
  const [costes, setCostes] = useState<CosteForm[]>(
    STOPPAGE_COST_CONCEPTS.filter((c) => c !== 'otros').map((concept) => ({
      concept,
      description: '',
      dailyAmount: '',
    })),
  );

  const projectsQuery = useQuery({
    queryKey: ['projects', '', ''],
    queryFn: () => projectsApi.list('', ''),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!projectId && projectsQuery.data?.length) {
      setProjectId(projectsQuery.data[0].id);
    }
  }, [projectId, projectsQuery.data]);

  const query = useQuery({
    queryKey: ['paradas', projectId],
    queryFn: () => stoppagesApi.report(projectId),
    enabled: Boolean(projectId),
  });

  const create = useMutation({
    mutationFn: () =>
      stoppagesApi.create({
        projectId,
        startDate,
        endDate: endDate || null,
        cause,
        attribution,
        description,
        openedAt,
        openedBy: openedBy || null,
        notifiedAt: notifiedAt || null,
        notifiedTo: notifiedTo || null,
        costs: costes
          .filter((c) => c.dailyAmount.trim() !== '')
          .map((c) => ({
            concept: c.concept,
            description: c.description || null,
            dailyAmount: Number(c.dailyAmount),
          })),
      }),
    onSuccess: () => {
      toast('Expediente abierto');
      setOpen(false);
      setDescription('');
      setNotifiedAt('');
      setNotifiedTo('');
      setEndDate('');
      qc.invalidateQueries({ queryKey: ['paradas'] });
    },
    onError: (e) => toast(errText(e), 'error'),
  });

  const r = query.data;

  return (
    <div className="animate-fade-in-up">
      <PageHeader
        title="Cese de obra"
        subtitle="Expediente de parada por causa ajena, con los costes que siguen corriendo desde el día uno"
      >
        <select
          className={selectCls}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          {projectsQuery.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
        <button
          className={btnPrimaryCls}
          onClick={() => {
            setStartDate(hoy());
            setOpenedAt(hoy());
            setOpen(true);
          }}
        >
          <IconPlus size={14} />
          Abrir expediente
        </button>
      </PageHeader>

      <p className="mb-5 text-xs text-gray-500">
        Cuando la obra se detiene por causa ajena el expediente se abre{' '}
        <strong className="font-semibold">el mismo día</strong>, con la causa,
        el responsable y la valoración de lo que sigue corriendo. Es la base
        para reclamar: si no se hace en el momento, después es irrecuperable.
      </p>

      {query.isError && <ErrorBanner message={errText(query.error)} />}
      {query.isLoading && <TableSkeleton rows={4} />}

      {r && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:grid-cols-4">
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Días de parada
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {r.totalDays}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Coste acumulado
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {formatEur(r.totalAccrued)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Reclamable
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {formatEur(r.claimableAccrued)}
              </p>
              <p className="text-xs text-gray-500">Solo lo de causa ajena</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Ya reclamado
              </p>
              <p
                className={`mt-1 text-2xl font-bold tabular-nums ${
                  r.totalClaimed === 0 && r.claimableAccrued > 0
                    ? 'text-red-600'
                    : ''
                }`}
              >
                {formatEur(r.totalClaimed)}
              </p>
            </div>
          </div>

          {r.warnings.length > 0 && (
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
                <IconAlertTriangle size={16} />
                Atención
              </p>
              <ul className="space-y-1.5">
                {r.warnings.map((w) => (
                  <li key={w} className="text-sm text-amber-800">
                    · {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {r.stoppages.length === 0 ? (
            <EmptyState
              icon={<IconPause size={26} />}
              title="Sin paradas registradas"
            >
              <p className="mx-auto max-w-md text-sm text-gray-500">
                Que no haya expedientes puede significar que la obra no ha
                parado, o que paró y nadie lo documentó. Lo segundo solo se ve
                cuando ya no se puede reclamar.
              </p>
            </EmptyState>
          ) : (
            <div className="space-y-5">
              {r.stoppages.map((s) => (
                <Expediente key={s.id} s={s} />
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Abrir expediente de cese"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Fecha de parada</label>
            <input
              type="date"
              className={fieldCls}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Reanudación (si ya volvió)</label>
            <input
              type="date"
              className={fieldCls}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Causa</label>
            <select
              className={selectCls + ' w-full'}
              value={cause}
              onChange={(e) => setCause(e.target.value as StoppageCause)}
            >
              {STOPPAGE_CAUSES.map((c) => (
                <option key={c} value={c}>
                  {STOPPAGE_CAUSE_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Imputable a</label>
            <select
              className={selectCls + ' w-full'}
              value={attribution}
              onChange={(e) =>
                setAttribution(e.target.value as StoppageAttribution)
              }
            >
              {STOPPAGE_ATTRIBUTIONS.map((a) => (
                <option key={a} value={a}>
                  {STOPPAGE_ATTRIBUTION_LABELS[a]}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Qué ha parado y por qué</label>
            <textarea
              className={fieldCls}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tajo afectado, motivo concreto y referencia del escrito o del expediente"
            />
          </div>
          <div>
            <label className={labelCls}>Expediente abierto el</label>
            <input
              type="date"
              className={fieldCls}
              value={openedAt}
              onChange={(e) => setOpenedAt(e.target.value)}
            />
            {openedAt > startDate && (
              <p className="mt-1 text-xs text-red-600">
                Posterior a la parada: quedará registrado el retraso.
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Quién lo abre</label>
            <input
              className={fieldCls}
              value={openedBy}
              onChange={(e) => setOpenedBy(e.target.value)}
              placeholder="Jefe de obra"
            />
          </div>
          <div>
            <label className={labelCls}>Comunicado el</label>
            <input
              type="date"
              className={fieldCls}
              value={notifiedAt}
              onChange={(e) => setNotifiedAt(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Comunicado a</label>
            <input
              className={fieldCls}
              value={notifiedTo}
              onChange={(e) => setNotifiedTo(e.target.value)}
              placeholder="Propiedad y DF, por burofax"
            />
          </div>

          <div className="sm:col-span-2">
            <p className="mb-1 text-xs font-semibold text-gray-700">
              Costes que siguen corriendo, por día natural
            </p>
            <p className="mb-3 text-xs text-gray-500">
              Los cuatro conceptos del manual. Deja en blanco el que esta obra
              no tenga: se avisará de que falta para que conste que fue una
              decisión.
            </p>
            <div className="space-y-2">
              {costes.map((c, i) => (
                <div key={c.concept} className="flex items-center gap-2">
                  <span className="w-44 shrink-0 text-xs text-gray-600">
                    {STOPPAGE_COST_CONCEPT_LABELS[c.concept]}
                  </span>
                  <input
                    className={fieldCls}
                    placeholder="Detalle (grúa, 2 oficiales…)"
                    value={c.description}
                    onChange={(e) =>
                      setCostes((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <input
                    className={`${fieldCls} w-32 text-right tabular-nums`}
                    inputMode="decimal"
                    placeholder="€/día"
                    value={c.dailyAmount}
                    onChange={(e) =>
                      setCostes((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, dailyAmount: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className={btnPrimaryCls}
            disabled={!description.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Guardando…' : 'Abrir expediente'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
