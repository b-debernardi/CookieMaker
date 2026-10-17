// 3D scene: the printer bed, the generated parts and problem highlights.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshOut } from '../geometry/protocol';

const PART_COLORS = [0xe3a96b, 0x8fb8de];
const MODIFIER_COLOR = 0xa970ff;

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private content = new THREE.Group();
  private bed = new THREE.Group();
  private bedSize = 0;
  private showEdges = true;
  private dark = false;
  private needsRender = true;
  /** Camera move in progress: a critically damped spring, interruptible. */
  private anim: { pos: THREE.Vector3; target: THREE.Vector3; vp: THREE.Vector3; vt: THREE.Vector3 } | null = null;
  private last = performance.now();
  /** Screen space covered by floating panels on the left and right, in px. */
  private insets = { left: 0, right: 0 };
  private modMeshes: THREE.Mesh[] = [];
  private ray = new THREE.Raycaster();
  private drag: { mesh: THREE.Mesh; plane: THREE.Plane; start: THREE.Vector3 } | null = null;
  /** Called when a modifier zone is dropped: index and move in design mm. */
  onModifierMove: (index: number, dx: number, dy: number) => void = () => {};

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.appendChild(this.renderer.domElement);

    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(90, -170, 150);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 0, 8);
    this.controls.addEventListener('change', () => (this.needsRender = true));
    // Grabbing the view stops any camera move right where it is.
    this.controls.addEventListener('start', () => (this.anim = null));

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f74, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(120, -160, 260);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(-200, 150, 80);
    this.scene.add(rim);
    this.scene.add(this.bed, this.content);

    // Modifier zones can be dragged on the plate. Listen on the host in the
    // capture phase so the camera controls never see a drag that is ours.
    host.addEventListener('pointerdown', (e) => this.onDown(e), true);
    host.addEventListener('pointermove', (e) => this.onMove(e), true);
    host.addEventListener('pointerup', (e) => this.onUp(e), true);
    host.addEventListener('pointercancel', (e) => this.onUp(e), true);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (this.anim) this.stepAnim(dt);
      if (this.controls.update() || this.needsRender) {
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
      }
    };
    loop();
  }

  private stepAnim(dt: number) {
    // Critically damped spring (damping 1.0, response 0.4 s).
    const a = this.anim!;
    const omega = (2 * Math.PI) / 0.4;
    const step = (x: THREE.Vector3, goal: THREE.Vector3, v: THREE.Vector3) => {
      const disp = x.clone().sub(goal);
      const acc = disp.multiplyScalar(-omega * omega).addScaledVector(v, -2 * omega);
      v.addScaledVector(acc, dt);
      x.addScaledVector(v, dt);
    };
    step(this.camera.position, a.pos, a.vp);
    step(this.controls.target, a.target, a.vt);
    this.needsRender = true;
    if (this.camera.position.distanceTo(a.pos) < 0.05 && this.controls.target.distanceTo(a.target) < 0.05 && a.vp.length() < 0.5) {
      this.camera.position.copy(a.pos);
      this.controls.target.copy(a.target);
      this.anim = null;
    }
  }

  private moveTo(pos: THREE.Vector3, target: THREE.Vector3) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.anim = null;
      this.needsRender = true;
      return;
    }
    // Start from the live position and keep the current velocity.
    this.anim = {
      pos,
      target,
      vp: this.anim?.vp ?? new THREE.Vector3(),
      vt: this.anim?.vt ?? new THREE.Vector3(),
    };
  }

  private pick(e: PointerEvent): THREE.Intersection | null {
    if (!this.modMeshes.length) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    return this.ray.intersectObjects(this.modMeshes, false)[0] ?? null;
  }

  private planePoint(e: PointerEvent, plane: THREE.Plane): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    return this.ray.ray.intersectPlane(plane, new THREE.Vector3());
  }

  private onDown(e: PointerEvent) {
    if (e.button !== 0 || e.target !== this.renderer.domElement) return;
    const hit = this.pick(e);
    if (!hit) return;
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -hit.point.z);
    this.drag = { mesh: hit.object as THREE.Mesh, plane, start: hit.point.clone() };
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
    e.stopPropagation();
  }

  private onMove(e: PointerEvent) {
    if (!this.drag) {
      this.renderer.domElement.style.cursor = e.buttons === 0 && this.pick(e) ? 'grab' : '';
      return;
    }
    const p = this.planePoint(e, this.drag.plane);
    if (!p) return;
    const d = p.sub(this.drag.start);
    // Move every copy of this zone (one per piece) together.
    const index = this.drag.mesh.userData.mod;
    for (const m of this.modMeshes) {
      if (m.userData.mod !== index) continue;
      const sign = m.userData.mirrored === this.drag.mesh.userData.mirrored ? 1 : -1;
      m.position.set(d.x * sign, d.y, 0);
    }
    this.needsRender = true;
    e.stopPropagation();
  }

  private onUp(e: PointerEvent) {
    if (!this.drag) return;
    const { mesh } = this.drag;
    this.drag = null;
    this.controls.enabled = true;
    this.renderer.domElement.style.cursor = '';
    const dx = mesh.position.x, dy = mesh.position.y;
    if (Math.hypot(dx, dy) > 0.01) {
      this.onModifierMove(mesh.userData.mod, mesh.userData.mirrored ? -dx : dx, dy);
    }
    e.stopPropagation();
  }

  setInsets(left: number, right: number) {
    if (left === this.insets.left && right === this.insets.right) return;
    this.insets = { left, right };
    this.resize();
  }

  setTheme(dark: boolean) {
    this.dark = dark;
    this.buildBed(this.bedSize || 256, true);
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Centre the projection in the area not covered by panels.
    const dx = (this.insets.left - this.insets.right) / 2;
    if (dx) this.camera.setViewOffset(w, h, -dx, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  buildBed(size: number, force = false) {
    if (size === this.bedSize && !force) return;
    this.bedSize = size;
    this.bed.clear();
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({
        color: this.dark ? 0x2a2a2e : 0xf2f0ed,
        roughness: 0.95,
        transparent: true,
        opacity: 0.9,
      }),
    );
    plate.position.z = -0.05;
    this.bed.add(plate);
    const lines: number[] = [];
    const half = size / 2;
    for (let v = -half; v <= half + 1e-6; v += 10) {
      lines.push(v, -half, 0, v, half, 0, -half, v, 0, half, v, 0);
    }
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)),
      new THREE.LineBasicMaterial({ color: this.dark ? 0x3d3d42 : 0xdcd8d2 }),
    );
    this.bed.add(grid);
    this.needsRender = true;
  }

  setEdges(on: boolean) {
    this.showEdges = on;
    this.content.traverse((o) => {
      if (o.userData.edges) o.visible = on;
    });
    this.needsRender = true;
  }

  setMeshes(meshes: MeshOut[]) {
    for (const c of this.content.children) {
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
    }
    this.content.clear();
    this.modMeshes = [];
    this.drag = null;
    this.controls.enabled = true;
    let part = 0;
    for (const m of meshes) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
      const flat = geo.toNonIndexed();
      flat.computeVertexNormals();
      geo.dispose();
      if (m.role === 'modifier') {
        const mesh = new THREE.Mesh(
          flat,
          new THREE.MeshBasicMaterial({ color: MODIFIER_COLOR, transparent: true, opacity: 0.22, depthWrite: false }),
        );
        mesh.renderOrder = 5;
        mesh.userData = { mod: m.mod, mirrored: m.mirrored };
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(flat, 35),
          new THREE.LineBasicMaterial({ color: MODIFIER_COLOR, transparent: true, opacity: 0.8 }),
        );
        mesh.add(edges);
        this.modMeshes.push(mesh);
        this.content.add(mesh);
        continue;
      }
      if (m.role === 'issue') {
        const mesh = new THREE.Mesh(
          flat,
          new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.9, depthTest: false }),
        );
        mesh.renderOrder = 10;
        this.content.add(mesh);
        continue;
      }
      const color = PART_COLORS[part++ % PART_COLORS.length];
      const mesh = new THREE.Mesh(
        flat,
        new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.0, flatShading: false }),
      );
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(flat, 35),
        new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }),
      );
      edges.userData.edges = true;
      edges.visible = this.showEdges;
      mesh.add(edges);
      this.content.add(mesh);
    }
    this.needsRender = true;
  }

  /** Frames the current content, keeping the viewing direction. */
  frame() {
    const box = new THREE.Box3().setFromObject(this.content);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const w = this.host.clientWidth || 1;
    const free = Math.max(0.3, (w - this.insets.left - this.insets.right) / w);
    const fit = Math.min(this.camera.aspect * free, 1);
    const dist = (r / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / fit) * 0.9;
    this.moveTo(c.clone().addScaledVector(dir, dist), c);
  }

  view(kind: 'top' | 'iso' | 'bottom') {
    const t = this.anim?.target ?? this.controls.target;
    const d = (this.anim?.pos ?? this.camera.position).distanceTo(t);
    const dir =
      kind === 'top' ? new THREE.Vector3(0, -0.001, 1) :
      kind === 'bottom' ? new THREE.Vector3(0, -0.001, -1) :
      new THREE.Vector3(0.45, -0.85, 0.75);
    this.moveTo(t.clone().addScaledVector(dir.normalize(), d), t.clone());
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}
