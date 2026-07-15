// The Collision Master modeling toolbar: a floating bar over the 3D stage
// (visible only during a Collision Master session) with the Blender-style
// select modes (Object / Vertex / Edge / Face), primitive starters, the
// poly-snap brush toggle, and Duplicate / Delete. Pure DOM chrome: every
// action routes through the injected deps; the app owns all state.

import { t } from '../ui/i18n';
import { el } from './dom';

export type CmSelectMode = 'object' | 'vertex' | 'edge' | 'face';
export type CmPrimitive = 'box' | 'plane' | 'cylinder' | 'sphere' | 'wedge';

export interface CollisionMasterBarDeps {
  getMode(): CmSelectMode;
  setMode(mode: CmSelectMode): void;
  addPrimitive(kind: CmPrimitive): void;
  duplicateSelection(): void;
  deleteSelection(): void;
  getPolySnap(): boolean;
  setPolySnap(on: boolean): void;
}

const MODES: { key: CmSelectMode; labelKey: string; titleKey: string }[] = [
  {
    key: 'object',
    labelKey: 'editor.collisionMaster.modeObject',
    titleKey: 'editor.collisionMaster.modeObjectTitle',
  },
  {
    key: 'vertex',
    labelKey: 'editor.collisionMaster.modeVertex',
    titleKey: 'editor.collisionMaster.modeVertexTitle',
  },
  {
    key: 'edge',
    labelKey: 'editor.collisionMaster.modeEdge',
    titleKey: 'editor.collisionMaster.modeEdgeTitle',
  },
  {
    key: 'face',
    labelKey: 'editor.collisionMaster.modeFace',
    titleKey: 'editor.collisionMaster.modeFaceTitle',
  },
];

const PRIMS: { key: CmPrimitive; labelKey: string }[] = [
  { key: 'box', labelKey: 'editor.collisionMaster.primBox' },
  { key: 'plane', labelKey: 'editor.collisionMaster.primPlane' },
  { key: 'cylinder', labelKey: 'editor.collisionMaster.primCylinder' },
  { key: 'sphere', labelKey: 'editor.collisionMaster.primSphere' },
  { key: 'wedge', labelKey: 'editor.collisionMaster.primWedge' },
];

export class CollisionMasterBar {
  readonly root: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly deps: CollisionMasterBarDeps,
  ) {
    this.root = el('div', 'ed-cm-bar');
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', t('editor.collisionMaster.barLabel'));
    this.root.style.display = 'none';
    parent.appendChild(this.root);
    this.render();
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
    if (on) this.render();
  }

  refresh(): void {
    if (this.root.style.display !== 'none') this.render();
  }

  private btn(label: string, title: string, active: boolean, onClick: () => void): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = active ? 'ed-cm-btn active' : 'ed-cm-btn';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    if (active) b.setAttribute('aria-pressed', 'true');
    b.addEventListener('click', () => {
      onClick();
      this.render();
    });
    return b;
  }

  private sep(): HTMLElement {
    return el('span', 'ed-cm-sep');
  }

  private render(): void {
    const d = this.deps;
    this.root.innerHTML = '';
    const mode = d.getMode();
    for (const m of MODES) {
      this.root.appendChild(
        this.btn(
          t(m.labelKey as Parameters<typeof t>[0]),
          t(m.titleKey as Parameters<typeof t>[0]),
          mode === m.key,
          () => d.setMode(m.key),
        ),
      );
    }
    this.root.appendChild(this.sep());
    for (const pr of PRIMS) {
      this.root.appendChild(
        this.btn(
          t(pr.labelKey as Parameters<typeof t>[0]),
          t('editor.collisionMaster.primTitle', {
            name: t(pr.labelKey as Parameters<typeof t>[0]),
          }),
          false,
          () => d.addPrimitive(pr.key),
        ),
      );
    }
    this.root.appendChild(this.sep());
    this.root.appendChild(
      this.btn(
        t('editor.collisionMaster.polySnapShort'),
        t('editor.collisionMaster.polySnapHint'),
        d.getPolySnap(),
        () => d.setPolySnap(!d.getPolySnap()),
      ),
    );
    this.root.appendChild(
      this.btn(
        t('editor.collisionMaster.duplicate'),
        t('editor.collisionMaster.duplicateTitle'),
        false,
        () => d.duplicateSelection(),
      ),
    );
    this.root.appendChild(
      this.btn(
        t('editor.collisionMaster.delete'),
        t('editor.collisionMaster.deleteTitle'),
        false,
        () => d.deleteSelection(),
      ),
    );
  }
}
