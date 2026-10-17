const CSV_FILE = "data/test-dataset.csv";

const WORDS_PER_LINE = 7; // line break after this many words
const FONT_PX = 32; // manifesta text size (texture resolution)
const FILE_FONT_PX = 26; // file name text size
const TAG_FONT_PX = 42; // tag text size (larger than the manifesta)
const TAG_FONT = "Times New Roman"; // local serif font for tags
const LINE_HEIGHT = 1.25;
const PAD = 8;
const LABEL_SCALE = 0.48; // size of all text in the 3D scene
const SPIN_SPEED = 0.0015; // radians per frame
const GAP = 8; // space between files/tags around a manifesta
const SCREEN_GAP = 6; // space between labels on screen (pixels)

const IMAGE_FOLDER = "file"; // folder (next to index.html) that holds the files
const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
const IMAGE_MIN_SIZE = 45; // images get a random size (longest side) between these
const IMAGE_MAX_SIZE = 110;
const MASK_ASPECT_MIN = 0.5; // random window shape: 0.5 = tall, 1 = square, 2 = wide
const MASK_ASPECT_MAX = 2.0;
const OVERLAY_FILL = 0.86; // how much of the screen the flat layout may fill
const OVERLAY_MAX_SCALE = 2.6; // never blow it up more than this
// Shooting-star layout of a clicked manifesta
const TAIL_DIR = { x: -1, y: 0.8 }; // direction of the tail: left and down
const TAG_GAP = 3; // space between tags
const FILE_GAP = 5; // space between files
const FILE_OVERLAP = 0.55; // lower = tags overlap the files more
const STREAK = 3; // how stretched each group is along the tail (1 = round)
const TAG_LIFT = 30; // tags float in front of the files
const CURVE_STEP = 16; // mesh detail of the curved text (smaller = smoother)
const CURVE_AMOUNT = 1.6; // how strongly texts bend along the sphere (1 = true shape)
const FLATTEN_SPEED = 0.08; // how fast a clicked manifesta flattens / curves back
const FOV = 1.45; // field of view from inside the sphere (radians, ~83°)
const SPHERE_SCALE = 2; // how big the sphere is around you
const DUST_COUNT = 500; // floating specks inside the sphere (0 = none)
const GRID_ALPHA = 14; // faint lines on the sphere wall (0 = none)
const MIN_FACING = 0.2; // labels further to the side than this are not shown
const CLUSTER_LIFT = 15; // tags/files float this much in front of the manifesta
const IMAGE_MAX_PX = 800; // big photos are downscaled to this after loading

const FILE_COLOR = [150, 210, 255];
const TAG_COLOR = [255, 255, 255];

let table;
let items = [];
let R, focal;
let dust = [];
let rotA = 0,
  rotB = 0.3; // sphere rotation around Y and X
let tiltOffset = 0,
  wobbleT = 0;
let ca, sa, cb, sb; // cached cos/sin of the rotation
let measurers = {};
let selected = null;
let overlayItem = null; // the manifesta shown in the flat layer (also while fading out)
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

  // Dust: random directions at different distances, for a sense of depth
  for (let i = 0; i < DUST_COUNT; i++) {
    const z = random(-1, 1),
      a = random(TWO_PI),
      r = sqrt(1 - z * z);
    dust.push({
      x: cos(a) * r,
      y: z,
      z: sin(a) * r,
      d: random(0.2, 0.92),
      s: random(1, 2.5),
    });
  }
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
    // u is flipped so the text reads left-to-right when seen from inside the sphere
    const u = { x: -cos(yaw), y: 0, z: sin(yaw) };
    const v = {
      x: sin(pitch) * sin(yaw),
      y: cos(pitch),
      z: sin(pitch) * cos(yaw),
    };

    const lat0 = asin(pos.y); // the label's latitude on the sphere
    items.push({
      pos,
      u,
      v,
      yaw,
      pitch,
      lat0,
      cosLat: max(0.3, cos(lat0)), // limited so labels near the poles don't stretch
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
  R = min(width, height) * 0.38 * SPHERE_SCALE;
  focal = height / 2 / tan(FOV / 2); // matches perspective(FOV, ...) in draw()
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
      el.g = maskImage(img);
      el.size = random(IMAGE_MIN_SIZE, IMAGE_MAX_SIZE); // random size per image
      el.isImage = true;
      el.ready = true;
      layoutCluster(it); // re-place everything now that it is here
    },
    () => loadClusterImage(it, el, paths, i + 1),
  );
}

// Crop the image to a random aspect ratio, like a window onto part of it.
// The picture itself is never stretched.
function maskImage(img) {
  // width / height of the window, picked so tall and wide shapes are equally likely
  const aspect = exp(random(log(MASK_ASPECT_MIN), log(MASK_ASPECT_MAX)));
  let cw = img.width,
    ch = img.height;
  if (cw / ch > aspect)
    cw = round(ch * aspect); // image is wider: crop the sides
  else ch = round(cw / aspect); // image is taller: crop top/bottom
  const cx = floor(random(0, img.width - cw + 1)); // random part of the picture
  const cy = floor(random(0, img.height - ch + 1));
  const out = img.get(cx, cy, cw, ch);
  if (max(out.width, out.height) > IMAGE_MAX_PX) {
    if (out.width >= out.height) out.resize(IMAGE_MAX_PX, 0);
    else out.resize(0, IMAGE_MAX_PX);
  }
  return out;
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

// "Shooting star" layout, from bottom left to top right:
// files (tail)  ->  tags (overlapping the edge of the files)  ->  manifesta (head)
function layoutCluster(it) {
  const w = it.g.width * LABEL_SCALE;
  const h = it.g.height * LABEL_SCALE;
  const man = { x: -w / 2, y: -h / 2, w, h };

  const tags = it.cluster.filter((el) => el.kind === "tag");
  const files = it.cluster.filter((el) => el.kind === "file" && el.ready);
  [...tags, ...files].forEach(sizeElement);

  const d = normalizeXY(TAIL_DIR); // towards bottom left (screen y points down)
  const corner = { x: -w / 2, y: h / 2 }; // manifesta's bottom-left corner

  // Tags: clustered just past the manifesta's bottom-left corner
  const rT = groupRadius(tags);
  const cT = {
    x: corner.x + d.x * (rT + TAG_GAP),
    y: corner.y + d.y * (rT + TAG_GAP),
  };
  packGroup(tags, cT, [man], TAG_GAP, d);

  // Files: clustered further along the tail, starting at the far end of the tags,
  // close enough that the tags overlap their edge
  const tagEnd = farthestAlong(tags, d) || corner;
  const rF = groupRadius(files);
  const cF = {
    x: tagEnd.x + d.x * rF * FILE_OVERLAP,
    y: tagEnd.y + d.y * rF * FILE_OVERLAP,
  };
  packGroup(files, cF, [man], FILE_GAP, d); // files avoid the manifesta and each other, not the tags

  // Files first, tags after, so the tags are drawn on top
  it.shown = [...files, ...tags];

  // Box around the whole shape, so the flat layer can centre it and fit it to the screen
  it.compBox = boundsOf([man, ...it.shown.map(elRect)]);
}

function sizeElement(el) {
  const sc = el.isImage ? el.size / max(el.g.width, el.g.height) : LABEL_SCALE;
  el.w = el.g.width * sc;
  el.h = el.g.height * sc;
  el.lift = el.kind === "tag" ? TAG_LIFT : CLUSTER_LIFT; // tags float nearest the viewer
}

function elRect(el) {
  return { x: el.ox - el.w / 2, y: el.oy - el.h / 2, w: el.w, h: el.h };
}

function normalizeXY(v) {
  const l = sqrt(v.x * v.x + v.y * v.y);
  return { x: v.x / l, y: v.y / l };
}

// Rough half-length of a group along the tail once packed into a streak
function groupRadius(els) {
  const area = els.reduce((s, el) => s + el.w * el.h, 0);
  return sqrt(area * STREAK) * 0.55;
}

// The point of a group that reaches furthest along direction d
function farthestAlong(els, d) {
  let best = null,
    bestP = -Infinity;
  for (const el of els) {
    for (const [fx, fy] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
    ]) {
      const x = el.ox + fx * el.w,
        y = el.oy + fy * el.h;
      const p = x * d.x + y * d.y;
      if (p > bestP) {
        bestP = p;
        best = { x, y };
      }
    }
  }
  return best;
}

// Pack elements tightly around a centre, biggest first, along a spiral
// stretched in the tail direction so the group looks like a streak
function packGroup(els, c, obstacles, gap, d) {
  const perp = { x: -d.y, y: d.x };
  const placed = [];
  const order = [...els].sort((a, b) => b.w * b.h - a.w * a.h);
  for (const el of order) {
    el.ox = c.x;
    el.oy = c.y;
    for (let s = 0; s < 6000; s++) {
      const th = s * 0.3,
        rad = 1.6 * th;
      const along = cos(th) * rad,
        across = (sin(th) * rad) / STREAK;
      const ox = c.x + d.x * along + perp.x * across;
      const oy = c.y + d.y * along + perp.y * across;
      const rect = { x: ox - el.w / 2, y: oy - el.h / 2, w: el.w, h: el.h };
      if (
        !obstacles.some((o) => rectsOverlap(o, rect, gap)) &&
        !placed.some((p) => rectsOverlap(p, rect, gap))
      ) {
        el.ox = ox;
        el.oy = oy;
        placed.push(rect);
        break;
      }
    }
  }
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
    // The sphere pauses while a manifesta is open in the flat layer
  } else {
    if (!mouseIsPressed) rotA += SPIN_SPEED; // texts slowly circle around you
    wobbleT++;
    const targetB = sin(wobbleT * 0.003) * 0.15 + tiltOffset;
    rotB += (targetB - rotB) * 0.05;
  }
  ca = cos(rotA);
  sa = sin(rotA);
  cb = cos(rotB);
  sb = sin(rotB);
}

// Same transform as rotateX(rotB); rotateY(rotA), seen from a camera at the
// centre looking towards -z. Returns null for points beside or behind the viewer.
function project(x, y, z) {
  const x1 = x * ca + z * sa;
  const z1 = -x * sa + z * ca;
  const y2 = y * cb - z1 * sb;
  const z2 = y * sb + z1 * cb;
  const depth = -z2;
  if (depth < 1) return null;
  const f = focal / depth;
  return { x: x1 * f, y: y2 * f, z: z2 };
}

// How directly a label is in front of the viewer: 1 = straight ahead, -1 = behind
function facing(it) {
  const { x, y, z } = it.pos;
  const z1 = -x * sa + z * ca;
  return -(y * sb + z1 * cb);
}

// Screen-space bounding box of a rectangle lying in a label's plane
// (null when part of it is outside the view)
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
      if (!s) return null;
      minX = min(minX, s.x);
      maxX = max(maxX, s.x);
      minY = min(minY, s.y);
      maxY = max(maxY, s.y);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Screen-space box around a manifesta's actual (curved or flat) shape
function labelScreenRect(it) {
  const w = it.g.width * LABEL_SCALE,
    h = it.g.height * LABEL_SCALE;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const fx of [-0.5, 0, 0.5]) {
    for (const fy of [-0.5, 0.5]) {
      const p = labelPoint(it, fx * w, fy * h, 0); // always curved on the sphere
      const s = project(p[0], p[1], p[2]);
      if (!s) return null;
      minX = min(minX, s.x);
      maxX = max(maxX, s.x);
      minY = min(minY, s.y);
      maxY = max(maxY, s.y);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Decide which manifestas can be shown without overlapping each other
function updateVisibility() {
  for (const it of items) {
    it.z = facing(it);
    it.sphereRect = it.z > MIN_FACING ? labelScreenRect(it) : null;
    it.rect = it.sphereRect;
  }

  // The flat layer (clicked manifesta + tags + files) covers part of the screen;
  // texts on the sphere behind it are hidden
  const taken = [];
  if (overlayItem) {
    const L = overlayLayout(overlayItem);
    if (overlayItem === selected) overlayItem.rect = L.man;
    taken.push(L.man);
    for (const el of overlayItem.shown) {
      el.rect = L.rectOf(el);
      taken.push(el.rect);
    }
  }

  // Labels nearest the centre of your view get priority
  const centreFirst = items
    .filter((it) => it !== selected)
    .sort((a, b) => b.z - a.z);
  for (const it of centreFirst) {
    const free =
      it.rect && !taken.some((r) => rectsOverlap(r, it.rect, SCREEN_GAP));
    it.target = free ? 1 : 0;
    if (free) taken.push(it.rect);
  }

  // Hide quickly, reappear slowly
  for (const it of items) {
    it.vis += (it.target - it.vis) * (it.target < it.vis ? 0.4 : 0.06);
  }
}

// ---------- drawing ----------

function draw() {
  background(12);

  // Stand in the middle of the sphere, looking outward
  perspective(FOV, width / height, 1, R * 4);
  camera(0, 0, 0, 0, 0, -1, 0, 1, 0);

  updateRotation();
  updateVisibility();

  const backToFront = [...items].sort((a, b) => a.z - b.z);

  rotateX(rotB);
  rotateY(rotA);

  drawEnclosure();
  noStroke();

  for (const it of items) {
    it.flat += ((it === selected ? 1 : 0) - it.flat) * FLATTEN_SPEED;
  }
  if (overlayItem && overlayItem !== selected && overlayItem.flat < 0.01)
    overlayItem = null;

  for (const it of backToFront) {
    // Brightest straight ahead, fading towards the edges of your view
    let alpha = constrain(map(it.z, MIN_FACING, 0.9, 40, 255), 0, 255) * it.vis;
    if (selected && it !== selected) alpha *= 0.35;
    // The clicked one leaves the sphere and moves into the flat layer
    if (it === overlayItem) alpha *= 1 - ease(it.flat);
    if (alpha < 1) continue;

    tint(255, alpha);
    texture(it.g);
    drawLabelMesh(it, 0); // curved along the sphere
  }

  if (overlayItem) drawOverlay(overlayItem);
}

function ease(t) {
  return t * t * (3 - 2 * t);
}

// Where everything goes in the flat layer, in screen pixels from the centre.
// While animating (flat between 0 and 1) it grows out of the manifesta's spot on the sphere.
function overlayLayout(it) {
  const wL = it.g.width * LABEL_SCALE,
    hL = it.g.height * LABEL_SCALE;
  const box = it.compBox || { x: -wL / 2, y: -hL / 2, w: wL, h: hL };
  const S = min(
    (width * OVERLAY_FILL) / box.w,
    (height * OVERLAY_FILL) / box.h,
    OVERLAY_MAX_SCALE,
  );

  // Final position: the whole shooting star centred on screen
  const tx = -(box.x + box.w / 2) * S,
    ty = -(box.y + box.h / 2) * S;
  const e = ease(it.flat);
  const from = it.sphereRect;
  const fx = from ? from.x + from.w / 2 : tx,
    fy = from ? from.y + from.h / 2 : ty;
  const fs = from ? from.w / wL : S;

  const s = fs + (S - fs) * e; // current scale
  const cx = fx + (tx - fx) * e,
    cy = fy + (ty - fy) * e;
  return {
    e,
    s,
    cx,
    cy,
    man: { x: cx - (wL * s) / 2, y: cy - (hL * s) / 2, w: wL * s, h: hL * s },
    rectOf: (el) => ({
      x: cx + (el.ox - el.w / 2) * s,
      y: cy + (el.oy - el.h / 2) * s,
      w: el.w * s,
      h: el.h * s,
    }),
  };
}

// The clicked manifesta, its tags and files, drawn flat over the scene with no perspective
function drawOverlay(it) {
  const L = overlayLayout(it);
  const gl = drawingContext;

  ortho(-width / 2, width / 2, -height / 2, height / 2, -1000, 1000);
  camera(0, 0, 500, 0, 0, 0, 0, 1, 0);
  gl.disable(gl.DEPTH_TEST); // drawing order decides what is on top

  const drawEl = (g, r, a) => {
    tint(255, a);
    texture(g);
    push();
    translate(r.x + r.w / 2, r.y + r.h / 2, 0);
    plane(r.w, r.h);
    pop();
  };

  const a = 255 * L.e;
  // Files first, then tags on top, then the manifesta
  for (const el of it.shown.filter((el) => el.kind === "file"))
    drawEl(el.g, L.rectOf(el), a);
  for (const el of it.shown.filter((el) => el.kind === "tag"))
    drawEl(el.g, L.rectOf(el), a);
  drawEl(it.g, L.man, 255 * min(1, L.e * 1.5));

  gl.enable(gl.DEPTH_TEST);
}

// Faint lines on the sphere wall and floating dust, to give a sense of scale
function drawEnclosure() {
  noFill();
  if (GRID_ALPHA > 0) {
    stroke(255, GRID_ALPHA);
    strokeWeight(1);
    const r = R * 1.04; // just behind the texts
    const SEG = 72;
    for (let lat = -75; lat <= 75; lat += 15) {
      // circles of latitude
      const y = sin(radians(lat)) * r,
        rr = cos(radians(lat)) * r;
      beginShape();
      for (let i = 0; i <= SEG; i++) {
        const a = (TWO_PI * i) / SEG;
        vertex(cos(a) * rr, y, sin(a) * rr);
      }
      endShape();
    }
    for (let lon = 0; lon < 360; lon += 15) {
      // lines of longitude
      const a = radians(lon);
      beginShape();
      for (let i = 0; i <= SEG / 2; i++) {
        const b = -HALF_PI + (PI * i) / (SEG / 2);
        vertex(cos(a) * cos(b) * r, sin(b) * r, sin(a) * cos(b) * r);
      }
      endShape();
    }
  }
  if (dust.length) {
    // Two sizes of specks, each drawn in one go for speed
    for (const [weight, small] of [
      [1.5, true],
      [2.5, false],
    ]) {
      stroke(255, small ? 45 : 70);
      strokeWeight(weight);
      beginShape(POINTS);
      for (const p of dust) {
        if (p.s < 1.75 === small)
          vertex(p.x * p.d * R, p.y * p.d * R, p.z * p.d * R);
      }
      endShape();
    }
  }
}

// A point of the label: lx, ly are positions on the label (in scene units,
// centred on the label). t = 0 wraps it onto the sphere, t = 1 keeps it flat.
function labelPoint(it, lx, ly, t) {
  const P = it.pos,
    u = it.u,
    v = it.v;

  // Straight direction (looks flat from the centre)
  let gx = P.x + (u.x * lx) / R + (v.x * ly) / R;
  let gy = P.y + (u.y * lx) / R + (v.y * ly) / R;
  let gz = P.z + (u.z * lx) / R + (v.z * ly) / R;
  let gl = sqrt(gx * gx + gy * gy + gz * gz);
  gx /= gl;
  gy /= gl;
  gz /= gl;

  // Curved: lines of text follow the sphere's latitude circles,
  // which visibly arc when seen from the centre
  const lon = it.yaw - lx / (R * it.cosLat);
  const lat = constrain(it.lat0 + ly / R, -1.5, 1.5);
  const sx = cos(lat) * sin(lon),
    sy = sin(lat),
    sz = cos(lat) * cos(lon);

  // Exaggerate the bend, then put the point back on the sphere
  let dx = gx + (sx - gx) * CURVE_AMOUNT;
  let dy = gy + (sy - gy) * CURVE_AMOUNT;
  let dz = gz + (sz - gz) * CURVE_AMOUNT;
  const dl = sqrt(dx * dx + dy * dy + dz * dz);
  const cx = (R * dx) / dl,
    cy = (R * dy) / dl,
    cz = (R * dz) / dl;
  // Flat: the tangent plane touching the sphere at the label's centre
  const d = R;
  const fx = P.x * d + u.x * lx + v.x * ly;
  const fy = P.y * d + u.y * lx + v.y * ly;
  const fz = P.z * d + u.z * lx + v.z * ly;
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

  if (selected) {
    // Clicking a file or tag keeps it open; clicking the manifesta closes it
    if (selected.shown.some((el) => inside(el.rect))) return;
    if (inside(selected.rect)) {
      selected = null;
      return;
    }
  }

  let hit = null;
  for (const it of items) {
    if (it === selected || it.z < MIN_FACING || it.vis < 0.5) continue; // visible labels only
    if (inside(it.sphereRect) && (!hit || it.z > hit.z)) hit = it;
  }

  // Clicking empty space closes; clicking another manifesta opens that one
  selected = hit;
  if (selected) {
    if (!selected.cluster) buildCluster(selected);
    if (overlayItem && overlayItem !== selected) overlayItem.flat = 0;
    overlayItem = selected;
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
