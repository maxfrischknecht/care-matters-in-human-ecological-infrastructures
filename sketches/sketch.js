// stop on mouse pressed
// add a blur or light
// filter with no manifesta
// black boxes appear sometimes

// GENERAL & DATA
let data;
DATA_PATH = "./data/manifesta-dataset.csv"
let items = []; // to draw to the sphere
let measurers = {}; // ?
let faceInward = false; // flip text
let VIEW_TILT; // starting perspective
let R; // Sphere Radius and CameraDistance to calculate text flip

// TYPOGRAPHY OF LABELS
let LABEL_FONT;
let FONT_PATH = "./fonts/monaspace-xenon-latin-600-normal.ttf"
let META_FONT;
let META_FONT_PATH = "./fonts/monaspace-xenon-latin-200-normal.ttf"
const WORDS_PER_LINE = 9; // line break after this many words
const FONT_PX = 12; // manifesta text size (texture resolution)
const LABEL_SCALE = 1; // size of all text in the 3D scene
const LINE_HEIGHT = 1.25;
const PAD = 8;

// COLORS
// let dark_bg = '#222023'
let dark_bg = '#000'
// let red = '#D3463D'
let red = '#d3473d58'
// let purple = '#7772D4' // full
// let lila = '#9D9AE5'
let lila = '#afaffc'
let purple = '#7772d489'

let grid_col = red;
let font_col = lila;

// SPHERE GRID
const GRID_ALPHA = 60;      // 0–255; 0 disables the grid
const GRID_STEP = 15;       // degrees between lines of latitude/longitude
const GRID_SEG = 72;        // segments per circle (smoothness)
const GRID_RADIUS = 0.98;   // grid radius as a fraction of R (just inside the texts)
const CURVE_STEP = 32;   // mesh detail; smaller = smoother
const CURVE_AMOUNT = 1;  // 1 = true sphere shape (sketch6 uses 1.6 to exaggerate)
const GRID_FADE_START = 1.8;   // grid starts to appear at this camera distance (multiple of R)
const GRID_FADE_END = 1.0;     // fully visible at this distance (1 = at the surface)
const GRID_WEIGHT = 1

// META DATA DISPLAY
const PICK_COUNT = 15;        // how many manifest get meta
const PICK_INTERVAL_MS = 5000; // how often (ms) data items are changed
let picked = [];
let lastPick = 0;
const FADE_MS = 1000;   // duration of fade in / fade out

const FILE_BASE = "./media/";   // root folder, files live in FILE_BASE/<row.folder>/<file>
const FILE_COUNT = 1;              // media files shown per picked item
const FILE_SIZE = 0.4;            // longer side of a media quad, as fraction of R
const FILE_SPREAD = 0.3;           // offset range as fraction of R
const FILE_MIN_DIST = 0.2;         // min offset so it doesn't cover the item label
const MEDIA_FADE_START = 1.5;   // media begins to appear at this camera distance (multiple of R)
const MEDIA_FADE_END = 1.0;     // fully visible at this distance (1 = at the surface)
const MEDIA_OFFSET = 0.3;      // how far behind the labels, as fraction of R
const mediaCache = new Map();      // path -> { kind, el, w, h, ready, failed }
let fileLabels = [];               // { it, media, lx, ly }, rebuilt each pick
let fadingOut = [];    // media that was replaced and is fading out
const MEDIA_JITTER = 0.15;   // random depth spread of the media, as fraction of R

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
const FILE_RING = [0.28, 0.7];                // random offset ring around item

const FILE_FONT_PX = 24;           // smaller than main labels
const FILE_COLOR = [255, 255, 150, 255];


/* ----------------------------------------------------------------------
S E T U P 
---------------------------------------------------------------------- */
// data loading helper
async function loadData() {
  const d = await d3.csv(DATA_PATH)
  return d;
}

function preload() {
  LABEL_FONT = loadFont(FONT_PATH);
  META_FONT = loadFont(META_FONT_PATH);
}


function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL)
  textureMode(NORMAL);

  // tilt landing view to bottom
  VIEW_TILT = (HALF_PI - 0.2);

  // load the data and start building
  loadData().then(async d => {
    data = d.map(r => ({
      ...r,
      // make "['item', 'item']" to an actual array (no string)
      tags: (r.tags.match(/'[^']*'/g) || []).map(t => t.replace(/'/g, "").trim()),
      authors: (r.authors.match(/'[^']*'/g) || []).map(t => t.replace(/'/g, "").trim()),
      files: (r.files.match(/'[^']*'/g) || []).map(t => t.replace(/'/g, "").trim())
    }));
    // console.log("data", data);

    // Load the font
    // LABEL_FONT = await loadFont("./fonts/EverettMono-Regular-web.ttf"); 
    console.log(LABEL_FONT)
    // build the sphere and create the texture labels
    buildSphere(data)

    // size the sczene
    sizeScene();
  });

}

/* ----------------------------------------------------------------------
G E N E R A L   H E L P E R S
---------------------------------------------------------------------- */
// calculates Sphere Radius and Camera Distance (for flipping text) on load 
function sizeScene() {
  R = min(width, height) * 0.38;
  camDist = height / 2 / tan(PI / 6); // only needed if you add the project() logic
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

// measures dimensions of the font
function getMeasurer(font) {
  const key = font ? (font === LABEL_FONT ? "label" : "font") : "_default";
  if (!measurers[key]) {
    measurers[key] = createGraphics(10, 10);
    if (font) measurers[key].textFont(font);
  }
  return measurers[key];
}

// jumps to a random position in a video element
function seekRandom(el) {
  const d = el.duration;
  if (isFinite(d) && d > 0.5) el.currentTime = random(d * 0.95);   // stay clear of the very end
}

/* ----------------------------------------------------------------------
S P H E R E 
---------------------------------------------------------------------- */

// draw the grey grid in the back
function drawSphereGrid(alpha = GRID_ALPHA) {
  if (alpha <= 0) return;
  noFill();
  stroke(color(grid_col), alpha);
  strokeWeight(GRID_WEIGHT);
  const r = R * GRID_RADIUS;

  for (let lat = -75; lat <= 75; lat += GRID_STEP) {      // circles of latitude
    const y = sin(radians(lat)) * r;
    const rr = cos(radians(lat)) * r;
    beginShape();
    for (let i = 0; i <= GRID_SEG; i++) {
      const a = (TWO_PI * i) / GRID_SEG;
      vertex(cos(a) * rr, y, sin(a) * rr);
    }
    endShape();
  }
  for (let lon = 0; lon < 360; lon += GRID_STEP) {        // lines of longitude
    const a = radians(lon);
    beginShape();
    for (let i = 0; i <= GRID_SEG / 2; i++) {
      const b = -HALF_PI + (PI * i) / (GRID_SEG / 2);
      vertex(cos(a) * cos(b) * r, sin(b) * r, sin(a) * cos(b) * r);
    }
    endShape();
  }
}

/* ----------------------------------------------------------------------
M A N I F E S T A 
---------------------------------------------------------------------- */
// 1. CREATING THE LABELS
// based on the data, create 3d items
// uses makeLabel (text > texture) and wrapWords
// item > g (= 3d graphic), row = original data
function buildSphere() {
  const n = data.length;
  const golden = PI * (3 - sqrt(5));
  data.forEach((row, i) => {
    const y = 1 - (i / (n - 1)) * 2;
    const r = sqrt(1 - y * y);
    const theta = golden * i;

    const pos = { x: cos(theta) * r, y, z: sin(theta) * r };
    const yaw = atan2(pos.x, pos.z);
    const pitch = -asin(pos.y);

    const u = { x: -cos(yaw), y: 0, z: sin(yaw) };   // sketch6 basis (reads from inside)
    const v = { x: sin(pitch) * sin(yaw), y: cos(pitch), z: sin(pitch) * cos(yaw) };
    const lat0 = asin(pos.y);
    items.push({
      row,
      pos, yaw, pitch, u, v, lat0,
      cosLat: max(0.3, cos(lat0)),
      g: makeLabel(wrapWords(row.manifesta), FONT_PX, color(font_col), LABEL_FONT)
    });
  });
}

// Render lines of text (transparent background) into an offscreen graphic used as a texture
function makeLabel(lines, fontPx, textCol, font) {
  const m = getMeasurer(font);
  // m.textStyle(bold ? BOLD : NORMAL);
  m.textSize(fontPx);
  const maxW = Math.max(...lines.map((l) => m.textWidth(l)));
  const lh = fontPx * LINE_HEIGHT;

  const g = createGraphics(
    ceil(maxW + PAD * 2),
    ceil(lines.length * lh + PAD * 2),
  );
  g.pixelDensity(2);
  g.clear();
  if (font) g.textFont(font);
  // g.textStyle(bold ? BOLD : NORMAL);

  if (font) g.textFont(font);
  g.textSize(fontPx);
  g.fill(textCol);
  g.noStroke();
  g.textAlign(LEFT, TOP);
  // CENTER
  // lines.forEach((l, i) => g.text(l, g.width / 2, PAD + i * lh));
  // LEFT ALIGN
  lines.forEach((l, i) => g.text(l, PAD, PAD + i * lh))
  return g;
}

// 2. POSITIONING THE LABELS IN THE CURVED SPHERE
// projects each mesh vertex onto the sphere
// Projects a point on the item's tangent plane (lx along u, ly along v)
// back onto the sphere. `radiusScale` pushes it along the sphere normal:
// 1 = surface, >1 = behind the manifesta Label, <1 = in front of it.
function labelPoint(it, lx, ly, radiusScale = 1, centerLy = 0) {
  const P = it.pos, u = it.u, v = it.v;

  // straight (tangent-plane) direction
  let gx = P.x + (u.x * lx + v.x * ly) / R;
  let gy = P.y + (u.y * lx + v.y * ly) / R;
  let gz = P.z + (u.z * lx + v.z * ly) / R;
  const gl = sqrt(gx * gx + gy * gy + gz * gz);
  gx /= gl; gy /= gl; gz /= gl;

  // cos(latitude) at the CENTER of this quad, not at the item
  const centerLat = constrain(it.lat0 + centerLy / R, -1.5, 1.5);
  const cosC = max(0.3, cos(centerLat));

  const lon = it.yaw - lx / (R * cosC);
  const lat = constrain(it.lat0 + ly / R, -1.5, 1.5);
  const sx = cos(lat) * sin(lon), sy = sin(lat), sz = cos(lat) * cos(lon);

  const dx = gx + (sx - gx) * CURVE_AMOUNT;
  const dy = gy + (sy - gy) * CURVE_AMOUNT;
  const dz = gz + (sz - gz) * CURVE_AMOUNT;
  const dl = sqrt(dx * dx + dy * dy + dz * dz);

  const r = R * radiusScale;
  return [r * dx / dl, r * dy / dl, r * dz / dl];
}

// Draws the currently-bound texture as a mesh curved onto the sphere.
// The caller MUST bind the texture first:
//   texture(el.g); drawCurvedQuad(it, w, h, offLX, offLY, radiusScale);
//   - w, h        world-space size (the caller owns the aspect ratio)
//   - offLX/offLY move the quad around the item (tangent plane, world units)
//   - radiusScale pushes it behind/around the manifesta (default = surface)
//   - step        mesh detail in world units (smaller = smoother, more verts)
function drawCurvedQuad(it, w, h, offLX = 0, offLY = 0, radiusScale = 1, step = CURVE_STEP) {
  noStroke();
  const cols = max(2, ceil(w / step));
  const rows = max(1, ceil(h / step));
  const mirror = faceInward ? 1 : -1; // sketch6 basis reads from inside; mirror for outside

  for (let j = 0; j < rows; j++) {
    const v0 = j / rows, v1 = (j + 1) / rows;
    beginShape(TRIANGLE_STRIP);
    for (let i = 0; i <= cols; i++) {
      const uu = i / cols;
      const lx = offLX + mirror * (uu - 0.5) * w;
      const a = labelPoint(it, lx, offLY + (v0 - 0.5) * h, radiusScale, offLY);
      const b = labelPoint(it, lx, offLY + (v1 - 0.5) * h, radiusScale, offLY);
      vertex(a[0], a[1], a[2], uu, v0);
      vertex(b[0], b[1], b[2], uu, v1);
    }
    endShape();
  }
}

// Back-compat wrapper for the manifesta label: uses the label's own
// dimensions and the global LABEL_SCALE. Existing calls keep working.
function drawLabelMesh(it, g = it.g, offLX = 0, offLY = 0, radiusScale = 1) {
  drawCurvedQuad(
    it,
    g.width * LABEL_SCALE,
    g.height * LABEL_SCALE,
    offLX, offLY, radiusScale,
  );
}

/* ----------------------------------------------------------------------
M E T A  D A T A
---------------------------------------------------------------------- */
// select random items to display meta data of them 
function pickRandom(arr, n) {
  const copy = arr.slice();
  const out = [];
  for (let i = 0; i < n && copy.length; i++) {
    out.push(copy.splice(floor(random(copy.length)), 1)[0]);
  }
  return out;
}

function getFileLabel(name) {
  if (!fileLabelCache.has(name)) {
    fileLabelCache.set(
      name,
      makeLabel(wrapWords(name), FILE_FONT_PX, color(...FILE_COLOR), META_FONT),
    );
  }
  return fileLabelCache.get(name);
}

function isMedia(name) {
  return IMAGE_EXT.test(name) || VIDEO_EXT.test(name);
}

// builds the path, loads the file once, and caches it
function getMedia(row, name) {
  const path = FILE_BASE + encodeURIComponent(row.folder) + "/" + encodeURIComponent(name);
  if (mediaCache.has(path)) return mediaCache.get(path);

  const m = { kind: null, el: null, w: 1, h: 1, ready: false, failed: false };
  mediaCache.set(path, m);

  if (IMAGE_EXT.test(name)) {
    m.kind = "image";
    m.el = loadImage(
      path,
      (img) => { m.w = img.width; m.h = img.height; m.ready = true; },
      () => { m.failed = true; console.warn("image failed", path); },
    );
  } else {
    m.kind = "video";
    const v = createVideo(path);
    v.hide();                         // don't add a DOM element to the page
    v.elt.muted = true;               // required for autoplay
    v.elt.playsInline = true;
    v.elt.loop = true;
    v.elt.addEventListener("loadeddata", () => {
      m.w = v.elt.videoWidth;
      m.h = v.elt.videoHeight;

      const d = v.elt.duration;
      if (isFinite(d) && d > 0.5) {
        // ready only once the seek is done, so the fade-in starts on the right frame
        v.elt.addEventListener("seeked", () => {
          m.ready = true;
          v.elt.play().catch(() => { });
        }, { once: true });
        v.elt.currentTime = random(d * 0.95);
      } else {
        m.ready = true;
        v.elt.play().catch(() => { });
      }
    });
    v.elt.addEventListener("error", () => {
      m.failed = true;
      console.warn("video failed", path);
    });
    m.el = v;
  }
  return m;
}

// fading media in, out
// 0..1 opacity of one media item, with a smooth ease
function mediaAlpha(fl, now) {
  let a;
  if (fl.diedAt) {
    // fade out, starting from wherever the fade-in had got to
    a = fl.deathAlpha * (1 - (now - fl.diedAt) / FADE_MS);
  } else {
    // fade in starts once the file has actually loaded
    if (!fl.readyAt && fl.media.ready) fl.readyAt = now;
    a = fl.readyAt ? (now - fl.readyAt) / FADE_MS : 0;
  }
  a = constrain(a, 0, 1);
  fl.alpha = a;
  return a * a * (3 - 2 * a);   // smoothstep
}

function drawMediaItem(fl, now, gain) {
  const radius = 1 + MEDIA_OFFSET + fl.layer * MEDIA_JITTER;
  const m = fl.media;
  if (!m.ready || m.failed) return;
  const a = mediaAlpha(fl, now) * gain;
  if (a <= 0) return;

  const k = (FILE_SIZE * R) / max(m.w, m.h);
  tint(255, 255 * a);
  texture(m.el);
  drawCurvedQuad(fl.it, m.w * k, m.h * k, fl.lx, fl.ly, radius);
}

/* ----------------------------------------------------------------------
D R A W 
---------------------------------------------------------------------- */
function draw() {
  background(dark_bg);
  noStroke();

  orbitControl();

  // rotation and landing tilt
  rotateX(VIEW_TILT);
  // slow rotation
  const SPIN_PER_SEC = radians(-3);
  rotateY((millis() / 1000) * SPIN_PER_SEC);

  // check if inside sphere to flip text
  const cam = this._renderer._curCamera;
  const camDist = Math.hypot(cam.eyeX, cam.eyeY, cam.eyeZ);
  faceInward = camDist < R;

  // grid fades in as the camera approaches the sphere
  const gridT = constrain(map(camDist / R, GRID_FADE_START, GRID_FADE_END, 0, 1), 0, 1);
  if (gridT > 0) drawSphereGrid(GRID_ALPHA * gridT);

  // media fades in as the camera approaches the sphere
  const mediaT = constrain(map(camDist / R, MEDIA_FADE_START, MEDIA_FADE_END, 0, 1), 0, 1);
  const mediaActive = mediaT > 0;
  // behind the labels: further out when inside, further in when outside
  const mediaRadius = 1 + MEDIA_OFFSET;   // same shell, inside and outside

  const now = millis();

  // too far away: stop videos, clear everything immediately
  if (!mediaActive && (fileLabels.length || fadingOut.length)) {
    for (const f of [...fileLabels, ...fadingOut]) {
      if (f.media.kind === "video") f.media.el.elt.pause();
    }
    fileLabels = [];
    fadingOut = [];
  }

  // drop finished fade-outs, pause their videos if nothing shows them anymore
  if (fadingOut.length) {
    const stillShown = new Set(fileLabels.map((f) => f.media));
    fadingOut = fadingOut.filter((f) => {
      if (now - f.diedAt < FADE_MS) return true;
      if (f.media.kind === "video" && !stillShown.has(f.media)) f.media.el.elt.pause();
      return false;
    });
  }

  // 1. MEDIA (drawn first so it sits behind the labels)
  if (mediaActive) {
    for (const fl of fadingOut) drawMediaItem(fl, now, mediaT, mediaRadius);
    for (const fl of fileLabels) drawMediaItem(fl, now, mediaT, mediaRadius);
    tint(255);   // reset, so the labels below are not tinted
  }

  // 2. MANIFESTA LABELS (on top)
  for (const it of items) {
    texture(it.g);
    drawLabelMesh(it);
  }

  // 3. PICK NEW RANDOM MEDIA (every PICK_INTERVAL_MS, while media is active)
  // 3. PICK NEW RANDOM MEDIA (every PICK_INTERVAL_MS, while media is active)
  if (mediaActive && items.length && now - lastPick >= PICK_INTERVAL_MS) {
    lastPick = now;
    picked = pickRandom(items, PICK_COUNT);

    // the old selection starts fading out
    for (const f of fileLabels) {
      f.diedAt = now;
      f.deathAlpha = f.alpha || 0;
      fadingOut.push(f);
    }

    fileLabels = [];
    for (const it of picked) {
      const mediaFiles = it.row.files.filter(isMedia);
      for (const name of pickRandom(mediaFiles, FILE_COUNT)) {
        let lx, ly;
        do {
          lx = random(-1, 1) * FILE_SPREAD * R;
          ly = random(-1, 1) * FILE_SPREAD * R;
        } while (abs(lx) < FILE_MIN_DIST * R && abs(ly) < FILE_MIN_DIST * R);
        fileLabels.push({
          it, media: getMedia(it.row, name), lx, ly,
          readyAt: 0, alpha: 0,
          layer: random(),   // 0..1, fixed for the lifetime of this item
        });
      }
    }

    // videos that were loaded before: jump to a random position and play
    // (videos loading for the first time are handled in getMedia)
    for (const f of fileLabels) {
      const m = f.media;
      if (m.kind === "video" && m.ready) {
        seekRandom(m.el.elt);
        m.el.elt.play().catch(() => { });
      }
    }
  }
}
