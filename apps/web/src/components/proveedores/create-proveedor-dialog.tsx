'use client';

import { useState } from 'react';
import { useToast } from '@/components/toast';
import {
  Modal,
  btnPrimaryCls,
  btnGhostCls,
  fieldCls,
  inputCls,
  labelCls,
  selectCls,
} from '@/components/ui';
import { IconAlertTriangle } from '@/components/icons';
import { ProveedorTableRow } from '@/types/erp-finance';

/**
 * Componente Modal de Registro Rápido de Proveedor/Subcontrata
 *
 * Modal estructurado para el alta rápida de nuevos proveedores o subcontratistas.
 * Incluye validación de campos obligatorios y CIF/NIF único.
 *
 * Props:
 *   - open: boolean - controla la visibilidad del modal
 *   - onClose: () => void - callback para cerrar el modal
 *   - onSuccess: (proveedor: ProveedorTableRow) => void - callback al éxito
 *   - modo?: 'proveedor' | 'subcontrata' - modo de registro
 */

interface CreateProveedorDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (proveedor: ProveedorTableRow) => void;
  modo?: 'proveedor' | 'subcontrata';
}

interface ProveedorFormState {
  razonSocial: string;
  cifNif: string;
  tipo: 'proveedor' | 'subcontrata';
  categoriaPrincipal: string;
  condicionesPagoDias: number;
  retencionGarantiaPct: number;
  activo: boolean;
  notas: string;
}

/**
 * Componente CreateProveedorDialog
 *
 * Formulario de alta de proveedor con los campos mínimos necesarios:
 * - Razón social
 * - CIF/NIF (único por empresa)
 * - Tipo (proveedor/subcontrata)
 * - Categoría principal
 * - Condiciones de pago
 * - Retención de garantía
 */

function CreateProveedorDialog({
  open,
  onClose,
  onSuccess,
  modo = 'proveedor',
}: CreateProveedorDialogProps) {
  const toast = useToast();
  const [form, setForm] = useState<ProveedorFormState>({
    razonSocial: '',
    cifNif: '',
    tipo: modo,
    categoriaPrincipal: '',
    condicionesPagoDias: 30,
    retencionGarantiaPct: 5,
    activo: true,
    notas: '',
  });

  // Estados de validación
  const [cifNifValido, setCifNifValido] = useState(false);
  const [formValido, setFormValido] = useState(false);

  // Validar CIF/NIF (formato básico: 9 caracteres alfanuméricos para español)
  const validarCifNif = (cif: string) => {
    const regex = /^[0-9ABCDEFGHJKLMNOPQRSTUVWXYZ]{8}[0-9A-Z]$/;
    const valido = regex.test(cif) && cif.length === 9;
    setCifNifValido(valido);
    return valido;
  };

  // Calcular si el formulario es válido
  const actualizarValidezFormulario = (siguiente: ProveedorFormState) => {
    const razonSocialOk = siguiente.razonSocial.trim().length > 0;
    const cifValido =
      siguiente.cifNif.trim().length > 0
        ? validarCifNif(siguiente.cifNif)
        : false;
    setFormValido(razonSocialOk && cifValido);
  };

  // Actualizar formulario en tiempo real
  const manejarCambio = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    const siguiente = { ...form, [name]: value };
    setForm(siguiente);
    actualizarValidezFormulario(siguiente);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formValido) {
      toast(
        'Por favor complete todos los campos obligatorios y verifique el CIF/NIF',
        'error',
      );
      return;
    }

    try {
      // En producción: llamar a la API POST /proveedores
      // Por ahora simulamos el alta
      const nuevoProveedor: ProveedorTableRow = {
        id: 'nuevo-' + Date.now(),
        cifNif: form.cifNif,
        tipo: form.tipo,
        categoriaPrincipal: form.categoriaPrincipal || null,
        activo: form.activo,
        retencionGarantiaPct: form.retencionGarantiaPct,
        condicionesPagoDias: form.condicionesPagoDias,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        razonSocial: form.razonSocial,
      };

      toast('Proveedor/subcontrata dado de alta exitosamente');
      onSuccess?.(nuevoProveedor);
      onClose();
    } catch (error) {
      toast('Error al dar de alta el proveedor. Intente nuevamente.', 'error');
      console.error(error);
    }
  };

  return (
    <Modal
      open={open}
      title={`Alta ${modo === 'subcontrata' ? 'Subcontrata' : 'Proveedor'}`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className={fieldCls}>
          <label className={labelCls}>
            Razón Social / Nombre Comercial{' '}
            <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            name="razonSocial"
            required
            value={form.razonSocial}
            onChange={manejarCambio}
            placeholder="Ej: Constructora S.A. o Materiales ABC"
            className={inputCls}
          />
        </div>

        <div className={fieldCls}>
          <label className={labelCls}>
            CIF/NIF <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            name="cifNif"
            required
            value={form.cifNif}
            onChange={manejarCambio}
            placeholder="Ej: A2854729B o B12345678"
            className={inputCls}
            maxLength={9}
            onBlur={() => validarCifNif(form.cifNif)}
          />
          {!cifNifValido && form.cifNif.trim().length > 0 && (
            <p className="mt-1 text-xs text-red-500">
              <IconAlertTriangle size={12} className="mr-1 inline" />
              Formato de CIF/NIF inválido. Debe tener 9 caracteres
              (8+Número+Letra)
            </p>
          )}
        </div>

        <div className={fieldCls}>
          <label className={labelCls}>Tipo</label>
          <select
            className={selectCls}
            value={form.tipo}
            onChange={(e) => {
              const siguiente = {
                ...form,
                tipo: e.target.value as 'proveedor' | 'subcontrata',
              };
              setForm(siguiente);
            }}
          >
            <option value="proveedor">Proveedor</option>
            <option value="subcontrata">Subcontrata</option>
          </select>
        </div>

        <div className={fieldCls}>
          <label className={labelCls}>
            Categoría Principal{' '}
            <span className="text-sm text-gray-400">
              (ej. Materiales, Mano de obra, Maquinaria)
            </span>
          </label>
          <input
            type="text"
            name="categoriaPrincipal"
            value={form.categoriaPrincipal}
            onChange={manejarCambio}
            placeholder="Materiales"
            className={inputCls}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label className={labelCls}>Condiciones de Pago (días)</label>
            <input
              type="number"
              name="condicionesPagoDias"
              value={form.condicionesPagoDias}
              onChange={(e) =>
                setForm({
                  ...form,
                  condicionesPagoDias: parseInt(e.target.value, 10) || 0,
                })
              }
              min="0"
              max="365"
              step="1"
              className={inputCls}
            />
            <p className="text-xs text-gray-400 mt-1">
              Plazo habitual de pago al proveedor
            </p>
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Retención Garantía %</label>
            <input
              type="number"
              name="retencionGarantiaPct"
              value={form.retencionGarantiaPct}
              onChange={(e) =>
                setForm({
                  ...form,
                  retencionGarantiaPct: parseFloat(e.target.value) || 0,
                })
              }
              min="0"
              max="50"
              step="0.5"
              className={inputCls}
            />
            <p className="text-xs text-gray-400 mt-1">
              Porcentaje de retención de garantía (máx. 50%)
            </p>
          </div>
        </div>

        <div className={fieldCls}>
          <label className={labelCls}>Notas (opcional)</label>
          <textarea
            name="notas"
            rows={2}
            value={form.notas}
            onChange={(e) => setForm({ ...form, notas: e.target.value })}
            maxLength={500}
            className={inputCls}
            placeholder="Observaciones adicionales"
          />
        </div>

        <div className="flex justify-end gap-3 pt-3">
          <button type="button" onClick={onClose} className={btnGhostCls}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!formValido}
            className={btnPrimaryCls}
          >
            {formValido ? 'Registrar' : 'Validar campos'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export { CreateProveedorDialog, type CreateProveedorDialogProps };
