'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RotateCcw } from 'lucide-react';
import type { GraphEdge, GraphNode, GraphNodeType } from '@/lib/types';
import { computePositions3D } from './graph3dLayout';

export interface Graph3DProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  activeNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  nodeColors: Record<GraphNodeType, string>;
  onSwitchTo2D?: () => void;
}

interface HoveredTooltip {
  id: string;
  label: string;
  type: GraphNodeType;
  x: number;
  y: number;
}

const DEFAULT_CAMERA_POS: [number, number, number] = [0, 2, 20];
const DEFAULT_TARGET: [number, number, number] = [0, 0, 0];

// Reusable math objects to avoid per-update / per-pointermove allocations
const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();
const _pointerNdc = new THREE.Vector2();

export function Graph3D({
  nodes,
  edges,
  activeNodeId,
  onSelectNode,
  nodeColors,
  onSwitchTo2D,
}: Graph3DProps) {
  const nodeListId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [hovered, setHovered] = useState<HoveredTooltip | null>(null);

  const onSelectNodeRef = useRef(onSelectNode);
  useEffect(() => {
    onSelectNodeRef.current = onSelectNode;
  }, [onSelectNode]);

  // Precomputed positions and instanceId -> node lookup
  const positions3D = useMemo(() => computePositions3D(nodes, edges), [nodes, edges]);

  const nodeIdsRef = useRef<string[]>([]);
  const nodesRef = useRef<GraphNode[]>([]);

  const sceneHandlesRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    sphereGeometry: THREE.SphereGeometry;
    nodeMaterial: THREE.MeshStandardMaterial;
    instancedMesh: THREE.InstancedMesh;
    instanceCapacity: number;
    baseEdgesGeometry: THREE.BufferGeometry;
    baseEdgesLines: THREE.LineSegments;
    highlightEdgesGeometry: THREE.BufferGeometry;
    highlightEdgesLines: THREE.LineSegments;
    requestRender: () => void;
  } | null>(null);

  // Initialize Three.js scene, renderer, controls, and event listeners once
  useEffect(() => {
    const container = viewportRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      const raf = requestAnimationFrame(() => setWebglUnavailable(true));
      return () => cancelAnimationFrame(raf);
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    const initialWidth = Math.max(container.clientWidth, 1);
    const initialHeight = Math.max(container.clientHeight, 1);
    renderer.setSize(initialWidth, initialHeight, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, initialWidth / initialHeight, 0.1, 200);
    camera.position.set(...DEFAULT_CAMERA_POS);

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(...DEFAULT_TARGET);
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.enablePan = true;
    // Respect prefers-reduced-motion and on-demand rendering: no auto-rotate or animated damping
    controls.autoRotate = false;
    controls.enableDamping = prefersReducedMotion ? false : false;
    controls.minDistance = 4;
    controls.maxDistance = 45;
    controls.update();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    const hemiLight = new THREE.HemisphereLight(0xf1f5f9, 0x334155, 0.65);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(10, 14, 16);
    scene.add(ambientLight, hemiLight, keyLight);

    const sphereGeometry = new THREE.SphereGeometry(0.42, 24, 18);
    const nodeMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.35,
      metalness: 0.15,
    });

    const initialCapacity = 64;
    const instancedMesh = new THREE.InstancedMesh(sphereGeometry, nodeMaterial, initialCapacity);
    instancedMesh.count = 0;
    instancedMesh.visible = false;
    scene.add(instancedMesh);

    const baseEdgesGeometry = new THREE.BufferGeometry();
    const baseEdgesMaterial = new THREE.LineBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.4,
    });
    const baseEdgesLines = new THREE.LineSegments(baseEdgesGeometry, baseEdgesMaterial);
    baseEdgesLines.visible = false;
    scene.add(baseEdgesLines);

    const highlightEdgesGeometry = new THREE.BufferGeometry();
    const highlightEdgesMaterial = new THREE.LineBasicMaterial({
      color: 0x6366f1,
      transparent: true,
      opacity: 0.95,
    });
    const highlightEdgesLines = new THREE.LineSegments(
      highlightEdgesGeometry,
      highlightEdgesMaterial
    );
    highlightEdgesLines.visible = false;
    highlightEdgesLines.renderOrder = 1;
    scene.add(highlightEdgesLines);

    let rafId: number | null = null;
    const requestRender = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        renderer.render(scene, camera);
      });
    };

    sceneHandlesRef.current = {
      scene,
      camera,
      renderer,
      controls,
      sphereGeometry,
      nodeMaterial,
      instancedMesh,
      instanceCapacity: initialCapacity,
      baseEdgesGeometry,
      baseEdgesLines,
      highlightEdgesGeometry,
      highlightEdgesLines,
      requestRender,
    };

    controls.addEventListener('change', requestRender);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.max(Math.floor(entry.contentRect.width), 1);
      const height = Math.max(Math.floor(entry.contentRect.height), 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      requestRender();
    });
    resizeObserver.observe(container);

    const raycaster = new THREE.Raycaster();
    let pointerDownPos: { x: number; y: number } | null = null;

    const pickInstance = (clientX: number, clientY: number): number | null => {
      const handles = sceneHandlesRef.current;
      if (!handles || !handles.instancedMesh.visible || nodeIdsRef.current.length === 0) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      _pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(_pointerNdc, camera);
      const intersects = raycaster.intersectObject(handles.instancedMesh, false);
      if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
        return intersects[0].instanceId;
      }
      return null;
    };

    const handlePointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const handlePointerMove = (e: PointerEvent) => {
      const instanceId = pickInstance(e.clientX, e.clientY);
      if (instanceId !== null) {
        const node = nodesRef.current[instanceId];
        if (node) {
          const rect = container.getBoundingClientRect();
          canvas.style.cursor = 'pointer';
          const clampedX = Math.max(8, Math.min(e.clientX - rect.left + 12, rect.width - 180));
          const clampedY = Math.max(8, e.clientY - rect.top - 36);
          setHovered({
            id: node.id,
            label: node.label,
            type: node.type,
            x: clampedX,
            y: clampedY,
          });
          return;
        }
      }
      canvas.style.cursor = 'grab';
      setHovered((prev) => (prev !== null ? null : prev));
    };

    const handlePointerLeave = () => {
      canvas.style.cursor = 'grab';
      setHovered(null);
    };

    const handleClick = (e: MouseEvent) => {
      if (pointerDownPos) {
        const dx = e.clientX - pointerDownPos.x;
        const dy = e.clientY - pointerDownPos.y;
        pointerDownPos = null;
        if (dx * dx + dy * dy > 25) {
          return;
        }
      }
      const instanceId = pickInstance(e.clientX, e.clientY);
      if (instanceId !== null) {
        const nodeId = nodeIdsRef.current[instanceId];
        if (nodeId) {
          onSelectNodeRef.current(nodeId);
        }
      }
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    canvas.addEventListener('click', handleClick);

    requestRender();

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
      canvas.removeEventListener('click', handleClick);
      controls.removeEventListener('change', requestRender);
      controls.dispose();

      const handles = sceneHandlesRef.current;
      if (handles) {
        handles.instancedMesh.dispose();
        handles.sphereGeometry.dispose();
        handles.nodeMaterial.dispose();
        handles.baseEdgesGeometry.dispose();
        baseEdgesMaterial.dispose();
        handles.highlightEdgesGeometry.dispose();
        highlightEdgesMaterial.dispose();
      }
      renderer.dispose();
      sceneHandlesRef.current = null;
    };
  }, []);

  // Update instanced nodes and edges when graph data, selection, or colors change
  useEffect(() => {
    const handles = sceneHandlesRef.current;
    if (!handles) return;

    nodesRef.current = nodes;
    nodeIdsRef.current = nodes.map((n) => n.id);

    // Ensure InstancedMesh capacity fits all visible nodes
    if (nodes.length > handles.instanceCapacity) {
      const nextCapacity = Math.max(nodes.length, handles.instanceCapacity * 2);
      handles.scene.remove(handles.instancedMesh);
      handles.instancedMesh.dispose();
      handles.instancedMesh = new THREE.InstancedMesh(
        handles.sphereGeometry,
        handles.nodeMaterial,
        nextCapacity
      );
      handles.instanceCapacity = nextCapacity;
      handles.scene.add(handles.instancedMesh);
    }

    const mesh = handles.instancedMesh;
    mesh.count = nodes.length;
    mesh.visible = nodes.length > 0;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const pos = positions3D.get(node.id) ?? [0, 0, 0];
      const isActive = activeNodeId !== null && node.id === activeNodeId;

      _position.set(pos[0], pos[1], pos[2]);
      _quaternion.identity();
      _scale.setScalar(isActive ? 1.5 : 1.0);
      _matrix.compose(_position, _quaternion, _scale);
      mesh.setMatrixAt(i, _matrix);

      _color.set(nodeColors[node.type] ?? '#6366f1');
      mesh.setColorAt(i, _color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    if (nodes.length > 0) {
      mesh.computeBoundingSphere();
    }

    // Build edge segment buffers, skipping any edge with a missing or filtered endpoint
    const baseCoords: number[] = [];
    const highlightCoords: number[] = [];

    for (const edge of edges) {
      const src = positions3D.get(edge.source);
      const tgt = positions3D.get(edge.target);
      if (!src || !tgt) continue;

      const touchesActive =
        activeNodeId !== null && (edge.source === activeNodeId || edge.target === activeNodeId);

      if (touchesActive) {
        highlightCoords.push(src[0], src[1], src[2], tgt[0], tgt[1], tgt[2]);
      } else {
        baseCoords.push(src[0], src[1], src[2], tgt[0], tgt[1], tgt[2]);
      }
    }

    handles.baseEdgesGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(baseCoords, 3)
    );
    if (baseCoords.length > 0) {
      handles.baseEdgesGeometry.computeBoundingSphere();
    }
    handles.baseEdgesLines.visible = baseCoords.length > 0;

    handles.highlightEdgesGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(highlightCoords, 3)
    );
    if (highlightCoords.length > 0) {
      handles.highlightEdgesGeometry.computeBoundingSphere();
    }
    handles.highlightEdgesLines.visible = highlightCoords.length > 0;

    handles.requestRender();
  }, [nodes, edges, activeNodeId, nodeColors, positions3D]);

  const handleResetView = () => {
    const handles = sceneHandlesRef.current;
    if (!handles) return;
    handles.camera.position.set(...DEFAULT_CAMERA_POS);
    handles.controls.target.set(...DEFAULT_TARGET);
    handles.controls.update();
    handles.requestRender();
  };

  if (webglUnavailable) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center gap-3">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
          WebGL is unavailable in this browser or environment, so the 3D Knowledge Graph cannot be rendered.
        </p>
        {onSwitchTo2D && (
          <button
            type="button"
            onClick={onSwitchTo2D}
            className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"
          >
            Switch back to 2D view
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row w-full h-full min-h-[440px]">
      {/* 3D WebGL Viewport */}
      <div ref={viewportRef} className="relative flex-1 min-h-[320px] overflow-hidden">
        <canvas
          ref={canvasRef}
          className="block w-full h-full outline-none cursor-grab active:cursor-grabbing"
          aria-label={`3D Knowledge Graph visualization (${nodes.length} nodes). Use the adjacent Visible Nodes list (${nodeListId}) to navigate and select nodes with the keyboard.`}
        />

        {/* Reset view control */}
        <div className="absolute top-3 right-3 z-10">
          <button
            type="button"
            onClick={handleResetView}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset view</span>
          </button>
        </div>

        {/* Empty graph message */}
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-500">
            No graph nodes match the current filter.
          </div>
        )}

        {/* Hover tooltip */}
        {hovered && (
          <div
            role="status"
            aria-live="polite"
            style={{
              left: hovered.x,
              top: hovered.y,
            }}
            className="pointer-events-none absolute z-20 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm text-xs"
          >
            <div className="font-semibold text-slate-900 dark:text-white">{hovered.label}</div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {hovered.type}
            </div>
          </div>
        )}
      </div>

      {/* Accessible scrollable node list */}
      <aside
        aria-label="Visible graph nodes"
        className="w-full md:w-64 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex flex-col max-h-48 md:max-h-none"
      >
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 shrink-0">
          Visible Nodes ({nodes.length})
        </div>
        <ul id={nodeListId} className="flex-1 overflow-y-auto divide-y divide-slate-200/70 dark:divide-slate-800/70">
          {nodes.length === 0 ? (
            <li className="px-3 py-4 text-xs text-slate-500 text-center">No visible nodes.</li>
          ) : (
            nodes.map((node) => {
              const isActive = activeNodeId === node.id;
              const dotColor = nodeColors[node.type] ?? '#6366f1';
              return (
                <li key={node.id}>
                  <button
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onSelectNode(node.id)}
                    className={`w-full px-3 py-2 text-left flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                      isActive
                        ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: dotColor }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium truncate">{node.label}</span>
                      <span className="block text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        {node.type}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </aside>
    </div>
  );
}
