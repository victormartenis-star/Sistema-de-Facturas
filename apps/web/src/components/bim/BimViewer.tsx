'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BimElementLinkDto } from '@erp/shared';

/**
 * Visor 3D de un modelo IFC: carga y parsea el `.ifc` 100% en el navegador
 * con `web-ifc` (el backend solo guarda el fichero original, ver
 * `packages/shared/src/bim.ts`), construye la geometría con `three` y
 * colorea cada elemento según su vínculo a una partida de presupuesto.
 *
 * `web-ifc` no tiene tipos para su build WASM del navegador más allá de la
 * API pública (`IfcAPI`), así que el import es dinámico dentro del efecto
 * para no arrastrar el WASM al bundle del servidor (este componente ya se
 * monta vía `next/dynamic({ ssr: false })`, ver `index.tsx`).
 */

export interface ElementClickInfo {
  globalId: string;
  name: string | null;
  ifcType: string | null;
}

interface BimViewerProps {
  buffer: ArrayBuffer;
  /** Vínculos ya cargados, por `ifcGlobalId` — para colorear por % certificado. */
  linksByGlobalId: Map<string, BimElementLinkDto>;
  onElementClick: (info: ElementClickInfo) => void;
  /** Cambia cuando se quiere forzar un repintado de colores sin recargar el modelo. */
  colorVersion: number;
}

const COLOR_SIN_VINCULAR = new THREE.Color(0x9ca3af); // gris (gray-400)
const COLOR_VINCULADA_SIN_PCT = new THREE.Color(0x60a5fa); // azul (blue-400)
const COLOR_SELECCIONADA = new THREE.Color(0xf59e0b); // ámbar (amber-500)

/** Gradiente rojo (0%) → verde (100%) para el % certificado a origen. */
function colorForPct(pct: number): THREE.Color {
  const t = Math.min(Math.max(pct, 0), 100) / 100;
  const hue = (t * 120) / 360; // 0 = rojo, 120° = verde
  return new THREE.Color().setHSL(hue, 0.65, 0.5);
}

export function BimViewer({
  buffer,
  linksByGlobalId,
  onElementClick,
  colorVersion,
}: BimViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'cargando' | 'listo' | 'error'>(
    'cargando',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Expuesto entre efectos vía ref: el efecto de colores no debe recargar el modelo.
  const meshesRef = useRef<
    { mesh: THREE.Mesh; expressID: number; globalId: string }[]
  >([]);
  const rendererRef = useRef<{
    scene: THREE.Scene;
    renderNow: () => void;
  } | null>(null);

  useEffect(() => {
    let disposed = false;
    let renderer: THREE.WebGLRenderer | undefined;
    let ifcApi: import('web-ifc').IfcAPI | undefined;
    let modelID: number | undefined;
    let frameHandle: number | undefined;

    async function init() {
      const container = containerRef.current;
      if (!container) return;
      setStatus('cargando');
      setErrorMsg(null);

      const { IfcAPI } = await import('web-ifc');
      ifcApi = new IfcAPI();
      ifcApi.SetWasmPath('/wasm/');
      await ifcApi.Init();
      if (disposed) return;

      modelID = ifcApi.OpenModel(new Uint8Array(buffer));

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf4f6f8);
      const group = new THREE.Group();
      scene.add(group);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(5, 10, 7.5);
      scene.add(dirLight);

      const meshes: {
        mesh: THREE.Mesh;
        expressID: number;
        globalId: string;
      }[] = [];

      ifcApi.StreamAllMeshes(modelID, (flatMesh) => {
        const line = ifcApi!.GetLine(modelID!, flatMesh.expressID);
        const globalId: string | null = line?.GlobalId?.value ?? null;
        if (!globalId) return;

        for (let i = 0; i < flatMesh.geometries.size(); i++) {
          const placed = flatMesh.geometries.get(i);
          const ifcGeom = ifcApi!.GetGeometry(
            modelID!,
            placed.geometryExpressID,
          );
          const vertexData = ifcApi!.GetVertexArray(
            ifcGeom.GetVertexData(),
            ifcGeom.GetVertexDataSize(),
          );
          const indexData = ifcApi!.GetIndexArray(
            ifcGeom.GetIndexData(),
            ifcGeom.GetIndexDataSize(),
          );

          // Vértices intercalados [x,y,z, nx,ny,nz] (6 floats por vértice).
          const positions = new Float32Array((vertexData.length / 6) * 3);
          const normals = new Float32Array((vertexData.length / 6) * 3);
          for (let v = 0; v < vertexData.length / 6; v++) {
            positions[v * 3] = vertexData[v * 6];
            positions[v * 3 + 1] = vertexData[v * 6 + 1];
            positions[v * 3 + 2] = vertexData[v * 6 + 2];
            normals[v * 3] = vertexData[v * 6 + 3];
            normals[v * 3 + 1] = vertexData[v * 6 + 4];
            normals[v * 3 + 2] = vertexData[v * 6 + 5];
          }

          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(positions, 3),
          );
          geometry.setAttribute(
            'normal',
            new THREE.BufferAttribute(normals, 3),
          );
          geometry.setIndex(new THREE.BufferAttribute(indexData, 1));

          const material = new THREE.MeshLambertMaterial({
            color: COLOR_SIN_VINCULAR,
            side: THREE.DoubleSide,
            transparent: placed.color.w < 1,
            opacity: placed.color.w,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.applyMatrix4(
            new THREE.Matrix4().fromArray(placed.flatTransformation),
          );
          mesh.userData.expressID = flatMesh.expressID;
          mesh.userData.globalId = globalId;
          group.add(mesh);
          meshes.push({ mesh, expressID: flatMesh.expressID, globalId });

          ifcGeom.delete();
        }
      });

      meshesRef.current = meshes;

      // Encuadra la cámara al bounding box del modelo completo.
      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 1);

      const camera = new THREE.PerspectiveCamera(
        50,
        container.clientWidth / container.clientHeight,
        maxDim / 1000,
        maxDim * 100,
      );
      camera.position.set(
        center.x + maxDim,
        center.y + maxDim,
        center.z + maxDim,
      );
      camera.lookAt(center);

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(container.clientWidth, container.clientHeight);
      container.innerHTML = '';
      container.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(center);
      controls.update();

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      renderer.domElement.addEventListener('click', (ev: MouseEvent) => {
        const rect = renderer!.domElement.getBoundingClientRect();
        pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(group.children, false)[0];
        if (!hit) return;
        const expressID = hit.object.userData.expressID as number;
        const globalId = hit.object.userData.globalId as string;
        const line = ifcApi!.GetLine(modelID!, expressID);
        onElementClick({
          globalId,
          name: line?.Name?.value ?? null,
          ifcType: ifcApi!.GetNameFromTypeCode(line?.type ?? 0) ?? null,
        });
      });

      const resize = () => {
        if (!container || !renderer) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
      };
      window.addEventListener('resize', resize);

      const renderNow = () => renderer?.render(scene, camera);
      const animate = () => {
        controls.update();
        renderNow();
        frameHandle = requestAnimationFrame(animate);
      };
      animate();
      rendererRef.current = { scene, renderNow };

      setStatus('listo');

      return () => window.removeEventListener('resize', resize);
    }

    const cleanupPromise = init().catch((err) => {
      if (disposed) return undefined;
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return undefined;
    });

    return () => {
      disposed = true;
      if (frameHandle) cancelAnimationFrame(frameHandle);
      void cleanupPromise.then((cleanup) => cleanup?.());
      meshesRef.current.forEach(({ mesh }) => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      meshesRef.current = [];
      if (modelID !== undefined) ifcApi?.CloseModel(modelID);
      renderer?.dispose();
    };
    // `onElementClick` se omite a propósito: recrear el visor en cada
    // cambio de identidad de ese callback recargaría el modelo entero.
  }, [buffer]);

  // Repinta colores cuando cambian los vínculos, sin recargar el modelo.
  useEffect(() => {
    for (const { mesh, globalId } of meshesRef.current) {
      const link = linksByGlobalId.get(globalId);
      const material = mesh.material as THREE.MeshLambertMaterial;
      if (!link || !link.budgetItemId) {
        material.color.copy(COLOR_SIN_VINCULAR);
      } else if (link.certifiedPct === null) {
        material.color.copy(COLOR_VINCULADA_SIN_PCT);
      } else {
        material.color.copy(colorForPct(link.certifiedPct));
      }
    }
    rendererRef.current?.renderNow();
    // Silencia COLOR_SELECCIONADA (reservado para un futuro resaltado de
    // la selección activa; no usado todavía) sin quitarlo del módulo.
    void COLOR_SELECCIONADA;
  }, [linksByGlobalId, colorVersion]);

  return (
    <div className="relative h-[560px] w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
      <div ref={containerRef} className="h-full w-full" />
      {status === 'cargando' && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 text-sm text-gray-500">
          Cargando modelo 3D…
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50/90 px-6 text-center text-sm text-red-600">
          No se ha podido cargar el modelo: {errorMsg}
        </div>
      )}
    </div>
  );
}
