// The Armory: interactive armour-variant picker.
// Loads manifest.json (characters, pieces, per-piece variant atlases), renders
// the character in three.js, and swaps per-piece baseColor maps live. Geometry
// is never touched, so fit and dimensions are exact by construction.
import { THREE, OrbitControls, GLTFLoader, MeshoptDecoder } from './three.bundle.js';

const manifest = await (await fetch('./manifest.json')).json();
const THEME_LABELS = {
  base: 'Base',
  obsidian: 'Obsidian Ember',
  frost: 'Frostforged',
  gilded: 'Royal Gilded',
  verdant: 'Verdant Grove',
  none: 'Unequipped',
  plate: 'Base Plate',
  dragonscale: 'Dragonscale',
  bonewrought: 'Bonewrought',
  stormcrystal: 'Stormcrystal',
};
// Warrior plate piece node per set slot (hidden when a forged set occupies it).
const PLATE_BY_SLOT = {
  Helm: 'Armor_Helm',
  Shoulders: 'Armor_Shoulders',
  Torso: 'Armor_Torso',
  Arms: 'Armor_Arms',
  Legs: 'Armor_Legs',
};

// --- three.js stage -------------------------------------------------------
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0c0a08, 9, 22);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 100);

const hemi = new THREE.HemisphereLight(0xfff2dc, 0x2a2018, 1.1);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffe9c4, 2.2);
key.position.set(2.4, 3.4, 2.6);
scene.add(key);
const rim = new THREE.DirectionalLight(0x9db8ff, 0.9);
rim.position.set(-2.6, 2.2, -2.4);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(2.6, 64),
  new THREE.MeshStandardMaterial({ color: 0x1c1610, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const ring = new THREE.Mesh(
  new THREE.RingGeometry(2.45, 2.6, 64),
  new THREE.MeshBasicMaterial({ color: 0xc9a35c, transparent: true, opacity: 0.28 }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.002;
scene.add(ring);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.2;
controls.maxDistance = 9;
controls.maxPolarAngle = Math.PI * 0.55;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();

// --- state ----------------------------------------------------------------
const statusEl = document.getElementById('status');
const loadingEl = document.getElementById('loading');
const rosterEl = document.getElementById('roster');
const piecesEl = document.getElementById('pieces');
const setrowEl = document.getElementById('setrow');
const animSel = document.getElementById('anim');

const gltfCache = new Map(); // char -> Promise<GLTF>
const texCache = new Map(); // url -> Promise<Texture>
const setCache = new Map(); // set key -> Promise<GLTF>
let current = null; // { char, root, mixer, action, pieceNodes, baseMaps, selection, setMeshes, setSelection }
let clock = new THREE.Clock();

function loadSet(key) {
  if (!setCache.has(key)) {
    setCache.set(
      key,
      new Promise((resolve, reject) =>
        loader.load(manifest.sets[key].glb, resolve, undefined, reject),
      ),
    );
  }
  return setCache.get(key);
}

const tuckedCache = new Map(); // char -> Promise<GLTF>
function loadTucked(char, url) {
  if (!tuckedCache.has(char)) {
    tuckedCache.set(
      char,
      new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject)),
    );
  }
  return tuckedCache.get(char);
}

// --- held weapons + wing cosmetics -----------------------------------------
// Grip math mirrors the game's variantGripTransform: Y lift per family, a
// shrink-only clamp against the family max height, and the right-hand
// 180-degree flip. Attached to the handslot.r bone with the bone's world
// scale compensated (the mixamorig rigs carry non-unit bone scale).
const FAMILY_GRIPS = {
  sword: { lift: 0.04, maxHeight: 2.0 },
  dagger: { lift: 0.04, maxHeight: 1.4 },
  axe: { lift: 0.04, maxHeight: 1.5 },
  staff: { lift: 0.18, maxHeight: 2.4 },
  wand: { lift: 0.04, maxHeight: 1.2 },
};
const gltfUrlCache = new Map(); // url -> Promise<GLTF>
function loadGltfUrl(url) {
  if (!gltfUrlCache.has(url)) {
    gltfUrlCache.set(
      url,
      new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject)),
    );
  }
  return gltfUrlCache.get(url);
}
function findBoneNorm(root, wanted) {
  let hit = null;
  root.traverse((o) => {
    if (hit) return;
    const n = o.name.replace(/[[\].:/]/g, '').toLowerCase();
    if (wanted.includes(n)) hit = o;
  });
  return hit;
}
async function applyWeaponChoice(key) {
  current.weaponMesh?.removeFromParent();
  current.weaponMesh = null;
  if (key === 'none' || !manifest.weapons?.[key]) return;
  const def = manifest.weapons[key];
  const gltf = await loadGltfUrl(def.glb);
  const scene = gltf.scene.clone(true);
  const slot = findBoneNorm(current.root, ['handslotr']);
  if (!slot) return;
  const grip = FAMILY_GRIPS[def.family] ?? FAMILY_GRIPS.sword;
  const box = new THREE.Box3().setFromObject(scene);
  const h = box.max.y - box.min.y;
  const clampScale = h > 1e-3 ? Math.min(1, grip.maxHeight / h) : 1;
  const ws = new THREE.Vector3();
  slot.getWorldScale(ws);
  const inv = 1 / Math.max(1e-6, ws.y);
  scene.position.set(0, grip.lift * inv, 0);
  scene.quaternion.set(0, 1, 0, 0);
  scene.scale.setScalar(clampScale * inv);
  scene.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
  });
  slot.add(scene);
  current.weaponMesh = scene;
}
async function applyWingChoice(key) {
  current.wingMesh?.removeFromParent();
  current.wingMesh = null;
  if (key === 'none' || !manifest.wings?.[key]) return;
  const def = manifest.wings[key];
  const gltf = await loadGltfUrl(def.glb);
  const scene = gltf.scene.clone(true);
  // kaykit rigs mount on the chest bone; the mixamorig family's equivalent
  // is Spine2. Offsets are bone-local, so compensate the bone world scale.
  const bone = findBoneNorm(current.root, ['chest', 'mixamorigspine2']);
  if (!bone) return;
  const ws = new THREE.Vector3();
  bone.getWorldScale(ws);
  const inv = 1 / Math.max(1e-6, ws.y);
  scene.position.set(def.pos[0] * inv, def.pos[1] * inv, def.pos[2] * inv);
  scene.rotation.y = Math.PI;
  scene.scale.setScalar(def.scale * inv);
  scene.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
  });
  bone.add(scene);
  current.wingMesh = scene;
}

const headCache = new Map(); // head key -> Promise<GLTF>
function loadHead(key) {
  if (!headCache.has(key)) {
    headCache.set(
      key,
      new Promise((resolve, reject) =>
        loader.load(manifest.heads[key].glb, resolve, undefined, reject),
      ),
    );
  }
  return headCache.get(key);
}

/** Reconcile the head: the base Head/Head_Hair show only when no forged helm
 *  is on AND the base head is chosen; an alternative head mesh is attached by
 *  bone name (like set pieces) and follows the same helm rule. */
async function refreshHead(helmKeyOverride) {
  const headChoice = current.headChoice ?? 'base';
  const helmKey =
    helmKeyOverride ?? current.setSelection?.Helm ?? defaultSetChoice(current.char, 'Helm');
  const helmOn = helmKey !== 'none' && helmKey !== 'plate';
  current.root.traverse((o) => {
    if (o.isMesh && (o.name === 'Head' || o.name === 'Head_Hair')) {
      o.visible = !helmOn && headChoice === 'base';
    }
  });
  for (const prev of current.altHeadMeshes ?? []) prev.removeFromParent();
  current.altHeadMeshes = [];
  if (headChoice === 'base' || helmOn || !manifest.heads?.[headChoice]) return;
  const gltf = await loadHead(headChoice);
  const boneByName = new Map();
  current.root.traverse((o) => {
    if (o.isBone) boneByName.set(o.name, o);
  });
  gltf.scene.traverse((src) => {
    if (!src.isSkinnedMesh || !src.name.startsWith('Set_Head')) return;
    const bones = src.skeleton.bones.map((b) => boneByName.get(b.name));
    if (bones.some((b) => !b)) return;
    const mesh = new THREE.SkinnedMesh(src.geometry, src.material);
    mesh.name = 'Equipped_Head';
    mesh.frustumCulled = false;
    mesh.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses), new THREE.Matrix4());
    current.root.add(mesh);
    current.altHeadMeshes.push(mesh);
  });
}

/** Attach one forged-set slot mesh to the current character's skeleton: bones
 *  are matched by joint NAME (all mixamorig characters share the naming), the
 *  set keeps its own inverse bind matrices, so fit is identical on each body. */
async function equipSetPiece(slot, setKey) {
  for (const prev of current.setMeshes[slot] ?? []) prev.removeFromParent();
  current.setMeshes[slot] = [];
  const plateNode = current.pieceNodes[PLATE_BY_SLOT[slot]];
  const bare = setKey === 'none' || setKey === 'plate';
  const findBody = (name) => {
    let hit = null;
    current.root.traverse((o) => {
      if (o.isMesh && o.name === name) hit = o;
    });
    return hit;
  };
  // A forged helmet removes the head (base or alternative) beneath it, and
  // forged pauldrons hide the body's own shoulder pads (the classic MMO
  // rule); the base plate was authored around them, so it keeps them.
  if (slot === 'Helm') {
    await refreshHead(setKey);
  }
  if (slot === 'Shoulders') {
    const pads = findBody('Shoulders');
    if (pads) pads.visible = bare;
  }
  // A forged breastplate swaps the body torso, and forged gauntlets swap the
  // body arms, for their radially tucked variants so garments and bracer
  // wraps do not bulge out of the shells. Geometry swap only: the mesh keeps
  // its material, so texture variants stay applied.
  const TUCK_BY_SLOT = { Torso: 'Torso', Arms: 'Arms', Legs: 'Legs' };
  if (TUCK_BY_SLOT[slot]) {
    const bodyMesh = findBody(TUCK_BY_SLOT[slot]);
    if (bodyMesh) {
      if (!bodyMesh.userData.baseGeometry) bodyMesh.userData.baseGeometry = bodyMesh.geometry;
      if (bare) {
        bodyMesh.geometry = bodyMesh.userData.baseGeometry;
      } else {
        const def2 = manifest.chars[current.char];
        if (def2.tucked) {
          const gltf2 = await loadTucked(current.char, def2.tucked);
          let tucked = null;
          gltf2.scene.traverse((o) => {
            if (o.isMesh && o.name === TUCK_BY_SLOT[slot]) tucked = o;
          });
          if (tucked) bodyMesh.geometry = tucked.geometry;
        }
      }
    }
  }
  if (setKey === 'none' || setKey === 'plate') {
    if (plateNode) plateNode.visible = setKey === 'plate';
    return;
  }
  if (plateNode) plateNode.visible = false;
  const gltf = await loadSet(setKey);
  const srcs = [];
  gltf.scene.traverse((o) => {
    // Multi-primitive slots load as Set_<slot>_0, _1, ... under a group.
    if (o.isSkinnedMesh && (o.name === `Set_${slot}` || o.name.startsWith(`Set_${slot}_`))) {
      srcs.push(o);
    }
  });
  const boneByName = new Map();
  current.root.traverse((o) => {
    if (o.isBone) boneByName.set(o.name, o);
  });
  for (const src of srcs) {
    const bones = src.skeleton.bones.map((b) => boneByName.get(b.name));
    if (bones.some((b) => !b)) {
      console.warn(`set ${setKey} ${slot}: missing bones on ${current.char}`);
      return;
    }
    const mesh = new THREE.SkinnedMesh(src.geometry, src.material);
    mesh.name = `Equipped_${slot}`;
    mesh.frustumCulled = false;
    mesh.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses), new THREE.Matrix4());
    current.root.add(mesh);
    current.setMeshes[slot].push(mesh);
  }
}

function loadTexture(url) {
  if (!texCache.has(url)) {
    texCache.set(
      url,
      new Promise((resolve, reject) => {
        texLoader.load(
          url,
          (tex) => {
            tex.flipY = false;
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            resolve(tex);
          },
          undefined,
          reject,
        );
      }),
    );
  }
  return texCache.get(url);
}

function loadGltf(char) {
  if (!gltfCache.has(char)) {
    gltfCache.set(
      char,
      new Promise((resolve, reject) =>
        loader.load(manifest.chars[char].glb, resolve, undefined, reject),
      ),
    );
  }
  return gltfCache.get(char);
}

function frameCamera(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const h = Math.max(size.y, 0.5);
  controls.target.set(center.x, center.y * 0.95, center.z);
  camera.position.set(center.x + h * 1.15, center.y + h * 0.42, center.z + h * 2.05);
  camera.near = h / 50;
  camera.far = h * 60;
  camera.updateProjectionMatrix();
  controls.update();
}

async function showCharacter(char) {
  loadingEl.classList.remove('hidden');
  const def = manifest.chars[char];
  const gltf = await loadGltf(char);
  if (current?.root) scene.remove(current.root);

  // A fresh SkeletonUtils-free reuse: the cached scene is used directly (one
  // character on stage at a time), materials cloned per piece on first use.
  const root = gltf.scene;
  scene.add(root);

  const pieceNodes = {};
  const baseMaps = {};
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    if (def.pieces[o.name]) {
      if (!o.userData.matCloned) {
        o.material = o.material.clone();
        o.userData.matCloned = true;
      }
      pieceNodes[o.name] = o;
      baseMaps[o.name] = o.userData.baseMap ?? o.material.map;
      o.userData.baseMap = baseMaps[o.name];
    }
  });

  const mixer = new THREE.AnimationMixer(root);
  current = {
    char,
    root,
    gltf,
    mixer,
    action: null,
    pieceNodes,
    baseMaps,
    setMeshes: {},
    altHeadMeshes: [],
    selection: current?.charSelections?.[char] ?? {},
    setSelection: current?.charSetSelections?.[char] ?? {},
    headChoice: current?.charHeadChoices?.[char] ?? 'base',
    weaponChoice: current?.charWeaponChoices?.[char] ?? 'none',
    wingChoice: current?.charWingChoices?.[char] ?? 'none',
    charSelections: current?.charSelections ?? {},
    charSetSelections: current?.charSetSelections ?? {},
    charHeadChoices: current?.charHeadChoices ?? {},
    charWeaponChoices: current?.charWeaponChoices ?? {},
    charWingChoices: current?.charWingChoices ?? {},
  };
  current.charSelections[char] = current.selection;
  current.charSetSelections[char] = current.setSelection;
  current.charHeadChoices[char] = current.headChoice;
  current.charWeaponChoices[char] = current.weaponChoice;
  current.charWingChoices[char] = current.wingChoice;

  buildAnimList(gltf);
  playClip(animSel.value || 'Idle');
  buildPieceRows(char);
  // Re-apply remembered selections for this character.
  for (const [piece, variant] of Object.entries(current.selection)) {
    await applyVariant(piece, variant, { skipRemember: true });
  }
  if (def.sets) {
    for (const [slot, setKey] of Object.entries(current.setSelection)) {
      if (setKey && setKey !== defaultSetChoice(char, slot)) {
        await applySetChoice(slot, setKey, { skipRemember: true });
      }
    }
    await refreshHead();
  }
  await applyWeaponChoice(current.weaponChoice);
  await applyWingChoice(current.wingChoice);
  frameCamera(root);
  statusEl.innerHTML = `<b>${def.label}</b> &middot; ${Object.keys(def.pieces).length} armour pieces &middot; drag to orbit, scroll to zoom`;
  loadingEl.classList.add('hidden');
}

function buildAnimList(gltf) {
  const prev = animSel.value;
  animSel.innerHTML = '';
  for (const clip of gltf.animations) {
    const opt = document.createElement('option');
    opt.value = clip.name;
    opt.textContent = clip.name.replace(/_/g, ' ');
    animSel.appendChild(opt);
  }
  const names = gltf.animations.map((c) => c.name);
  animSel.value = names.includes(prev) ? prev : names.includes('Idle') ? 'Idle' : names[0];
}

function playClip(name) {
  if (!current) return;
  const clip = current.gltf.animations.find((c) => c.name === name);
  if (!clip) return;
  const action = current.mixer.clipAction(clip);
  if (current.action && current.action !== action) {
    current.action.fadeOut(0.18);
  }
  action.reset().fadeIn(0.18).play();
  current.action = action;
}

animSel.addEventListener('change', () => playClip(animSel.value));

async function applyVariant(piece, variant, { skipRemember } = {}) {
  const node = current?.pieceNodes[piece];
  if (!node) return;
  const def = manifest.chars[current.char].pieces[piece];
  if (variant === 'none') {
    node.visible = false;
  } else {
    node.visible = true;
    if (variant === 'base') {
      node.material.map = current.baseMaps[piece];
    } else {
      const url = def.variants[variant];
      if (!url) return;
      node.material.map = await loadTexture(url);
    }
    node.material.needsUpdate = true;
  }
  if (!skipRemember) current.selection[piece] = variant;
  markSelected(piece, variant);
}

function markSelected(piece, variant) {
  const row = piecesEl.querySelector(`[data-piece="${piece}"]`);
  if (!row) return;
  for (const chip of row.querySelectorAll('.chip')) {
    chip.classList.toggle('selected', chip.dataset.variant === variant);
  }
  row.querySelector('.variant-tag').textContent = THEME_LABELS[variant] ?? variant;
}

function chipEl(piece, variant) {
  const chip = document.createElement('button');
  chip.className = `chip ${variant}`;
  chip.dataset.variant = variant;
  chip.title = THEME_LABELS[variant] ?? variant;
  chip.setAttribute('aria-label', `${piece}: ${THEME_LABELS[variant] ?? variant}`);
  chip.addEventListener('click', () => applyVariant(piece, variant));
  return chip;
}

function defaultSetChoice(char, slot) {
  // The warrior spawns wearing its plate; other characters start bare.
  return char === 'warrior' ? 'plate' : 'none';
}

async function applySetChoice(slot, setKey, { skipRemember } = {}) {
  await equipSetPiece(slot, setKey);
  if (!skipRemember) current.setSelection[slot] = setKey;
  const row = piecesEl.querySelector(`[data-setslot="${slot}"]`);
  if (row) {
    for (const chip of row.querySelectorAll('.chip')) {
      chip.classList.toggle('selected', chip.dataset.variant === setKey);
    }
    row.querySelector('.variant-tag').textContent = THEME_LABELS[setKey] ?? setKey;
  }
}

function setChipEl(slot, setKey) {
  const chip = document.createElement('button');
  chip.className = `chip ${setKey}`;
  chip.dataset.variant = setKey;
  chip.title = THEME_LABELS[setKey] ?? setKey;
  chip.setAttribute('aria-label', `${slot}: ${THEME_LABELS[setKey] ?? setKey}`);
  chip.addEventListener('click', () => applySetChoice(slot, setKey));
  return chip;
}

function buildPieceRows(char) {
  piecesEl.innerHTML = '';
  const def = manifest.chars[char];
  for (const [piece, meta] of Object.entries(def.pieces)) {
    const row = document.createElement('div');
    row.className = 'piece-row';
    row.dataset.piece = piece;
    const name = document.createElement('div');
    name.className = 'piece-name';
    name.innerHTML = `<span>${meta.label}</span><span class="variant-tag">Base</span>`;
    row.appendChild(name);
    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.appendChild(chipEl(piece, 'base'));
    for (const theme of manifest.themes) {
      if (meta.variants[theme]) chips.appendChild(chipEl(piece, theme));
    }
    if (meta.removable) chips.appendChild(chipEl(piece, 'none'));
    row.appendChild(chips);
    piecesEl.appendChild(row);
    const sel = current?.selection?.[piece] ?? 'base';
    markSelected(piece, sel);
  }
  if (def.sets && Object.keys(manifest.sets ?? {}).length) {
    const head = document.createElement('div');
    head.className = 'piece-row';
    head.innerHTML =
      '<div class="piece-name"><span style="color: var(--gold)">FORGED SETS</span>' +
      '<span class="variant-tag">new-model armour</span></div>';
    piecesEl.appendChild(head);
    if (Object.keys(manifest.heads ?? {}).length) {
      const row = document.createElement('div');
      row.className = 'piece-row';
      row.dataset.headrow = '1';
      const initial = current?.headChoice ?? 'base';
      row.innerHTML = `<div class="piece-name"><span>Head</span><span class="variant-tag">${
        initial === 'base' ? 'Base' : (manifest.heads[initial]?.label ?? initial)
      }</span></div>`;
      const chips = document.createElement('div');
      chips.className = 'chips';
      const mkHeadChip = (key, label) => {
        const chip = document.createElement('button');
        chip.className = `chip ${key === 'base' ? 'base' : `head-${key}`}`;
        chip.dataset.variant = key;
        chip.title = label;
        chip.setAttribute('aria-label', `Head: ${label}`);
        chip.addEventListener('click', async () => {
          current.headChoice = key;
          current.charHeadChoices[current.char] = key;
          await refreshHead();
          for (const c2 of chips.querySelectorAll('.chip')) {
            c2.classList.toggle('selected', c2.dataset.variant === key);
          }
          row.querySelector('.variant-tag').textContent = label;
        });
        return chip;
      };
      chips.appendChild(mkHeadChip('base', 'Base'));
      for (const [key, hdef] of Object.entries(manifest.heads)) {
        chips.appendChild(mkHeadChip(key, hdef.label));
      }
      row.appendChild(chips);
      piecesEl.appendChild(row);
      for (const c2 of chips.querySelectorAll('.chip')) {
        c2.classList.toggle('selected', c2.dataset.variant === initial);
      }
    }
    for (const [slot, label] of Object.entries(manifest.setSlots)) {
      const row = document.createElement('div');
      row.className = 'piece-row';
      row.dataset.setslot = slot;
      const name = document.createElement('div');
      name.className = 'piece-name';
      const initial = current?.setSelection?.[slot] ?? defaultSetChoice(char, slot);
      name.innerHTML = `<span>${label}</span><span class="variant-tag">${THEME_LABELS[initial]}</span>`;
      row.appendChild(name);
      const chips = document.createElement('div');
      chips.className = 'chips';
      chips.appendChild(setChipEl(slot, 'none'));
      if (char === 'warrior') chips.appendChild(setChipEl(slot, 'plate'));
      for (const setKey of Object.keys(manifest.sets)) chips.appendChild(setChipEl(slot, setKey));
      row.appendChild(chips);
      piecesEl.appendChild(row);
      for (const chip of chips.querySelectorAll('.chip')) {
        chip.classList.toggle('selected', chip.dataset.variant === initial);
      }
    }
  }
  // Held weapon (dropdown) and wing cosmetics (chips), available on every
  // character (all five carry handslot.r and a chest/Spine2 bone).
  if (Object.keys(manifest.weapons ?? {}).length) {
    const row = document.createElement('div');
    row.className = 'piece-row';
    row.innerHTML =
      '<div class="piece-name"><span style="color: var(--gold)">LOADOUT</span>' +
      '<span class="variant-tag">weapons and wings</span></div>';
    piecesEl.appendChild(row);
    const wrow = document.createElement('div');
    wrow.className = 'piece-row';
    wrow.innerHTML = '<div class="piece-name"><span>Weapon</span></div>';
    const sel = document.createElement('select');
    sel.className = 'rowselect';
    sel.appendChild(new Option('None', 'none'));
    for (const [key, wdef] of Object.entries(manifest.weapons)) {
      sel.appendChild(new Option(wdef.label, key));
    }
    sel.value = current?.weaponChoice ?? 'none';
    sel.addEventListener('change', async () => {
      current.weaponChoice = sel.value;
      current.charWeaponChoices[current.char] = sel.value;
      await applyWeaponChoice(sel.value);
    });
    wrow.appendChild(sel);
    piecesEl.appendChild(wrow);
  }
  if (Object.keys(manifest.wings ?? {}).length) {
    const row = document.createElement('div');
    row.className = 'piece-row';
    row.dataset.wingrow = '1';
    const initial = current?.wingChoice ?? 'none';
    row.innerHTML = `<div class="piece-name"><span>Wings</span><span class="variant-tag">${
      initial === 'none' ? 'None' : (manifest.wings[initial]?.label ?? initial)
    }</span></div>`;
    const chips = document.createElement('div');
    chips.className = 'chips';
    const mkWingChip = (key, label) => {
      const chip = document.createElement('button');
      chip.className = `chip ${key === 'none' ? 'none' : `wing-${key.replace('hover_', '').replace('_wings', '').replace('hover', '')}`}`;
      chip.dataset.variant = key;
      chip.title = label;
      chip.setAttribute('aria-label', `Wings: ${label}`);
      chip.addEventListener('click', async () => {
        current.wingChoice = key;
        current.charWingChoices[current.char] = key;
        await applyWingChoice(key);
        for (const c2 of chips.querySelectorAll('.chip')) {
          c2.classList.toggle('selected', c2.dataset.variant === key);
        }
        row.querySelector('.variant-tag').textContent = label;
      });
      return chip;
    };
    chips.appendChild(mkWingChip('none', 'None'));
    for (const [key, wdef] of Object.entries(manifest.wings)) {
      chips.appendChild(mkWingChip(key, wdef.label));
    }
    row.appendChild(chips);
    piecesEl.appendChild(row);
    for (const c2 of chips.querySelectorAll('.chip')) {
      c2.classList.toggle('selected', c2.dataset.variant === initial);
    }
  }
}

// Full-set quick apply.
for (const variant of ['base', ...manifest.themes]) {
  const chip = document.createElement('button');
  chip.className = `chip ${variant}`;
  chip.title = `Full set: ${THEME_LABELS[variant]}`;
  chip.setAttribute('aria-label', `Apply ${THEME_LABELS[variant]} to every piece`);
  chip.addEventListener('click', async () => {
    if (!current) return;
    const def = manifest.chars[current.char];
    for (const [piece, meta] of Object.entries(def.pieces)) {
      if (variant === 'base' || meta.variants[variant]) await applyVariant(piece, variant);
    }
  });
  setrowEl.appendChild(chip);
}

// Character roster.
const PIECES_WORD = (n) => `${n} piece${n === 1 ? '' : 's'}`;
for (const [char, def] of Object.entries(manifest.chars)) {
  const tile = document.createElement('button');
  tile.className = 'char-tile';
  tile.dataset.char = char;
  tile.innerHTML = `${def.label}<small>${PIECES_WORD(Object.keys(def.pieces).length)}</small>`;
  tile.addEventListener('click', async () => {
    for (const t of rosterEl.querySelectorAll('.char-tile')) t.classList.remove('active');
    tile.classList.add('active');
    await showCharacter(char);
  });
  rosterEl.appendChild(tile);
}

// Debug hook for headless verification: dump body-mesh visibility.
window.__pickerDebug = () => {
  const out = [];
  current?.root?.traverse((o) => {
    if (o.isMesh) out.push(`${o.name}:${o.visible ? 'visible' : 'hidden'}`);
  });
  return out.join(' | ');
};

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  current?.mixer?.update(dt);
  controls.update();
  renderer.render(scene, camera);
});

// Boot on the first character.
rosterEl.querySelector('.char-tile')?.click();
