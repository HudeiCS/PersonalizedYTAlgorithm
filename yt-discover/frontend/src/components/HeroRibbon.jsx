import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";

/* =========================================================================
   RIBBON CONFIG — every tunable in one place.

   The scene is a small set of slender see-through ribbons — high-segment
   planes displaced in the vertex shader by a sum of shaped sine waves,
   shaded in the fragment shader as a mesh of the favicon's rounded
   diamonds with (near-)transparent gaps, deep saturated troughs, pale
   matte crests, and thin specular threads along the inside of each fold.
   Each ribbon carries its own size/placement/fold-offset so no two match.

   All colors are tints/shades/alpha variants of the site tokens:
     --bg   #0f1115   --gold #e8b34d   --gold-dim #7a5f2c   --text #edeef2
   No new hues.
   ========================================================================= */
const CFG = {
  colors: {
    // The void the ribbons float in. Matches --bg exactly so the hero
    // dissolves seamlessly into the rest of the page.
    void: "#0f1115",
    // Deep saturated accent that pools in the troughs — a dark shade of
    // --gold, pushed past --gold-dim toward black. Raise toward #7a5f2c
    // for hotter troughs, lower toward #241a08 for near-void folds.
    trough: "#4f370b",
    // Matte pale crest — a desaturated tint of --gold toward --text.
    // More white = chalkier fabric; more gold = brassier.
    crest: "#e0cda0",
    // Specular thread color — a bright tint of --gold just shy of white.
    specular: "#f7e7bf",
  },

  // 0 = troughs fade to gray, 1 = full saturated accent pooling. This is
  // the "accent in the shadow" dial.
  troughSaturation: 0.9,

  // ---- The ribbons themselves. Keep this list short — a couple of
  // slender bands with void between them reads far more expensive than
  // one wide sheet. Each entry:
  //   size:        [length, width] in world units (width is what makes a
  //                ribbon slender)
  //   position:    world placement (y up, z toward the camera)
  //   rotation:    [-PI/2 lays it flat, then pitch/yaw]
  //   fieldOffset: shifts the fold pattern so ribbons never share folds
  //   ampScale:    fold amplitude multiplier for this ribbon
  //   opacity:     overall alpha multiplier
  //   mobileHide:  drop this ribbon on small screens
  ribbons: [
    {
      // the principal ribbon: mid-frame, left edge -> upper right
      size: [48, 3.0],
      position: [0, 0, -2.0],
      rotation: [-Math.PI / 2, 0.05, 0.22],
      fieldOffset: [0, 0],
      ampScale: 1.0,
      opacity: 1.0,
    },
    {
      // a slighter companion, lower and nearer, loosely parallel
      size: [46, 1.6],
      position: [-1.5, -1.3, 1.4],
      rotation: [-Math.PI / 2, 0.08, 0.3],
      fieldOffset: [7.3, 2.1],
      ampScale: 0.7,
      opacity: 0.85,
    },
    {
      // a distant sliver high in the frame, barely there
      size: [44, 1.0],
      position: [2.5, 1.7, -6.5],
      rotation: [-Math.PI / 2, 0.03, 0.17],
      fieldOffset: [13.7, 5.4],
      ampScale: 0.55,
      opacity: 0.55,
      mobileHide: true,
    },
  ],

  // ---- Fold field: four waves summed. Units are world-space. Waves 1–2
  // are shaped (broad flat crests, deep narrow troughs via
  // `troughSharpness`); waves 3–4 are plain sines that break up any
  // visible repetition. Frequencies and speeds are deliberately
  // non-commensurate so the motion never loops.
  waves: {
    amplitude: [1.2, 0.45, 0.12, 0.05], // world units, per wave
    frequency: [0.5, 0.94, 1.9, 3.3], // radians per world unit
    // direction of travel per wave, radians in the plane (0 = along the
    // ribbon's length). Kept within a narrow fan: one dominant long fold
    // plus gentle variation. A wide spread makes the surface read as
    // crumpled foil instead of a draped ribbon.
    direction: [0.06, -0.16, 0.34, -0.52],
    // phase drift per second. Slow. Irrational-ish ratios = no loop.
    speed: [0.071, -0.047, 0.113, -0.089],
    phase: [0.0, 1.7, 4.2, 2.6],
  },
  amplitudeMaster: 1.0, // scales every ribbon's folds together
  troughSharpness: 2.2, // >1: flatter crests, deeper narrower troughs
  driftSpeed: 0.055, // world units/sec the fold field slides lengthwise
  breathe: {
    amount: 0.16, // ±16% amplitude swell
    speed: 0.043, // rad/sec — one breath ≈ 2.4 min, no loop inside 60s
  },

  weave: {
    // diamond rows per world unit of ribbon width — cell size stays
    // consistent across ribbons of different widths.
    densityPerUnit: 11,
    dotRadius: 0.37, // 0–0.5, half-diagonal of each diamond in its cell
    // 0 = sharp diamond points, 1 = circle. ~0.3 matches the favicon's
    // rounded-corner diamond.
    cornerRound: 0.3,
    // alpha of the fabric between diamonds. 0 = pure see-through mesh;
    // a few % keeps the fold shapes readable through the gaps.
    membraneAlpha: 0.05,
    // how much diamonds swell/merge where the surface turns away from
    // the camera — this is what makes it read as fabric, not a gradient.
    grazingBoost: 0.4,
    // how much the back side of the mesh is dimmed relative to the
    // front. Without this the two layers blend at equal strength and
    // the depth ordering turns to mush.
    backfaceDim: 0.42,
    // fraction of the ribbon's width over which edge diamonds taper to
    // points — a clean selvage instead of shapes chopped mid-cell.
    edgeTaper: 0.09,
    // opacity multiplier for the far field, where the weave has resolved
    // into smooth sheen. 1 = physically-true coverage (reads ghostly at
    // glancing angles); higher gives receding ribbon a satin body.
    farBodyBoost: 1.9,
  },

  specular: {
    intensity: 0.65,
    shininess: 130.0, // higher = thinner streaks
    concaveBoost: 0.95, // extra specular inside the curve of each fold
    flatFloor: 0.1, // how much specular flat (non-concave) areas keep
  },

  light: [-0.4, 0.6, 0.5], // world-space direction, normalized in JS

  camera: {
    position: [0, 3.2, 9.5], // low oblique — just above crest height
    lookAt: [0, -0.1, -3.0], // aimed slightly down and into the distance
    fov: 34,
    // roll of the whole view in radians: tilts the ribbons so they run
    // from the left edge of the screen up toward the top right.
    // Negative = rises to the left instead.
    roll: 0.34,
  },

  // Tessellation: segments along the length, and per world unit of width.
  segments: { length: 520, perUnitWidth: 22 },

  // Simplifications applied under 768px viewports.
  mobile: {
    segmentsLength: 260,
    maxDpr: 1.5,
    densityPerUnit: 7, // fewer, fatter diamonds read better small
    // portrait crops the wide composition to its center, which is the
    // ribbons' shadow side — slide the camera window toward the lit
    // folds so the visible strip has presence.
    cameraShiftX: 4.5,
  },

  // uTime value used for the single frozen frame under
  // prefers-reduced-motion, and the first frame otherwise. Picked so the
  // opening composition already has developed folds.
  freezeTime: 14.0,
};

/* ========================================================================= */

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec4 uAmp;
  uniform vec4 uFreq;
  uniform vec4 uSpeed;
  uniform vec4 uPhase;
  uniform vec2 uDirA;
  uniform vec2 uDirB;
  uniform vec2 uDirC;
  uniform vec2 uDirD;
  uniform vec2 uFieldOffset;
  uniform float uMaster;
  uniform float uSharp;
  uniform float uDrift;
  uniform float uBreatheAmt;
  uniform float uBreatheSpeed;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;
  varying float vCurv;

  // s in [-1,1] -> broad flat crest near +1, deep narrow trough near -1
  float shapeWave(float s, float k) {
    float x = 0.5 - 0.5 * s;
    return 1.0 - 2.0 * pow(x, k);
  }

  float field(vec2 p, float t) {
    vec2 q = p + uFieldOffset + vec2(t * uDrift, 0.0);
    float h = 0.0;
    h += uAmp.x * shapeWave(sin(dot(q, uDirA) * uFreq.x + uPhase.x + t * uSpeed.x), uSharp);
    h += uAmp.y * shapeWave(sin(dot(q, uDirB) * uFreq.y + uPhase.y + t * uSpeed.y), uSharp);
    h += uAmp.z * sin(dot(q, uDirC) * uFreq.z + uPhase.z + t * uSpeed.z);
    h += uAmp.w * sin(dot(q, uDirD) * uFreq.w + uPhase.w + t * uSpeed.w);
    float breathe = 1.0 + uBreatheAmt * sin(t * uBreatheSpeed);
    return h * uMaster * breathe;
  }

  void main() {
    vUv = uv;
    float eps = 0.14;
    float h   = field(position.xy, uTime);
    float hxp = field(position.xy + vec2(eps, 0.0), uTime);
    float hxm = field(position.xy - vec2(eps, 0.0), uTime);
    float hyp = field(position.xy + vec2(0.0, eps), uTime);
    float hym = field(position.xy - vec2(0.0, eps), uTime);

    vec3 pos = vec3(position.xy, position.z + h);

    // analytic-ish normal from central differences of the height field
    vec3 n = normalize(vec3(-(hxp - hxm) / (2.0 * eps), -(hyp - hym) / (2.0 * eps), 1.0));
    vNormal = normalize(normalMatrix * n);

    // Laplacian as a concavity signal: positive inside the curve of a fold.
    vCurv = (hxp + hxm + hyp + hym - 4.0 * h) / (eps * eps);
    vHeight = h;

    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uVoid;
  uniform vec3 uTrough;
  uniform vec3 uCrest;
  uniform vec3 uSpecColor;
  uniform float uTroughSat;
  uniform vec3 uLightDir;
  uniform float uWeaveDensity;
  uniform float uDotRadius;
  uniform float uCornerRound;
  uniform float uMembrane;
  uniform float uGrazeBoost;
  uniform float uBackfaceDim;
  uniform float uEdgeTaper;
  uniform float uFarBoost;
  uniform float uOpacity;
  uniform float uSpecIntensity;
  uniform float uShininess;
  uniform float uConcaveBoost;
  uniform float uSpecFloor;
  uniform float uAspect;
  uniform float uHeightRange;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;
  varying float vCurv;

  void main() {
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uLightDir);

    float lit = max(dot(N, L), 0.0);
    float hN = clamp(vHeight / uHeightRange * 0.5 + 0.5, 0.0, 1.0);

    // trough accent with adjustable saturation pooling
    float lum = dot(uTrough, vec3(0.299, 0.587, 0.114));
    vec3 trough = mix(vec3(lum), uTrough, uTroughSat);

    // matte fabric shading: lit crests pale, everything else sinks into
    // saturated trough color, and the deepest shade falls to the void so
    // the silhouette edge stays hard against the background. The steep
    // exponent keeps mid-tones dark — broad areas of mid-brightness gold
    // are what read as cheap brass.
    float shade = clamp(lit * 0.72 + hN * 0.42, 0.0, 1.0);
    vec3 base = mix(trough, uCrest, pow(shade, 1.9));
    base = mix(uVoid, base, smoothstep(0.0, 0.24, shade + 0.1));

    // ---- procedural diamond-matrix weave ---------------------------
    // The grid lives in the surface's own uv space, so perspective makes
    // it follow the curvature and pack tighter as the surface recedes.
    // Each cell holds a rounded diamond (the favicon mark); the space
    // between diamonds is (nearly) transparent, so the ribbon is a
    // see-through mesh and back layers of a fold show through the front.
    vec2 g = vUv * vec2(uWeaveDensity * uAspect, uWeaveDensity);
    vec2 cell = fract(g) - 0.5;
    // L1 norm = sharp diamond; blend toward L2 for the favicon's
    // rounded corners.
    float d = mix(abs(cell.x) + abs(cell.y), length(cell) * 1.4142, uCornerRound);
    float aa = fwidth(d) + 1e-4;
    // Where the surface turns away from the camera the diamonds swell
    // and merge — density appears to increase, selling the fabric read.
    float grazing = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.0);
    float radius = uDotRadius * (1.0 + uGrazeBoost * grazing);

    // Selvage: diamonds taper to points across the last rows at either
    // edge of the ribbon, so the silhouette is a clean woven edge rather
    // than shapes chopped mid-cell.
    float edge = smoothstep(0.0, uEdgeTaper, vUv.y) * smoothstep(1.0, 1.0 - uEdgeTaper, vUv.y);
    radius *= edge;

    float diamond = 1.0 - smoothstep(radius - aa, radius + aa, d);

    // Anti-moiré: once a cell shrinks toward pixel size the sampled
    // pattern aliases into interference bands — the single biggest
    // "cheap foil" artifact. Measure the cell's screen footprint and
    // fade the mask to its true area coverage, so the far field resolves
    // into a smooth translucent sheen instead of moiré.
    vec2 cellPx = fwidth(g);
    float cellsPerPixel = max(cellPx.x, cellPx.y);
    float coverage = mix(2.0 * radius * radius, 3.14159 * radius * radius, uCornerRound);
    // boosted past true coverage so the resolved far field keeps a satin
    // body instead of thinning to vapor at glancing angles
    coverage = clamp(coverage * uFarBoost, 0.0, 0.85);
    float moireFade = smoothstep(0.3, 1.0, cellsPerPixel);
    diamond = mix(diamond, coverage, moireFade);
    vec3 col = base;

    // ---- specular streaks ------------------------------------------
    // Tight highlight, boosted where the surface is concave, so thin
    // bright threads run along the inside curve of each fold.
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), uShininess);
    float concave = clamp(vCurv * uConcaveBoost, 0.0, 1.4);
    float streak = spec * uSpecIntensity * (uSpecFloor + concave);
    col += uSpecColor * streak;

    // Mesh alpha: solid on the diamonds, membrane-faint between them;
    // specular threads brighten the membrane too so streaks read as
    // continuous lines rather than dotted ones.
    float alpha = mix(uMembrane * edge, 1.0, diamond);
    alpha = clamp(alpha + streak * 0.6 * edge, 0.0, 1.0) * uOpacity;

    // The back of the mesh recedes: dimmer and fainter than the front
    // layer, so overlapping folds keep a legible depth order.
    if (!gl_FrontFacing) {
      col *= uBackfaceDim;
      alpha *= 0.7;
    }

    gl_FragColor = vec4(col, alpha);
  }
`;

/** Hex -> [r,g,b] floats without color-space conversion, so the shader's
 *  output matches the CSS token values exactly (WYSIWYG for hand-tuning). */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function dirVec(angle) {
  return new THREE.Vector2(Math.cos(angle), Math.sin(angle));
}

/** The ribbon's four material colors, read from the CSS theme tokens so the
 *  decoration follows light/dark instead of pinning the hero to one
 *  background. Falls back to the config values if a token is missing. */
function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const token = (name, fallback) => {
    const v = css.getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
  };
  return {
    void: token("--ribbon-void", CFG.colors.void),
    trough: token("--ribbon-trough", CFG.colors.trough),
    crest: token("--ribbon-crest", CFG.colors.crest),
    specular: token("--ribbon-specular", CFG.colors.specular),
  };
}

function buildUniforms(isMobile, ribbon, palette) {
  const w = CFG.waves;
  const perUnit = isMobile ? CFG.mobile.densityPerUnit : CFG.weave.densityPerUnit;
  const master = CFG.amplitudeMaster * ribbon.ampScale;
  return {
    uTime: { value: CFG.freezeTime },
    uAmp: { value: new THREE.Vector4(...w.amplitude) },
    uFreq: { value: new THREE.Vector4(...w.frequency) },
    uSpeed: { value: new THREE.Vector4(...w.speed) },
    uPhase: { value: new THREE.Vector4(...w.phase) },
    uDirA: { value: dirVec(w.direction[0]) },
    uDirB: { value: dirVec(w.direction[1]) },
    uDirC: { value: dirVec(w.direction[2]) },
    uDirD: { value: dirVec(w.direction[3]) },
    uFieldOffset: { value: new THREE.Vector2(...ribbon.fieldOffset) },
    uMaster: { value: master },
    uSharp: { value: CFG.troughSharpness },
    uDrift: { value: CFG.driftSpeed },
    uBreatheAmt: { value: CFG.breathe.amount },
    uBreatheSpeed: { value: CFG.breathe.speed },
    uVoid: { value: new THREE.Vector3(...hexToRgb(palette.void)) },
    uTrough: { value: new THREE.Vector3(...hexToRgb(palette.trough)) },
    uCrest: { value: new THREE.Vector3(...hexToRgb(palette.crest)) },
    uSpecColor: { value: new THREE.Vector3(...hexToRgb(palette.specular)) },
    uTroughSat: { value: CFG.troughSaturation },
    uLightDir: { value: new THREE.Vector3(...CFG.light).normalize() },
    uWeaveDensity: { value: perUnit * ribbon.size[1] },
    uDotRadius: { value: CFG.weave.dotRadius },
    uCornerRound: { value: CFG.weave.cornerRound },
    uMembrane: { value: CFG.weave.membraneAlpha },
    uGrazeBoost: { value: CFG.weave.grazingBoost },
    uBackfaceDim: { value: CFG.weave.backfaceDim },
    uEdgeTaper: { value: CFG.weave.edgeTaper },
    uFarBoost: { value: CFG.weave.farBodyBoost },
    uOpacity: { value: ribbon.opacity },
    uSpecIntensity: { value: CFG.specular.intensity },
    uShininess: { value: CFG.specular.shininess },
    uConcaveBoost: { value: CFG.specular.concaveBoost },
    uSpecFloor: { value: CFG.specular.flatFloor },
    uAspect: { value: ribbon.size[0] / ribbon.size[1] },
    uHeightRange: {
      value:
        master *
        CFG.waves.amplitude.reduce((a, b) => a + b, 0) *
        (1 + CFG.breathe.amount),
    },
  };
}

/** All ribbons plus the demand-mode render loop. While `playing`, each
 *  rendered frame advances one shared clock across every ribbon's material
 *  and invalidates the next frame; when `playing` flips false the chain
 *  stops, freezing the last frame at zero GPU cost. */
function RibbonScene({ playing, isMobile, theme }) {
  const matRefs = useRef([]);
  const timeRef = useRef(CFG.freezeTime);
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);

  const ribbons = useMemo(
    () => CFG.ribbons.filter((r) => !(isMobile && r.mobileHide)),
    [isMobile]
  );
  // Deliberately NOT keyed on the theme. Rebuilding this object would hand
  // <shaderMaterial> a brand-new `uniforms` prop, which swaps the material
  // out from under the demand-mode loop and leaves the animation frozen on
  // whatever frame was last drawn. The theme is applied by writing into
  // these same uniforms below instead.
  const uniformSets = useMemo(
    () => {
      const palette = readPalette();
      return ribbons.map((r) => buildUniforms(isMobile, r, palette));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ribbons, isMobile]
  );

  // Recolour in place on a theme change, then kick the loop: the materials
  // and the running clock are untouched, so the ribbon keeps moving through
  // the switch.
  useEffect(() => {
    const palette = readPalette();
    for (const m of matRefs.current) {
      if (!m) continue;
      m.uniforms.uVoid.value.set(...hexToRgb(palette.void));
      m.uniforms.uTrough.value.set(...hexToRgb(palette.trough));
      m.uniforms.uCrest.value.set(...hexToRgb(palette.crest));
      m.uniforms.uSpecColor.value.set(...hexToRgb(palette.specular));
    }
    invalidate();
  }, [theme, invalidate]);

  useEffect(() => {
    // Roll the view by tilting the camera's up vector, so the receding
    // bands cross the screen diagonally (left edge -> upper right).
    const shift = isMobile ? CFG.mobile.cameraShiftX : 0;
    camera.up.set(Math.sin(CFG.camera.roll), Math.cos(CFG.camera.roll), 0);
    camera.position.set(
      CFG.camera.position[0] + shift,
      CFG.camera.position[1],
      CFG.camera.position[2]
    );
    camera.lookAt(
      CFG.camera.lookAt[0] + shift,
      CFG.camera.lookAt[1],
      CFG.camera.lookAt[2]
    );
  }, [camera, isMobile]);

  // Kick the loop whenever playback (re)starts; also draws the one frame
  // needed on mount and under reduced motion.
  useEffect(() => {
    invalidate();
  }, [playing, invalidate]);

  useFrame((_, delta) => {
    if (!playing) return;
    // demand mode: delta spans the whole pause after a resume — clamp it
    timeRef.current += Math.min(delta, 0.05);
    for (const m of matRefs.current) {
      if (m) m.uniforms.uTime.value = timeRef.current;
    }
    invalidate();
  });

  const segLength = isMobile ? CFG.mobile.segmentsLength : CFG.segments.length;

  return ribbons.map((r, i) => (
    <mesh key={i} position={r.position} rotation={r.rotation}>
      <planeGeometry
        args={[
          ...r.size,
          segLength,
          Math.max(24, Math.round(r.size[1] * CFG.segments.perUnitWidth)),
        ]}
      />
      <shaderMaterial
        ref={(el) => (matRefs.current[i] = el)}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniformSets[i]}
        side={THREE.DoubleSide}
        transparent
        depthWrite={false}
      />
    </mesh>
  ));
}

/** Static fallback when WebGL is unavailable: a still diagonal band built
 *  from layered CSS gradients on the same tokens. Styled in styles.css. */
function StaticRibbon() {
  return <div className="page-ribbon page-ribbon-static" aria-hidden="true" />;
}

export default function HeroRibbon() {
  const [webgl] = useState(() => {
    try {
      const c = document.createElement("canvas");
      return !!(
        window.WebGLRenderingContext &&
        (c.getContext("webgl2") || c.getContext("webgl"))
      );
    } catch {
      return false;
    }
  });
  const [reducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [isMobile] = useState(
    () => window.matchMedia("(max-width: 768px)").matches
  );
  const [tabVisible, setTabVisible] = useState(!document.hidden);
  const [inView, setInView] = useState(true);
  const wrapRef = useRef(null);
  // Bumped whenever the theme changes, to re-read the ribbon's colors from
  // the CSS tokens. Watches both the explicit choice (the data-theme
  // attribute) and the OS setting, which is what applies without one.
  const [themeEpoch, setThemeEpoch] = useState(0);

  useEffect(() => {
    const bump = () => setThemeEpoch((n) => n + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", bump);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", bump);
    };
  }, []);

  useEffect(() => {
    const onVis = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (!wrapRef.current) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting));
    io.observe(wrapRef.current);
    return () => io.disconnect();
  }, []);

  if (!webgl) return <StaticRibbon />;

  const playing = tabVisible && inView && !reducedMotion;

  return (
    <div ref={wrapRef} className="page-ribbon" aria-hidden="true">
      <Canvas
        frameloop="demand"
        dpr={[1, isMobile ? CFG.mobile.maxDpr : 2]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        camera={{ position: CFG.camera.position, fov: CFG.camera.fov, near: 0.1, far: 80 }}
      >
        <RibbonScene playing={playing} isMobile={isMobile} theme={themeEpoch} />
      </Canvas>
    </div>
  );
}
