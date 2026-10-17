const CSV_FILE = "data/test-dataset.csv";
// Manifesta sphere: each text in the "manifesta" column is placed on a slowly rotating 3D sphere.
// Click a manifesta: the sphere turns it to the front and its files and tags appear around it.
// Files that can't be found are skipped; only the ones that exist are shown.
// Nothing overlaps: elements are laid out to avoid each other, and any manifesta that
// would overlap something nearer to the viewer fades out until there is room again.
// Put your CSV next to this file and name it manifesta.csv (or change CSV_FILE).

const WORDS_PER_LINE = 7; // line break after this many words
const FONT_PX = 32; // manifesta text size (texture resolution)
const FILE_FONT_PX = 26; // file name text size
const TAG_FONT_PX = 42; // tag text size (larger than the manifesta)
const TAG_FONT = "Times New Roman"; // local serif font for tags
const LINE_HEIGHT = 1.25;
const PAD = 8;
const LABEL_SCALE = 0.3; // size of all text in the 3D scene
const SPIN_SPEED = 0.0015; // radians per frame
const GAP = 8; // space between files/tags around a manifesta
const SCREEN_GAP = 6; // space between labels on screen (pixels)

const IMAGE_FOLDER = "file"; // folder (next to index.html) that holds the files
const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
const IMAGE_SIZE = 80; // longest side of an image around a manifesta
const RING_GAP = 18; // extra space between the tag ring and the file ring
const CURVE_STEP = 16; // mesh detail of the curved text (smaller = smoother)
const FLATTEN_SPEED = 0.08; // how fast a clicked manifesta flattens / curves back
const IMAGE_MAX_PX = 800; // big photos are downscaled to this after loading

const FILE_COLOR = [150, 210, 255];
const TAG_COLOR = [255, 255, 255];

let table;
let items = [];
let R, camDist;
let rotA = 0,
  rotB = 0.3; // sphere rotation around Y and X
let tiltOffset = 0,
  wobbleT = 0;
let ca, sa, cb, sb; // cached cos/sin of the rotation
let measurers = {};
let selected = null;
let clusterVis = 0; // fade-in of the files/tags
let pressX = 0,
  pressY = 0;

function preload() {
  // Read the CSV as plain text so lists like ['a.jpg', 'b.jpg'] stay in one cell
  table = loadStrings(CSV_FILE);
}

// CSV reader that keeps commas inside "double quotes" AND inside [ brackets ]
// together, so an unquoted ['a.jpg','b.jpg'] is still one cell
function parseCSV(text) {
  const rows = [];
  let row = [],
    cell = "",
    inQuotes = false,
    depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } // escaped ""
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      inQuotes = true;
    } else if (ch === "[") {
      depth++;
      cell += ch;
    } else if (ch === "]") {
      depth = max(0, depth - 1);
      cell += ch;
    } else if (ch === "," && depth === 0) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && depth === 0) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

// Turn the CSV into objects keyed by column name
function readRows(lines) {
  const all = parseCSV(lines.join("\n"));
  const header = all[0].map((h) => h.trim());
  return all.slice(1).map((cells) => {
    const obj = {};
    header.forEach((h, i) => {
      if (h) obj[h] = cells[i] ?? "";
    });
    return obj;
  });
}

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  noStroke();
  textureMode(NORMAL); // texture coordinates 0..1 for the curved meshes
  sizeScene();

  const rows = [];
  for (const rec of readRows(table)) {
    const text = (rec.manifesta || "").trim();
    if (!text) continue;
    const folder = (rec.folder || "").trim();
    const files = parseList(rec.files);
    const tags = parseList(rec.tags)
      .map((t) => t.replace(/#/g, "").trim())
      .filter((t) => t.length);
    rows.push({ text, folder, files, tags });
  }

  // Evenly distribute points on a sphere (Fibonacci sphere)
  const n = rows.length;
  const golden = PI * (3 - sqrt(5));
  rows.forEach((row, i) => {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2; // 1 .. -1
    const r = sqrt(1 - y * y);
    const theta = golden * i;
    const pos = { x: cos(theta) * r, y, z: sin(theta) * r }; // unit vector

    // The label's own right (u) and up (v) directions on the sphere surface,
    // matching rotateY(yaw) + rotateX(pitch) used when drawing
    const yaw = atan2(pos.x, pos.z);
    const pitch = -asin(pos.y);
    const u = { x: cos(yaw), y: 0, z: -sin(yaw) };
    const v = {
      x: sin(pitch) * sin(yaw),
      y: cos(pitch),
      z: sin(pitch) * cos(yaw),
    };

    items.push({
      pos,
      u,
      v,
      yaw,
      pitch,
      g: makeLabel(wrapWords(row.text), FONT_PX, color(255)),
      files: row.files,
      tags: row.tags,
      folder: row.folder,
      cluster: null, // all files + tags, built on first click
      shown: [], // the ones that are ready to display, laid out around the label
      z: 0,
      rect: null,
      vis: 1,
      target: 1,
      flat: 0, // 0 = curved on the sphere, 1 = flat (when clicked)
    });
  });
}

function sizeScene() {
  R = min(width, height) * 0.38;
  camDist = height / 2 / tan(PI / 6); // p5's default camera distance
}

// Turn "['a.m4a', 'b.txt']" (or "a, b") into ['a.m4a', 'b.txt']
function parseList(cell) {
  if (!cell) return [];
  // Remove the outer [ ], then split at commas that sit between items
  const inner = cell.trim().replace(/^\[/, "").replace(/\]$/, "");
  return (
    inner
      .split(/\s*,\s*(?=['"]|[^'"]*$)/)
      // Strip any quotes, brackets or spaces left at either end of a name
      .map((s) => s.replace(/^[\s'"\[\]]+|[\s'"\[\]]+$/g, ""))
      .filter((s) => s.length)
  );
}

// Split into lines of WORDS_PER_LINE words
function wrapWords(text) {
  const words = text.split(/\s+/);
  const lines = [];
  for (let i = 0; i < words.length; i += WORDS_PER_LINE) {
    lines.push(words.slice(i, i + WORDS_PER_LINE).join(" "));
  }
  return lines;
}

function getMeasurer(font) {
  const key = font || "_default";
  if (!measurers[key]) {
    measurers[key] = createGraphics(10, 10);
    if (font) measurers[key].textFont(font);
  }
  return measurers[key];
}

// Render lines of text (transparent background) into an offscreen graphic used as a texture
function makeLabel(lines, fontPx, textCol, font = null, bold = false) {
  const m = getMeasurer(font);
  m.textStyle(bold ? BOLD : NORMAL);
  m.textSize(fontPx);
  const maxW = Math.max(...lines.map((l) => m.textWidth(l)));
  const lh = fontPx * LINE_HEIGHT;

  const g = createGraphics(
    ceil(maxW + PAD * 2),
    ceil(lines.length * lh + PAD * 2),
  );
  g.pixelDensity(1);
  g.clear();
  if (font) g.textFont(font);
  g.textStyle(bold ? BOLD : NORMAL);
  g.textSize(fontPx);
  g.fill(textCol);
  g.noStroke();
  g.textAlign(CENTER, TOP);
  lines.forEach((l, i) => g.text(l, g.width / 2, PAD + i * lh));
  return g;
}

// ---------- files + tags around a manifesta ----------

// Mix two lists evenly, e.g. [f1,f2,f3,f4] + [t1,t2] -> f1,f2,t1,f3,f4,t2
function interleave(a, b) {
  const out = [];
  let ia = 0,
    ib = 0;
  while (ia < a.length || ib < b.length) {
    if (
      ib < b.length &&
      (ia >= a.length || (ib + 1) / b.length <= (ia + 1) / a.length)
    ) {
      out.push(b[ib++]);
    } else {
      out.push(a[ia++]);
    }
  }
  return out;
}

function rectsOverlap(a, b, gap) {
  return (
    a.x < b.x + b.w + gap &&
    b.x < a.x + a.w + gap &&
    a.y < b.y + b.h + gap &&
    b.y < a.y + a.h + gap
  );
}

// Tags are ready straight away. Each file is first looked for; it only
// appears once found, and is skipped if it can't be found anywhere.
function buildCluster(it) {
  const fileEls = it.files.map((name) => {
    const el = { name, kind: "file", ready: false, isImage: false };
    const paths = fileCandidates(it, name);
    if (IMAGE_EXT.test(name)) loadClusterImage(it, el, paths, 0);
    else checkFileExists(it, el, paths, 0);
    return el;
  });
  const tagEls = it.tags.map((t) => ({
    g: makeLabel([t], TAG_FONT_PX, color(...TAG_COLOR), TAG_FONT, true),
    kind: "tag",
    ready: true,
    isImage: false,
  }));

  it.cluster = [...tagEls, ...fileEls];
  layoutCluster(it);
  return it.cluster;
}

// All the places a file might be, tried in order
function fileCandidates(it, name) {
  const base = name.split(/[\\/]/).pop(); // drop any folder part in the CSV
  const swapCase = (s) =>
    s.replace(
      /\.(\w+)$/,
      (m, e) =>
        "." + (e === e.toUpperCase() ? e.toLowerCase() : e.toUpperCase()),
    );
  const paths = [IMAGE_FOLDER + "/" + base];
  if (it.folder) {
    paths.push(it.folder + "/" + IMAGE_FOLDER + "/" + base);
    paths.push(it.folder + "/" + base);
  }
  paths.push(name);
  const all = [];
  for (const p of paths) all.push(p, swapCase(p));
  return [...new Set(all)].map((p) => encodeURI(p));
}

// Images: try each path until one loads; if none does, the image is skipped
function loadClusterImage(it, el, paths, i) {
  if (i >= paths.length) return skipFile(el);
  loadImage(
    paths[i],
    (img) => {
      if (max(img.width, img.height) > IMAGE_MAX_PX) {
        if (img.width >= img.height) img.resize(IMAGE_MAX_PX, 0);
        else img.resize(0, IMAGE_MAX_PX);
      }
      el.g = img;
      el.isImage = true;
      el.ready = true;
      layoutCluster(it); // re-place everything now that it is here
    },
    () => loadClusterImage(it, el, paths, i + 1),
  );
}

// Other files (audio, text...): check they exist, then show their name
function checkFileExists(it, el, paths, i) {
  if (i >= paths.length) return skipFile(el);
  fetch(paths[i], { method: "HEAD" })
    .then((res) => {
      if (!res.ok) throw new Error(res.status);
      el.g = makeLabel([el.name], FILE_FONT_PX, color(...FILE_COLOR));
      el.ready = true;
      layoutCluster(it);
    })
    .catch(() => checkFileExists(it, el, paths, i + 1));
}

function skipFile(el) {
  el.skipped = true;
  console.log("Skipped (not found):", el.name);
}

// Layers: manifesta in the centre, tags in a ring around it,
// files (only the ones found) in an outer ring around the tags
function layoutCluster(it) {
  const w = it.g.width * LABEL_SCALE;
  const h = it.g.height * LABEL_SCALE;
  const core = { x: -w / 2, y: -h / 2, w, h };
  const placed = [core];

  const tags = it.cluster.filter((el) => el.kind === "tag");
  const files = it.cluster.filter((el) => el.kind === "file" && el.ready);

  placeRing(tags, core, placed, 0, GAP);

  // The files go fully outside the box around the manifesta + tags
  const inner = boundsOf(placed);
  const innerPadded = {
    x: inner.x - RING_GAP,
    y: inner.y - RING_GAP,
    w: inner.w + RING_GAP * 2,
    h: inner.h + RING_GAP * 2,
  };
  placeRing(
    files,
    inner,
    [innerPadded],
    files.length ? PI / files.length : 0,
    GAP + RING_GAP,
  );

  it.shown = [...tags, ...files];
}

// Spread elements evenly around a box, pushing each one outward
// until it touches nothing that has already been placed
function placeRing(els, box, placed, angleOffset, startGap) {
  const cx = box.x + box.w / 2,
    cy = box.y + box.h / 2;
  els.forEach((el, k) => {
    const sc = el.isImage
      ? IMAGE_SIZE / max(el.g.width, el.g.height)
      : LABEL_SCALE;
    el.w = el.g.width * sc;
    el.h = el.g.height * sc;
    el.ox = cx;
    el.oy = cy;
    const a = -HALF_PI + angleOffset + (TWO_PI * k) / els.length;
    const c = cos(a),
      s = sin(a);
    for (let r = 0; r < 3000; r += 2) {
      const ox = cx + c * (box.w / 2 + el.w / 2 + startGap + r);
      const oy = cy + s * (box.h / 2 + el.h / 2 + startGap + r);
      const rect = { x: ox - el.w / 2, y: oy - el.h / 2, w: el.w, h: el.h };
      if (!placed.some((p) => rectsOverlap(p, rect, GAP))) {
        el.ox = ox;
        el.oy = oy;
        placed.push(rect);
        break;
      }
    }
  });
}

function boundsOf(rects) {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

// ---------- rotation and screen projection ----------

function angleDiff(target, current) {
  return ((((target - current + PI) % TWO_PI) + TWO_PI) % TWO_PI) - PI;
}

function updateRotation() {
  if (selected) {
    // Turn the sphere so the selected manifesta faces the viewer
    const { x, y, z } = selected.pos;
    rotA += angleDiff(atan2(-x, z), rotA) * 0.08;
    rotB += angleDiff(atan2(y, sqrt(x * x + z * z)), rotB) * 0.08;
  } else {
    if (!mouseIsPressed) rotA += SPIN_SPEED;
    wobbleT++;
    const targetB = 0.3 + sin(wobbleT * 0.003) * 0.2 + tiltOffset;
    rotB += (targetB - rotB) * 0.05;
  }
  ca = cos(rotA);
  sa = sin(rotA);
  cb = cos(rotB);
  sb = sin(rotB);
}

// Same transform as rotateX(rotB); rotateY(rotA), then perspective
function project(x, y, z) {
  const x1 = x * ca + z * sa;
  const z1 = -x * sa + z * ca;
  const y2 = y * cb - z1 * sb;
  const z2 = y * sb + z1 * cb;
  const f = camDist / (camDist - z2);
  return { x: x1 * f, y: y2 * f, z: z2 };
}

// Screen-space bounding box of a rectangle lying in a label's plane
function screenRect(it, ox, oy, w, h, lift) {
  const P = it.pos,
    u = it.u,
    v = it.v;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const dx of [-0.5, 0.5]) {
    for (const dy of [-0.5, 0.5]) {
      const lx = ox + dx * w,
        ly = oy + dy * h;
      const s = project(
        P.x * (R + lift) + u.x * lx + v.x * ly,
        P.y * (R + lift) + u.y * lx + v.y * ly,
        P.z * (R + lift) + u.z * lx + v.z * ly,
      );
      minX = min(minX, s.x);
      maxX = max(maxX, s.x);
      minY = min(minY, s.y);
      maxY = max(maxY, s.y);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Decide which manifestas can be shown without overlapping anything nearer the viewer
function updateVisibility() {
  for (const it of items) {
    it.z = project(it.pos.x * R, it.pos.y * R, it.pos.z * R).z / R;
    it.rect = screenRect(
      it,
      0,
      0,
      it.g.width * LABEL_SCALE,
      it.g.height * LABEL_SCALE,
      0,
    );
  }

  const taken = [];
  if (selected) {
    taken.push(selected.rect);
    for (const el of selected.shown) {
      el.rect = screenRect(selected, el.ox, el.oy, el.w, el.h, 15);
      taken.push(el.rect);
    }
    selected.target = 1;
  }

  const frontToBack = items
    .filter((it) => it !== selected)
    .sort((a, b) => b.z - a.z);
  for (const it of frontToBack) {
    const free = !taken.some((r) => rectsOverlap(r, it.rect, SCREEN_GAP));
    it.target = free ? 1 : 0;
    if (free) taken.push(it.rect);
  }

  // Hide quickly, reappear slowly
  for (const it of items) {
    it.vis += (it.target - it.vis) * (it.target < it.vis ? 0.4 : 0.06);
  }
  clusterVis += (1 - clusterVis) * 0.08;
}

// ---------- drawing ----------

function draw() {
  background(12);
  updateRotation();
  updateVisibility();

  const backToFront = [...items].sort((a, b) => a.z - b.z);
  if (selected) {
    backToFront.splice(backToFront.indexOf(selected), 1);
    backToFront.push(selected);
  }

  rotateX(rotB);
  rotateY(rotA);

  for (const it of backToFront) {
    it.flat += ((it === selected ? 1 : 0) - it.flat) * FLATTEN_SPEED;

    let alpha = map(it.z, -1, 1, 35, 255) * it.vis;
    if (selected && it !== selected) alpha *= 0.35;
    if (alpha < 1) continue;

    // The manifesta itself: curved along the sphere, morphing to flat when clicked
    tint(255, alpha);
    texture(it.g);
    drawLabelMesh(it, it.flat);

    const p = it.pos;
    push();
    translate(p.x * R, p.y * R, p.z * R);
    rotateY(it.yaw);
    rotateX(it.pitch);

    if (it === selected) {
      tint(255, 255 * clusterVis);
      for (const el of it.shown) {
        push();
        translate(el.ox, el.oy, 15); // slightly in front of the sphere
        texture(el.g);
        plane(el.w, el.h);
        pop();
      }
    }
    pop();
  }
}

// A point of the label: lx, ly are positions on the label (in scene units,
// centred on the label). t = 0 wraps it onto the sphere, t = 1 keeps it flat.
function labelPoint(it, lx, ly, t) {
  const P = it.pos,
    u = it.u,
    v = it.v;
  // Curved: walk along the sphere surface, so text bends with the sphere
  const ax = lx / R,
    ay = ly / R;
  const k1 = cos(ax) * cos(ay),
    k2 = sin(ax) * cos(ay),
    k3 = sin(ay);
  const cx = R * (P.x * k1 + u.x * k2 + v.x * k3);
  const cy = R * (P.y * k1 + u.y * k2 + v.y * k3);
  const cz = R * (P.z * k1 + u.z * k2 + v.z * k3);
  // Flat: the tangent plane touching the sphere at the label's centre
  const fx = P.x * R + u.x * lx + v.x * ly;
  const fy = P.y * R + u.y * lx + v.y * ly;
  const fz = P.z * R + u.z * lx + v.z * ly;
  return [cx + (fx - cx) * t, cy + (fy - cy) * t, cz + (fz - cz) * t];
}

// Draw the label as a grid of small triangles following labelPoint
function drawLabelMesh(it, t) {
  const w = it.g.width * LABEL_SCALE;
  const h = it.g.height * LABEL_SCALE;
  const cols = max(2, ceil(w / CURVE_STEP));
  const rows = max(1, ceil(h / CURVE_STEP));
  for (let j = 0; j < rows; j++) {
    const v0 = j / rows,
      v1 = (j + 1) / rows;
    beginShape(TRIANGLE_STRIP);
    for (let i = 0; i <= cols; i++) {
      const uu = i / cols;
      const lx = (uu - 0.5) * w;
      const a = labelPoint(it, lx, (v0 - 0.5) * h, t);
      const b = labelPoint(it, lx, (v1 - 0.5) * h, t);
      vertex(a[0], a[1], a[2], uu, v0);
      vertex(b[0], b[1], b[2], uu, v1);
    }
    endShape();
  }
}

// ---------- interaction ----------

function mousePressed() {
  pressX = mouseX;
  pressY = mouseY;
}

function mouseReleased() {
  if (dist(mouseX, mouseY, pressX, pressY) > 5) return; // it was a drag

  const mx = mouseX - width / 2;
  const my = mouseY - height / 2;
  const inside = (r) =>
    r && mx > r.x && mx < r.x + r.w && my > r.y && my < r.y + r.h;

  // Clicking a file or tag keeps the current selection
  if (selected && selected.shown.some((el) => inside(el.rect))) return;

  let hit = null;
  for (const it of items) {
    if (it.z < 0 || it.vis < 0.5) continue; // only visible labels on the front
    if (inside(it.rect) && (!hit || it.z > hit.z)) hit = it;
  }

  // Click the same one or empty space to deselect
  selected = hit === selected ? null : hit;
  if (selected) {
    if (!selected.cluster) buildCluster(selected);
    clusterVis = 0;
  }
}

function mouseDragged() {
  if (selected) return;
  rotA += movedX * 0.005;
  tiltOffset += movedY * 0.005;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  sizeScene();
}
