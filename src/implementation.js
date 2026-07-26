/**
 * Image Based RT — portable implementation module
 * =================================================
 *
 * Drop this module into a WebGL2 app when you want ray-tracing-*like*
 * reflections and soft shadows without tracing secondary rays.
 *
 * Method summary (replaces classic RT reflection rays):
 *   1. Render casters into a depth shadow map (PCF soft shadows).
 *   2. Reflect the camera across a planar surface and rasterize the scene
 *      into a color "reflection image".
 *   3. Composite a water/mirror mesh that samples that image with Fresnel,
 *      soft undulation, and feathered edges.
 *
 * Usage with the Neon Atrium demo:
 *   import { createImageBasedRT, QUALITY_PRESETS } from "./implementation.js";
 *   const ibrt = createImageBasedRT(gl, { quality: "balanced" });
 *
 * Company integration sketch:
 *   const ibrt = createImageBasedRT(gl, { quality: "low" });
 *   ibrt.setQuality("low");                 // cheaper maps / fewer taps
 *   ibrt.allocateTargets();
 *   // each frame:
 *   ibrt.renderFrame({ canvas, camera, light, localLight, objects, floorObject, water, time, ... });
 *
 * No framework, no bundler, no external assets required.
 */

// ---------------------------------------------------------------------------
// Quality presets tuned for integrated / lower-end GPUs
// ---------------------------------------------------------------------------

export const QUALITY_PRESETS = {
  // Fast path for integrated GPUs and thermal-limited laptops.
  low: {
    shadowSize: 256,
    reflectionSize: 640,
    reflectionSamples: 2, // MSAA on the mirror pass (cheap edge cleanup)
    pcfMode: 0,           // 1-tap shadow
    waterBlur: 1,         // 5-tap + mip bias (kills stair-steps)
    maxPixelRatio: 1,
    shadowStrength: 0.7,
    puddleSegments: 40,
    puddleRings: 3,
    neonDetail: "low",
    antialias: false,
    shadowInterval: 2,
    reflectionInterval: 1,
  },
  // Default demo path: readable neon letters, still modest VRAM.
  balanced: {
    shadowSize: 512,
    reflectionSize: 1024,
    reflectionSamples: 4,
    pcfMode: 1,           // 4-tap diagonal PCF
    waterBlur: 2,         // wide soft sample + mip bias
    maxPixelRatio: 1,
    shadowStrength: 0.86,
    puddleSegments: 56,
    puddleRings: 4,
    neonDetail: "balanced",
    antialias: true,      // smooth neon / sphere edges in the main view
    shadowInterval: 1,
    reflectionInterval: 1,
  },
  // Higher fidelity when a discrete GPU is available.
  high: {
    shadowSize: 1024,
    reflectionSize: 1536,
    reflectionSamples: 4,
    pcfMode: 2,           // 3x3 PCF
    waterBlur: 2,
    maxPixelRatio: 1.5,
    shadowStrength: 0.92,
    puddleSegments: 80,
    puddleRings: 5,
    neonDetail: "high",
    antialias: true,
    shadowInterval: 1,
    reflectionInterval: 1,
  },
};

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function vec3Normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function vec3Cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vec3Dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function mat4Multiply(a, b) {
  const output = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    const b0 = b[column * 4];
    const b1 = b[column * 4 + 1];
    const b2 = b[column * 4 + 2];
    const b3 = b[column * 4 + 3];
    output[column * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    output[column * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    output[column * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    output[column * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return output;
}

export function mat4Perspective(fieldOfView, aspect, near, far) {
  const output = new Float32Array(16);
  const f = 1 / Math.tan(fieldOfView / 2);
  output[0] = f / aspect;
  output[5] = f;
  output[10] = (far + near) / (near - far);
  output[11] = -1;
  output[14] = (2 * far * near) / (near - far);
  return output;
}

export function mat4Orthographic(left, right, bottom, top, near, far) {
  const output = new Float32Array(16);
  output[0] = 2 / (right - left);
  output[5] = 2 / (top - bottom);
  output[10] = -2 / (far - near);
  output[12] = -(right + left) / (right - left);
  output[13] = -(top + bottom) / (top - bottom);
  output[14] = -(far + near) / (far - near);
  output[15] = 1;
  return output;
}

export function mat4LookAt(eye, target, up) {
  const zAxis = vec3Normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const xAxis = vec3Normalize(vec3Cross(up, zAxis));
  const yAxis = vec3Cross(zAxis, xAxis);
  const output = new Float32Array(16);
  output[0] = xAxis[0];
  output[1] = yAxis[0];
  output[2] = zAxis[0];
  output[4] = xAxis[1];
  output[5] = yAxis[1];
  output[6] = zAxis[1];
  output[8] = xAxis[2];
  output[9] = yAxis[2];
  output[10] = zAxis[2];
  output[12] = -vec3Dot(xAxis, eye);
  output[13] = -vec3Dot(yAxis, eye);
  output[14] = -vec3Dot(zAxis, eye);
  output[15] = 1;
  return output;
}

export function makeModel(position, scale, rotationY = 0, rotationZ = 0) {
  const output = new Float32Array(16);
  const cy = Math.cos(rotationY);
  const sy = Math.sin(rotationY);
  const cz = Math.cos(rotationZ);
  const sz = Math.sin(rotationZ);
  const sx = scale[0];
  const syScale = scale[1];
  const szScale = scale[2];
  output[0] = cy * cz * sx;
  output[1] = sz * sx;
  output[2] = -sy * cz * sx;
  output[4] = cy * -sz * syScale;
  output[5] = cz * syScale;
  output[6] = sy * sz * syScale;
  output[8] = sy * szScale;
  output[9] = 0;
  output[10] = cy * szScale;
  output[12] = position[0];
  output[13] = position[1];
  output[14] = position[2];
  output[15] = 1;
  return output;
}

// ---------------------------------------------------------------------------
// Shader sources (mediump-friendly, quality uniforms for sample counts)
// ---------------------------------------------------------------------------

function litVertexShader() {
  return `#version 300 es
precision mediump float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform mat4 uLightViewProjection;
out vec3 vWorldPosition;
out vec3 vNormal;
out vec2 vUV;
out vec4 vShadowPosition;
void main() {
  vec4 worldPosition = uModel * vec4(aPosition, 1.0);
  vWorldPosition = worldPosition.xyz;
  vNormal = normalize(mat3(uModel) * aNormal);
  vUV = aUV;
  vShadowPosition = uLightViewProjection * worldPosition;
  gl_Position = uViewProjection * worldPosition;
}`;
}

function litFragmentShader() {
  return `#version 300 es
precision mediump float;
in vec3 vWorldPosition;
in vec3 vNormal;
in vec2 vUV;
in vec4 vShadowPosition;
uniform sampler2D uTexture;
uniform sampler2D uShadowMap;
uniform vec4 uBaseColor;
uniform vec3 uLightPosition;
uniform vec3 uLightColor;
uniform vec3 uNeonPosition;
uniform vec3 uNeonColor;
uniform vec3 uCameraPosition;
uniform vec3 uEmissive;
uniform float uShadowStrength;
uniform float uNeonIntensity;
uniform float uTextureEnabled;
uniform float uReceiveShadow;
uniform float uGloss;
uniform float uShadowTexel;
uniform float uPcfMode;
uniform float uClipBelowY;
out vec4 outColor;

float sampleShadow(vec3 shadowCoord, float bias, vec2 offset) {
  float depth = texture(uShadowMap, shadowCoord.xy + offset * uShadowTexel).r;
  return shadowCoord.z - bias > depth ? 1.0 : 0.0;
}

float shadowAmount(vec3 normal, vec3 toLight) {
  vec3 shadowCoord = vShadowPosition.xyz / vShadowPosition.w;
  shadowCoord = shadowCoord * 0.5 + 0.5;
  if (shadowCoord.z > 1.0 || shadowCoord.x < 0.0 || shadowCoord.x > 1.0 || shadowCoord.y < 0.0 || shadowCoord.y > 1.0) {
    return 0.0;
  }
  float bias = max(0.0018 * (1.0 - dot(normal, toLight)), 0.0004);
  int mode = int(uPcfMode + 0.5);
  if (mode <= 0) {
    return sampleShadow(shadowCoord, bias, vec2(0.0));
  }
  if (mode == 1) {
    // 4-tap diagonal — soft enough, half the cost of 3x3.
    float occluded = sampleShadow(shadowCoord, bias, vec2(-0.7, -0.7));
    occluded += sampleShadow(shadowCoord, bias, vec2(0.7, -0.7));
    occluded += sampleShadow(shadowCoord, bias, vec2(-0.7, 0.7));
    occluded += sampleShadow(shadowCoord, bias, vec2(0.7, 0.7));
    return occluded * 0.25;
  }
  float occluded = 0.0;
  for (int x = -1; x <= 1; x += 1) {
    for (int y = -1; y <= 1; y += 1) {
      occluded += sampleShadow(shadowCoord, bias, vec2(float(x), float(y)));
    }
  }
  return occluded / 9.0;
}

void main() {
  // Mirror pass: discard geometry below the water plane so the reflection RT
  // does not pick up undersides / floor-adjacent noise from odd angles.
  if (uClipBelowY < 1e20 && vWorldPosition.y < uClipBelowY) discard;
  vec3 textureColor = texture(uTexture, vUV).rgb;
  vec3 albedo = uBaseColor.rgb * mix(vec3(1.0), textureColor, uTextureEnabled);
  vec3 normal = normalize(vNormal);
  vec3 toLight = normalize(uLightPosition - vWorldPosition);
  vec3 toCamera = normalize(uCameraPosition - vWorldPosition);
  float distanceToLight = length(uLightPosition - vWorldPosition);
  float attenuation = 1.0 / (1.0 + distanceToLight * 0.032);
  float wrap = max(dot(normal, toLight) * 0.85 + 0.15, 0.0);
  float shadow = shadowAmount(normal, toLight) * uReceiveShadow * uShadowStrength;
  vec3 halfVector = normalize(toLight + toCamera);
  float specular = pow(max(dot(normal, halfVector), 0.0), uGloss) * 0.28;
  float fresnel = pow(1.0 - max(dot(normal, toCamera), 0.0), 3.0);
  vec3 toNeon = normalize(uNeonPosition - vWorldPosition);
  float distanceToNeon = length(uNeonPosition - vWorldPosition);
  float neonAttenuation = uNeonIntensity / (1.0 + distanceToNeon * distanceToNeon * 0.16);
  float neonDiffuse = max(dot(normal, toNeon), 0.0);
  float neonSpecular = pow(max(dot(normal, normalize(toNeon + toCamera)), 0.0), 48.0) * 0.34;
  vec3 ambient = vec3(0.08, 0.12, 0.16);
  vec3 lit = albedo * (ambient + uLightColor * wrap * attenuation * (1.0 - shadow));
  lit += albedo * uNeonColor * neonDiffuse * neonAttenuation;
  lit += uLightColor * specular * (1.0 - shadow * 0.45);
  lit += uNeonColor * neonSpecular * neonAttenuation;
  lit += uEmissive;
  lit += albedo * vec3(0.04, 0.08, 0.1) * fresnel;
  // Cheap height fog for depth and atmosphere.
  float fog = smoothstep(4.0, 16.0, length(uCameraPosition - vWorldPosition));
  lit = mix(lit, vec3(0.02, 0.045, 0.07), fog * 0.55);
  lit = lit / (lit + vec3(0.85));
  lit = pow(lit, vec3(0.92));
  outColor = vec4(lit, uBaseColor.a);
}`;
}

function depthVertexShader() {
  return `#version 300 es
precision mediump float;
layout(location = 0) in vec3 aPosition;
uniform mat4 uModel;
uniform mat4 uLightViewProjection;
void main() {
  gl_Position = uLightViewProjection * uModel * vec4(aPosition, 1.0);
}`;
}

function depthFragmentShader() {
  return `#version 300 es
precision mediump float;
void main() { }`;
}

function waterVertexShader() {
  return `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform mat4 uReflectionViewProjection;
uniform float uTime;
uniform float uPlaneY;
out vec3 vWorldPosition;
out vec3 vNormal;
out vec4 vReflectionClipPosition;
out float vRadial;
void main() {
  float radial = aUV.x;
  float interior = 1.0 - radial;
  float dome = interior * interior * 0.055;
  vec2 wave = vec2(
    sin(aPosition.z * 2.0 + uTime * 0.68) * 0.55 + sin(aPosition.x * 1.35 + aPosition.z * 0.9 + uTime * 0.4) * 0.45,
    cos(aPosition.x * 1.75 - uTime * 0.58) * 0.55 + cos(aPosition.z * 1.25 - aPosition.x * 0.7 - uTime * 0.36) * 0.45
  );
  float ripple = (wave.x * 0.014 + wave.y * 0.011) * interior;
  vec3 local = vec3(aPosition.x, aPosition.y + dome + ripple, aPosition.z);
  vec3 localNormal = normalize(vec3(
    -aPosition.x * 0.05 * interior - wave.x * 0.07 * interior,
    1.0,
    -aPosition.z * 0.07 * interior - wave.y * 0.07 * interior
  ));
  vec4 worldPosition = uModel * vec4(local, 1.0);
  vWorldPosition = worldPosition.xyz;
  vNormal = normalize(mat3(uModel) * localNormal);
  // Sample the planar mirror, not the displaced dome — otherwise side/grazing
  // views shear neon letters away from their true mirror points.
  vec4 planePosition = vec4(worldPosition.x, uPlaneY, worldPosition.z, 1.0);
  vReflectionClipPosition = uReflectionViewProjection * planePosition;
  vRadial = radial;
  gl_Position = uViewProjection * worldPosition;
}`;
}

function waterFragmentShader() {
  return `#version 300 es
precision highp float;
in vec3 vWorldPosition;
in vec3 vNormal;
in vec4 vReflectionClipPosition;
in float vRadial;
uniform sampler2D uReflectionTexture;
uniform vec3 uCameraPosition;
uniform vec3 uLightPosition;
uniform vec3 uNeonPosition;
uniform vec3 uNeonColor;
uniform vec3 uWaterColor;
uniform float uTime;
uniform float uNeonIntensity;
uniform float uOpacity;
uniform float uTexelSize;
uniform float uWaterBlur;
out vec4 outColor;

vec2 softWave(vec2 p, float t) {
  return vec2(
    sin(p.y * 1.7 + t * 0.55) * 0.62 + sin(p.x * 1.1 + p.y * 0.7 + t * 0.32) * 0.38,
    cos(p.x * 1.5 - t * 0.48) * 0.62 + cos(p.y * 1.1 - p.x * 0.6 - t * 0.28) * 0.38
  );
}

// Soft multi-tap sample + mip bias so bright neon edges do not stair-step.
vec3 sampleReflection(vec2 uv, float texel, float mode, float extraLod) {
  float lodBias = (mode < 1.5 ? 0.7 : 1.05) + extraLod;
  vec2 o = vec2(texel * (mode < 1.5 ? 1.35 : 2.05) * (1.0 + extraLod * 0.4));
  vec3 color = texture(uReflectionTexture, uv, lodBias).rgb * 0.28;
  color += texture(uReflectionTexture, uv + vec2(o.x, 0.0), lodBias).rgb * 0.12;
  color += texture(uReflectionTexture, uv - vec2(o.x, 0.0), lodBias).rgb * 0.12;
  color += texture(uReflectionTexture, uv + vec2(0.0, o.y), lodBias).rgb * 0.12;
  color += texture(uReflectionTexture, uv - vec2(0.0, o.y), lodBias).rgb * 0.12;
  // Rotated taps catch diagonal neon strokes that axis-aligned samples miss.
  vec2 r = o * 0.72;
  color += texture(uReflectionTexture, uv + vec2(r.x, r.y), lodBias).rgb * 0.06;
  color += texture(uReflectionTexture, uv + vec2(-r.x, r.y), lodBias).rgb * 0.06;
  color += texture(uReflectionTexture, uv + vec2(r.x, -r.y), lodBias).rgb * 0.06;
  color += texture(uReflectionTexture, uv + vec2(-r.x, -r.y), lodBias).rgb * 0.06;
  if (mode < 1.5) return color;
  vec2 d = o * 1.35;
  color = color * 0.78;
  color += texture(uReflectionTexture, uv + d, lodBias).rgb * 0.055;
  color += texture(uReflectionTexture, uv - d, lodBias).rgb * 0.055;
  color += texture(uReflectionTexture, uv + vec2(d.x, -d.y), lodBias).rgb * 0.055;
  color += texture(uReflectionTexture, uv + vec2(-d.x, d.y), lodBias).rgb * 0.055;
  return color;
}

void main() {
  vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
  float interior = 1.0 - vRadial;
  // Keep undulation gentle so reflection texels are not sheared into jaggies.
  vec2 wave = softWave(vWorldPosition.xz, uTime) * (0.18 + interior * 0.35);
  vec3 surfaceNormal = normalize(vNormal + vec3(wave.x * 0.022, 0.0, wave.y * 0.022));
  float facing = clamp(dot(surfaceNormal, viewDirection), 0.0, 1.0);
  float clipW = max(vReflectionClipPosition.w, 1e-4);
  vec2 reflectionUV = vReflectionClipPosition.xy / clipW * 0.5 + 0.5;
  // Almost no UV shear at grazing — small warps become large sideways slips.
  reflectionUV += wave * 0.00055 * interior * facing * facing;
  // Soft border fade: grazing angles push UVs toward the map edge — blend to tint
  // instead of hard-clamping into a harsh seam.
  float edge = min(min(reflectionUV.x, reflectionUV.y), min(1.0 - reflectionUV.x, 1.0 - reflectionUV.y));
  float edgeFade = smoothstep(0.0, 0.09, edge) * step(0.0, vReflectionClipPosition.w);
  reflectionUV = clamp(reflectionUV, vec2(0.003), vec2(0.997));
  // Stronger fresnel at grazing so side views still read as wet glass.
  float fresnel = pow(1.0 - facing, 2.15);
  float grazing = pow(1.0 - facing, 3.2);
  vec3 reflection = sampleReflection(reflectionUV, uTexelSize, uWaterBlur, grazing * 0.75);
  vec3 lightDirection = normalize(uLightPosition - vWorldPosition);
  float glint = pow(max(dot(reflect(-lightDirection, surfaceNormal), viewDirection), 0.0), 80.0);
  vec3 neonDirection = normalize(uNeonPosition - vWorldPosition);
  float neonDistance = length(uNeonPosition - vWorldPosition);
  float neonGlint = pow(max(dot(reflect(-neonDirection, surfaceNormal), viewDirection), 0.0), 90.0);
  float neonFalloff = uNeonIntensity / (1.0 + neonDistance * neonDistance * 0.16);
  vec3 deepTint = uWaterColor * 1.35;
  vec3 rimTint = mix(uWaterColor, vec3(0.06, 0.1, 0.09), 0.45);
  vec3 tint = mix(rimTint, deepTint, interior * interior);
  reflection = mix(tint, reflection, edgeFade);
  float reflectAmount = 0.58 + fresnel * 0.36 + interior * 0.05 + grazing * 0.08;
  reflectAmount *= mix(0.82, 1.0, edgeFade);
  vec3 surface = mix(tint, reflection, clamp(reflectAmount, 0.0, 0.96));
  surface += vec3(0.5, 0.68, 0.62) * glint * (0.12 + interior * 0.14 + grazing * 0.08);
  surface += uNeonColor * neonGlint * neonFalloff * (0.28 + interior * 0.18);
  surface = surface / (surface + vec3(0.9));
  surface = pow(surface, vec3(0.9));
  float body = smoothstep(1.0, 0.36, vRadial);
  float meniscus = smoothstep(1.0, 0.68, vRadial);
  float alpha = uOpacity * mix(0.06, 1.0, pow(body, 0.72)) * mix(0.18, 1.0, meniscus);
  // Slightly lift opacity at grazing so the sheet does not vanish from the side.
  alpha = clamp(alpha + grazing * 0.08 * interior, 0.0, 1.0);
  if (alpha < 0.012) discard;
  outColor = vec4(surface, alpha);
}`;
}

// ---------------------------------------------------------------------------
// GL helpers + mesh builders
// ---------------------------------------------------------------------------

export function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(error || "Shader compilation failed.");
  }
  return shader;
}

export function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Program link failed.");
  }
  return program;
}

export function makeMesh(gl, vertices, indices) {
  const vao = gl.createVertexArray();
  const vertexBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  const stride = 8 * Float32Array.BYTES_PER_ELEMENT;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * Float32Array.BYTES_PER_ELEMENT);
  gl.bindVertexArray(null);
  return { vao, count: indices.length };
}

export function buildCube(gl) {
  const faces = [
    { normal: [0, 0, 1], points: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { normal: [0, 0, -1], points: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { normal: [1, 0, 0], points: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { normal: [-1, 0, 0], points: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { normal: [0, 1, 0], points: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { normal: [0, -1, 0], points: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ];
  const vertices = [];
  const indices = [];
  faces.forEach((face, faceIndex) => {
    face.points.forEach((point, pointIndex) => {
      const uv = [[0, 0], [1, 0], [1, 1], [0, 1]][pointIndex];
      vertices.push(...point, ...face.normal, ...uv);
    });
    const offset = faceIndex * 4;
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  });
  return makeMesh(gl, vertices, indices);
}

export function buildPlane(gl) {
  return makeMesh(gl, [
    -1, 0, -1, 0, 1, 0, 0, 0,
    1, 0, -1, 0, 1, 0, 12, 0,
    1, 0, 1, 0, 1, 0, 12, 12,
    -1, 0, 1, 0, 1, 0, 0, 12,
  ], [0, 2, 1, 0, 3, 2]);
}

export function buildPuddle(gl, segments = 64, rings = 4) {
  const radiusX = 2.45;
  const radiusZ = 1.52;
  const vertices = [0, 0.03, 0, 0, 1, 0, 0, 0.5];
  const indices = [];
  for (let ring = 1; ring <= rings; ring += 1) {
    const radial = ring / rings;
    for (let index = 0; index <= segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      const wobble = 1
        + 0.04 * Math.sin(angle * 2 + 0.35)
        + 0.025 * Math.sin(angle * 3 - 1.05)
        + 0.015 * Math.cos(angle * 5 + 0.8);
      const x = Math.cos(angle) * radiusX * wobble * radial;
      const z = Math.sin(angle) * radiusZ * wobble * radial;
      const cup = (1 - radial) * (1 - radial) * 0.03;
      vertices.push(x, cup, z, 0, 1, 0, radial, index / segments);
    }
  }
  for (let index = 0; index < segments; index += 1) {
    indices.push(0, index + 1, index + 2);
  }
  for (let ring = 0; ring < rings - 1; ring += 1) {
    for (let index = 0; index < segments; index += 1) {
      const current = 1 + ring * (segments + 1) + index;
      const next = current + segments + 1;
      indices.push(current, next, current + 1, current + 1, next, next + 1);
    }
  }
  return makeMesh(gl, vertices, indices);
}

export function buildSphere(gl, rings = 12, segments = 18) {
  const vertices = [];
  const indices = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const v = ring / rings;
    const phi = v * Math.PI;
    for (let segment = 0; segment <= segments; segment += 1) {
      const u = segment / segments;
      const theta = u * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      vertices.push(x, y, z, x, y, z, u, v);
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const current = ring * (segments + 1) + segment;
      const next = current + segments + 1;
      indices.push(current, next, current + 1, current + 1, next, next + 1);
    }
  }
  return makeMesh(gl, vertices, indices);
}

export function createTexture(gl, draw, size = 128) {
  const image = document.createElement("canvas");
  image.width = size;
  image.height = size;
  const textureContext = image.getContext("2d");
  draw(textureContext, image.width, image.height);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return texture;
}

// Bake many transformed unit-cubes into one mesh so letter strokes share a draw.
export function mergeCubeInstances(gl, instances) {
  const unit = [
    // position + normal + uv per face corner (same layout as buildCube)
    [[-1, -1, 1], [0, 0, 1], [0, 0]], [[1, -1, 1], [0, 0, 1], [1, 0]], [[1, 1, 1], [0, 0, 1], [1, 1]], [[-1, 1, 1], [0, 0, 1], [0, 1]],
    [[1, -1, -1], [0, 0, -1], [0, 0]], [[-1, -1, -1], [0, 0, -1], [1, 0]], [[-1, 1, -1], [0, 0, -1], [1, 1]], [[1, 1, -1], [0, 0, -1], [0, 1]],
    [[1, -1, 1], [1, 0, 0], [0, 0]], [[1, -1, -1], [1, 0, 0], [1, 0]], [[1, 1, -1], [1, 0, 0], [1, 1]], [[1, 1, 1], [1, 0, 0], [0, 1]],
    [[-1, -1, -1], [-1, 0, 0], [0, 0]], [[-1, -1, 1], [-1, 0, 0], [1, 0]], [[-1, 1, 1], [-1, 0, 0], [1, 1]], [[-1, 1, -1], [-1, 0, 0], [0, 1]],
    [[-1, 1, 1], [0, 1, 0], [0, 0]], [[1, 1, 1], [0, 1, 0], [1, 0]], [[1, 1, -1], [0, 1, 0], [1, 1]], [[-1, 1, -1], [0, 1, 0], [0, 1]],
    [[-1, -1, -1], [0, -1, 0], [0, 0]], [[1, -1, -1], [0, -1, 0], [1, 0]], [[1, -1, 1], [0, -1, 0], [1, 1]], [[-1, -1, 1], [0, -1, 0], [0, 1]],
  ];
  const faceIndex = [0, 1, 2, 0, 2, 3];
  const vertices = [];
  const indices = [];
  let base = 0;
  instances.forEach((instance) => {
    const matrix = makeModel(instance.position, instance.scale, instance.rotation || 0, instance.rotationZ || 0);
    const normalMatrix = [
      [matrix[0], matrix[1], matrix[2]],
      [matrix[4], matrix[5], matrix[6]],
      [matrix[8], matrix[9], matrix[10]],
    ];
    for (let face = 0; face < 6; face += 1) {
      for (let corner = 0; corner < 4; corner += 1) {
        const [px, py, pz] = unit[face * 4 + corner][0];
        const [nx, ny, nz] = unit[face * 4 + corner][1];
        const [u, v] = unit[face * 4 + corner][2];
        const wx = matrix[0] * px + matrix[4] * py + matrix[8] * pz + matrix[12];
        const wy = matrix[1] * px + matrix[5] * py + matrix[9] * pz + matrix[13];
        const wz = matrix[2] * px + matrix[6] * py + matrix[10] * pz + matrix[14];
        const nnx = normalMatrix[0][0] * nx + normalMatrix[1][0] * ny + normalMatrix[2][0] * nz;
        const nny = normalMatrix[0][1] * nx + normalMatrix[1][1] * ny + normalMatrix[2][1] * nz;
        const nnz = normalMatrix[0][2] * nx + normalMatrix[1][2] * ny + normalMatrix[2][2] * nz;
        const inv = 1 / (Math.hypot(nnx, nny, nnz) || 1);
        vertices.push(wx, wy, wz, nnx * inv, nny * inv, nnz * inv, u, v);
      }
      faceIndex.forEach((offset) => indices.push(base + offset));
      base += 4;
    }
  });
  return makeMesh(gl, vertices, indices);
}

export function recommendContextOptions(qualityName = "balanced") {
  const preset = QUALITY_PRESETS[qualityName] || QUALITY_PRESETS.balanced;
  return {
    alpha: false,
    antialias: preset.antialias,
    powerPreference: "low-power",
    desynchronized: true,
  };
}

// ---------------------------------------------------------------------------
// Renderer factory
// ---------------------------------------------------------------------------

export function createImageBasedRT(gl, options = {}) {
  if (!gl) throw new Error("WebGL2 context is required.");

  let qualityName = options.quality || "balanced";
  let preset = { ...QUALITY_PRESETS[qualityName] };
  let shadowTarget = null;
  let reflectionTarget = null;

  const renderProgram = createProgram(gl, litVertexShader(), litFragmentShader());
  const depthProgram = createProgram(gl, depthVertexShader(), depthFragmentShader());
  const waterProgram = createProgram(gl, waterVertexShader(), waterFragmentShader());

  const renderUniforms = {
    model: gl.getUniformLocation(renderProgram, "uModel"),
    viewProjection: gl.getUniformLocation(renderProgram, "uViewProjection"),
    lightViewProjection: gl.getUniformLocation(renderProgram, "uLightViewProjection"),
    texture: gl.getUniformLocation(renderProgram, "uTexture"),
    shadowMap: gl.getUniformLocation(renderProgram, "uShadowMap"),
    baseColor: gl.getUniformLocation(renderProgram, "uBaseColor"),
    lightPosition: gl.getUniformLocation(renderProgram, "uLightPosition"),
    lightColor: gl.getUniformLocation(renderProgram, "uLightColor"),
    neonPosition: gl.getUniformLocation(renderProgram, "uNeonPosition"),
    neonColor: gl.getUniformLocation(renderProgram, "uNeonColor"),
    cameraPosition: gl.getUniformLocation(renderProgram, "uCameraPosition"),
    emissive: gl.getUniformLocation(renderProgram, "uEmissive"),
    shadowStrength: gl.getUniformLocation(renderProgram, "uShadowStrength"),
    neonIntensity: gl.getUniformLocation(renderProgram, "uNeonIntensity"),
    textureEnabled: gl.getUniformLocation(renderProgram, "uTextureEnabled"),
    receiveShadow: gl.getUniformLocation(renderProgram, "uReceiveShadow"),
    gloss: gl.getUniformLocation(renderProgram, "uGloss"),
    shadowTexel: gl.getUniformLocation(renderProgram, "uShadowTexel"),
    pcfMode: gl.getUniformLocation(renderProgram, "uPcfMode"),
    clipBelowY: gl.getUniformLocation(renderProgram, "uClipBelowY"),
  };

  const depthUniforms = {
    model: gl.getUniformLocation(depthProgram, "uModel"),
    lightViewProjection: gl.getUniformLocation(depthProgram, "uLightViewProjection"),
  };

  const waterUniforms = {
    model: gl.getUniformLocation(waterProgram, "uModel"),
    viewProjection: gl.getUniformLocation(waterProgram, "uViewProjection"),
    reflectionViewProjection: gl.getUniformLocation(waterProgram, "uReflectionViewProjection"),
    reflectionTexture: gl.getUniformLocation(waterProgram, "uReflectionTexture"),
    cameraPosition: gl.getUniformLocation(waterProgram, "uCameraPosition"),
    lightPosition: gl.getUniformLocation(waterProgram, "uLightPosition"),
    neonPosition: gl.getUniformLocation(waterProgram, "uNeonPosition"),
    neonColor: gl.getUniformLocation(waterProgram, "uNeonColor"),
    waterColor: gl.getUniformLocation(waterProgram, "uWaterColor"),
    time: gl.getUniformLocation(waterProgram, "uTime"),
    planeY: gl.getUniformLocation(waterProgram, "uPlaneY"),
    neonIntensity: gl.getUniformLocation(waterProgram, "uNeonIntensity"),
    opacity: gl.getUniformLocation(waterProgram, "uOpacity"),
    texelSize: gl.getUniformLocation(waterProgram, "uTexelSize"),
    waterBlur: gl.getUniformLocation(waterProgram, "uWaterBlur"),
  };

  function makeShadowTarget(size) {
    if (shadowTarget) {
      gl.deleteFramebuffer(shadowTarget.framebuffer);
      gl.deleteTexture(shadowTarget.texture);
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Shadow framebuffer is incomplete.");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    shadowTarget = { framebuffer, texture, size };
  }

  function makeReflectionTarget(size) {
    if (reflectionTarget) {
      gl.deleteFramebuffer(reflectionTarget.framebuffer);
      if (reflectionTarget.resolveFramebuffer && reflectionTarget.resolveFramebuffer !== reflectionTarget.framebuffer) {
        gl.deleteFramebuffer(reflectionTarget.resolveFramebuffer);
      }
      gl.deleteTexture(reflectionTarget.texture);
      if (reflectionTarget.depthBuffer) gl.deleteRenderbuffer(reflectionTarget.depthBuffer);
      if (reflectionTarget.msColor) gl.deleteRenderbuffer(reflectionTarget.msColor);
      if (reflectionTarget.msDepth) gl.deleteRenderbuffer(reflectionTarget.msDepth);
    }

    const maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;
    const wanted = preset.reflectionSamples || 0;
    const samples = wanted > 0 && maxSamples >= 2 ? Math.min(wanted, maxSamples) : 0;

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    // Mipmaps + LOD bias in the water shader soften jagged neon edges.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);

    const resolveFramebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    let framebuffer = resolveFramebuffer;
    let depthBuffer = null;
    let msColor = null;
    let msDepth = null;

    if (samples >= 2) {
      // Render into a multisampled FBO, then blit → texture for smoother neon edges.
      msColor = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, msColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, size, size);
      msDepth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, msDepth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, size, size);
      framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColor);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    } else {
      depthBuffer = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, size, size);
      gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFramebuffer);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Reflection framebuffer is incomplete.");
    }
    if (samples >= 2) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFramebuffer);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("Reflection resolve framebuffer is incomplete.");
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    reflectionTarget = {
      framebuffer,
      resolveFramebuffer,
      texture,
      depthBuffer,
      msColor,
      msDepth,
      samples,
      size,
    };
  }

  function resolveReflection() {
    if (reflectionTarget.samples >= 2) {
      const size = reflectionTarget.size;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, reflectionTarget.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, reflectionTarget.resolveFramebuffer);
      gl.blitFramebuffer(0, 0, size, size, 0, 0, size, size, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.bindTexture(gl.TEXTURE_2D, reflectionTarget.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  function allocateTargets() {
    makeShadowTarget(preset.shadowSize);
    makeReflectionTarget(preset.reflectionSize);
  }

  function setQuality(name) {
    if (!QUALITY_PRESETS[name]) throw new Error(`Unknown quality preset: ${name}`);
    qualityName = name;
    preset = { ...QUALITY_PRESETS[name] };
    allocateTargets();
    return preset;
  }

  function buildOrbitCamera({ yaw, pitch, distance, target, aspect, bounds }) {
    const horizontal = Math.cos(pitch) * distance;
    const cameraPosition = [
      target[0] + Math.sin(yaw) * horizontal,
      target[1] + Math.sin(pitch) * distance,
      target[2] + Math.cos(yaw) * horizontal,
    ];
    if (bounds) {
      cameraPosition[0] = clamp(cameraPosition[0], bounds.minX, bounds.maxX);
      cameraPosition[1] = clamp(cameraPosition[1], bounds.minY, bounds.maxY);
      cameraPosition[2] = clamp(cameraPosition[2], bounds.minZ, bounds.maxZ);
    }
    const projection = mat4Perspective(Math.PI / 3.2, aspect, 0.1, 40);
    const view = mat4LookAt(cameraPosition, target, [0, 1, 0]);
    return { cameraPosition, viewProjection: mat4Multiply(projection, view), target };
  }

  function buildMirroredCamera(camera, target, _aspect, planeY = 0) {
    const reflectedPosition = [
      camera.cameraPosition[0],
      planeY - (camera.cameraPosition[1] - planeY),
      camera.cameraPosition[2],
    ];
    const reflectedTarget = [target[0], planeY - (target[1] - planeY), target[2]];
    // Reflection target is always square — use aspect 1.0 so side/grazing views
    // are not stretched by the main viewport aspect ratio.
    const camHeight = Math.max(0.2, Math.abs(camera.cameraPosition[1] - planeY));
    // Wider FOV when the eye is low so neon/sign stay inside the capture cone.
    const fov =
      camHeight < 1.8 ? Math.PI / 2.25 :
      camHeight < 2.8 ? Math.PI / 2.5 :
      camHeight < 4.0 ? Math.PI / 2.7 :
      Math.PI / 2.9;
    const projection = mat4Perspective(fov, 1.0, 0.08, 48);
    const view = mat4LookAt(reflectedPosition, reflectedTarget, [0, -1, 0]);
    return { cameraPosition: reflectedPosition, viewProjection: mat4Multiply(projection, view) };
  }

  function buildOrthoLight({ position, lookAt = [0, 1.2, -1], halfExtent = 9 }) {
    const lightView = mat4LookAt(position, lookAt, [0, 1, 0]);
    const lightProjection = mat4Orthographic(-halfExtent, halfExtent, -halfExtent, halfExtent, 0.1, 22);
    return {
      lightPosition: position,
      lightViewProjection: mat4Multiply(lightProjection, lightView),
    };
  }

  function drawObject(program, uniforms, object, isDepth = false) {
    const model = makeModel(object.position, object.scale, object.rotation || 0, object.rotationZ || 0);
    gl.uniformMatrix4fv(uniforms.model, false, model);
    if (isDepth) {
      gl.bindVertexArray(object.mesh.vao);
      gl.drawElements(gl.TRIANGLES, object.mesh.count, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
      return;
    }
    gl.uniform4fv(uniforms.baseColor, object.color);
    gl.uniform3fv(uniforms.emissive, object.emissive || [0, 0, 0]);
    gl.uniform1f(uniforms.receiveShadow, object.receive ? 1 : 0);
    gl.uniform1f(uniforms.gloss, object.gloss || 48);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, object.texture);
    gl.uniform1i(uniforms.texture, 0);
    gl.bindVertexArray(object.mesh.vao);
    gl.drawElements(gl.TRIANGLES, object.mesh.count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  function renderDepth(light, objects, objectFilter) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowTarget.framebuffer);
    gl.viewport(0, 0, shadowTarget.size, shadowTarget.size);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.useProgram(depthProgram);
    gl.uniformMatrix4fv(depthUniforms.lightViewProjection, false, light.lightViewProjection);
    objects.forEach((object) => {
      if (objectFilter(object) && object.cast) drawObject(depthProgram, depthUniforms, object, true);
    });
    gl.cullFace(gl.BACK);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function renderOpaque({
    canvas,
    camera,
    light,
    localLight,
    objects,
    floorObject,
    framebuffer,
    includeFloor,
    textureEnabled,
    debugMarker,
    clearColor = [0.028, 0.055, 0.075, 1],
    lightColor = [1.0, 0.76, 0.58],
    clipBelowY = null,
  }) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    if (framebuffer) {
      gl.viewport(0, 0, reflectionTarget.size, reflectionTarget.size);
    } else {
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(renderProgram);
    gl.uniformMatrix4fv(renderUniforms.viewProjection, false, camera.viewProjection);
    gl.uniformMatrix4fv(renderUniforms.lightViewProjection, false, light.lightViewProjection);
    gl.uniform3fv(renderUniforms.lightPosition, light.lightPosition);
    gl.uniform3fv(renderUniforms.lightColor, lightColor);
    gl.uniform1f(renderUniforms.clipBelowY, clipBelowY == null ? 1e21 : clipBelowY);
    gl.uniform3fv(renderUniforms.neonPosition, localLight.position);
    gl.uniform3fv(renderUniforms.neonColor, localLight.color);
    gl.uniform1f(renderUniforms.neonIntensity, localLight.intensity);
    gl.uniform3fv(renderUniforms.cameraPosition, camera.cameraPosition);
    gl.uniform1f(renderUniforms.shadowStrength, preset.shadowStrength);
    gl.uniform1f(renderUniforms.textureEnabled, textureEnabled ? 1 : 0);
    gl.uniform1f(renderUniforms.shadowTexel, 1 / shadowTarget.size);
    gl.uniform1f(renderUniforms.pcfMode, preset.pcfMode);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shadowTarget.texture);
    gl.uniform1i(renderUniforms.shadowMap, 1);
    objects.forEach((object) => {
      if (!object.enabled) return;
      if (!includeFloor && object === floorObject) return;
      drawObject(renderProgram, renderUniforms, object, false);
    });
    if (!framebuffer && debugMarker) {
      drawObject(renderProgram, renderUniforms, debugMarker, false);
    }
  }

  function drawWater({
    canvas,
    camera,
    reflectionCamera,
    light,
    localLight,
    water,
    time,
  }) {
    if (!water) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(waterProgram);
    gl.uniformMatrix4fv(waterUniforms.model, false, makeModel(water.position, water.scale));
    gl.uniformMatrix4fv(waterUniforms.viewProjection, false, camera.viewProjection);
    gl.uniformMatrix4fv(waterUniforms.reflectionViewProjection, false, reflectionCamera.viewProjection);
    gl.uniform3fv(waterUniforms.cameraPosition, camera.cameraPosition);
    gl.uniform3fv(waterUniforms.lightPosition, light.lightPosition);
    gl.uniform3fv(waterUniforms.neonPosition, localLight.position);
    gl.uniform3fv(waterUniforms.neonColor, localLight.color);
    gl.uniform3fv(waterUniforms.waterColor, water.color || [0.014, 0.085, 0.11]);
    gl.uniform1f(waterUniforms.time, time);
    gl.uniform1f(waterUniforms.planeY, water.planeY ?? 0);
    gl.uniform1f(waterUniforms.neonIntensity, localLight.intensity);
    gl.uniform1f(waterUniforms.opacity, water.opacity ?? 0.94);
    gl.uniform1f(waterUniforms.texelSize, 1 / reflectionTarget.size);
    gl.uniform1f(waterUniforms.waterBlur, preset.waterBlur);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, reflectionTarget.texture);
    gl.uniform1i(waterUniforms.reflectionTexture, 2);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(water.mesh.vao);
    gl.drawElements(gl.TRIANGLES, water.mesh.count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  let frameIndex = 0;
  let lastShadowKey = "";
  let lastReflectionKey = "";
  let lastReflectionCamera = null;

  /**
   * Full frame: shadow depth -> mirrored reflection image -> main color -> water.
   * Shadow/reflection passes can refresh on an interval when the view is stable,
   * which keeps frame time lower on integrated GPUs.
   */
  function renderFrame(frame) {
    const {
      canvas,
      camera,
      light,
      localLight,
      objects,
      floorObject = null,
      water = null,
      textureEnabled = true,
      debugMarker = null,
      time = 0,
      aspect,
      clearColor = [0.018, 0.04, 0.06, 1],
    } = frame;

    frameIndex += 1;
    const reflectionCamera = buildMirroredCamera(camera, camera.target || [0, 0, 0], aspect, water?.planeY ?? 0);
    const enabledObjects = objects;

    const shadowKey = `${light.lightPosition[0].toFixed(2)},${light.lightPosition[2].toFixed(2)}`;
    const reflectionKey = [
      camera.cameraPosition[0].toFixed(2),
      camera.cameraPosition[1].toFixed(2),
      camera.cameraPosition[2].toFixed(2),
      (camera.target || [0, 0, 0]).map((v) => v.toFixed(2)).join(","),
      localLight.intensity.toFixed(1),
      textureEnabled ? 1 : 0,
    ].join("|");

    const shadowDirty = shadowKey !== lastShadowKey;
    const reflectionDirty = reflectionKey !== lastReflectionKey;
    const runShadow = shadowDirty || frameIndex % (preset.shadowInterval || 1) === 0;
    const runReflection = reflectionDirty || frameIndex % (preset.reflectionInterval || 1) === 0;

    if (runShadow) {
      renderDepth(light, enabledObjects, (object) => object.enabled !== false);
      lastShadowKey = shadowKey;
    }

    if (runReflection) {
      const planeY = water?.planeY ?? 0;
      renderOpaque({
        canvas,
        camera: reflectionCamera,
        light,
        localLight,
        objects: enabledObjects,
        floorObject,
        framebuffer: reflectionTarget.framebuffer,
        includeFloor: false,
        textureEnabled,
        debugMarker: null,
        clearColor,
        clipBelowY: planeY + 0.02,
      });
      resolveReflection();
      lastReflectionKey = reflectionKey;
      lastReflectionCamera = reflectionCamera;
    }

    renderOpaque({
      canvas,
      camera,
      light,
      localLight,
      objects: enabledObjects,
      floorObject,
      framebuffer: null,
      includeFloor: true,
      textureEnabled,
      debugMarker,
      clearColor,
    });
    drawWater({
      canvas,
      camera,
      reflectionCamera: lastReflectionCamera || reflectionCamera,
      light,
      localLight,
      water,
      time,
    });

    return {
      shadowSize: shadowTarget.size,
      reflectionSize: reflectionTarget.size,
      quality: qualityName,
      skippedShadow: !runShadow,
      skippedReflection: !runReflection,
    };
  }

  allocateTargets();

  return {
    gl,
    get quality() { return qualityName; },
    get preset() { return { ...preset }; },
    get shadowTarget() { return shadowTarget; },
    get reflectionTarget() { return reflectionTarget; },
    setQuality,
    allocateTargets,
    buildOrbitCamera,
    buildMirroredCamera,
    buildOrthoLight,
    renderFrame,
    makeMesh: (vertices, indices) => makeMesh(gl, vertices, indices),
    buildCube: () => buildCube(gl),
    buildPlane: () => buildPlane(gl),
    buildSphere: (rings, segments) => buildSphere(gl, rings, segments),
    buildPuddle: (segments, rings) => buildPuddle(gl, segments ?? preset.puddleSegments, rings ?? preset.puddleRings),
    mergeCubeInstances: (instances) => mergeCubeInstances(gl, instances),
    createTexture: (draw, size) => createTexture(gl, draw, size),
    makeModel,
    clamp,
  };
}
