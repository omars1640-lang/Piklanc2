const host = document.getElementById("heroLiquidEther");

if (host) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

  if (reducedMotion.matches) {
    host.classList.add("is-static");
  } else {
    startLiquidEther(host, finePointer.matches);
  }
}

function startLiquidEther(container, allowPointerInteraction) {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
    premultipliedAlpha: true
  });

  if (!gl) {
    container.classList.add("is-static");
    return;
  }

  const vertexSource = `
    attribute vec2 aPosition;
    void main() {
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const fragmentSource = `
    precision highp float;

    uniform vec2 uResolution;
    uniform vec2 uPointer;
    uniform float uPointerActive;
    uniform float uTime;
    uniform vec3 uColor0;
    uniform vec3 uColor1;
    uniform vec3 uColor2;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.52;
      mat2 rotation = mat2(0.82, -0.57, 0.57, 0.82);
      for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p);
        p = rotation * p * 2.03 + 7.17;
        amplitude *= 0.5;
      }
      return value;
    }

    vec2 rotateAround(vec2 p, vec2 center, float angle) {
      float s = sin(angle);
      float c = cos(angle);
      mat2 rotation = mat2(c, -s, s, c);
      return center + rotation * (p - center);
    }

    void main() {
      vec2 resolution = max(uResolution, vec2(1.0));
      vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
      vec2 pointer = (uPointer * 2.0 - 1.0) * vec2(resolution.x / min(resolution.x, resolution.y), resolution.y / min(resolution.x, resolution.y));
      float time = uTime * 0.23;

      float pointerDistance = length(uv - pointer);
      float pointerSwirl = uPointerActive * exp(-pointerDistance * 1.9) * 0.72;
      uv = rotateAround(uv, pointer, pointerSwirl * sin(time * 2.2 + pointerDistance * 4.0));

      vec2 drift = vec2(time * 0.34, -time * 0.19);
      vec2 q = vec2(
        fbm(uv * 0.72 + drift),
        fbm(uv * 0.72 + vec2(5.2, 1.3) - drift * 0.76)
      );
      vec2 r = vec2(
        fbm(uv * 1.02 + q * 2.45 + vec2(1.7, 9.2) + drift * 0.42),
        fbm(uv * 1.02 + q * 2.15 + vec2(8.3, 2.8) - drift * 0.35)
      );

      float field = fbm(uv * 0.82 + r * 2.72 + q * 0.65);
      float ribbons = 0.5 + 0.5 * sin((field + q.x * 0.55 - q.y * 0.3) * 9.0 + time * 1.45);
      float body = smoothstep(0.3, 0.79, field + ribbons * 0.2);
      float veins = smoothstep(0.58, 0.93, ribbons) * smoothstep(0.26, 0.72, field);
      float pointerGlow = uPointerActive * exp(-pointerDistance * 2.8) * 0.4;

      float palette = clamp(field * 0.78 + q.x * 0.35, 0.0, 1.0);
      vec3 color = mix(uColor0, uColor1, smoothstep(0.18, 0.7, palette));
      color = mix(color, uColor2, smoothstep(0.62, 1.0, r.y + veins * 0.25));
      color += pointerGlow * mix(uColor1, uColor2, 0.45);

      float edgeFade = 1.0 - smoothstep(1.18, 2.25, length(uv * vec2(0.7, 0.82)));
      float alpha = clamp((body * 0.72 + veins * 0.27 + pointerGlow) * edgeFade, 0.0, 0.92);
      gl_FragColor = vec4(color * alpha, alpha);
    }
  `;

  const createShader = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vertexShader = createShader(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentSource);

  if (!vertexShader || !fragmentShader) {
    container.classList.add("is-static");
    return;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    container.classList.add("is-static");
    return;
  }

  gl.useProgram(program);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1
  ]), gl.STATIC_DRAW);

  const position = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    resolution: gl.getUniformLocation(program, "uResolution"),
    pointer: gl.getUniformLocation(program, "uPointer"),
    pointerActive: gl.getUniformLocation(program, "uPointerActive"),
    time: gl.getUniformLocation(program, "uTime"),
    color0: gl.getUniformLocation(program, "uColor0"),
    color1: gl.getUniformLocation(program, "uColor1"),
    color2: gl.getUniformLocation(program, "uColor2")
  };

  const palettes = {
    light: ["#7066d8", "#a966d0", "#e68e96"],
    dark: ["#3b3b94", "#7b41b8", "#c06262"]
  };

  const hexToRgb = (hex) => {
    const value = Number.parseInt(hex.slice(1), 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  };

  const updatePalette = () => {
    const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    palettes[theme].map(hexToRgb).forEach((color, index) => {
      gl.uniform3fv([uniforms.color0, uniforms.color1, uniforms.color2][index], color);
    });
  };

  const pointer = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5, active: 0, targetActive: 0 };
  const startedAt = performance.now();
  let frameId = 0;
  let isVisible = true;
  let isPageVisible = !document.hidden;
  let firstFrame = true;

  const resize = () => {
    const rect = container.getBoundingClientRect();
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    const tablet = window.matchMedia("(max-width: 1100px)").matches;
    const quality = mobile ? 0.52 : tablet ? 0.62 : 0.76;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.35);
    const width = Math.max(1, Math.round(rect.width * quality * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * quality * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uniforms.resolution, width, height);
    }
  };

  const render = (now) => {
    if (!isVisible || !isPageVisible) {
      frameId = 0;
      return;
    }

    const elapsed = (now - startedAt) / 1000;
    pointer.x += (pointer.targetX - pointer.x) * 0.09;
    pointer.y += (pointer.targetY - pointer.y) * 0.09;
    pointer.active += (pointer.targetActive - pointer.active) * 0.08;

    gl.uniform1f(uniforms.time, elapsed);
    gl.uniform2f(uniforms.pointer, pointer.x, pointer.y);
    gl.uniform1f(uniforms.pointerActive, pointer.active);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (firstFrame) {
      firstFrame = false;
      container.classList.add("is-ready");
    }
    frameId = requestAnimationFrame(render);
  };

  const resume = () => {
    if (!frameId && isVisible && isPageVisible) frameId = requestAnimationFrame(render);
  };

  const onPointerMove = (event) => {
    if (!allowPointerInteraction || event.pointerType === "touch") return;
    const rect = container.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    pointer.targetActive = inside ? 1 : 0;
    if (!inside) return;
    pointer.targetX = (event.clientX - rect.left) / rect.width;
    pointer.targetY = 1 - ((event.clientY - rect.top) / rect.height);
  };

  const resizeObserver = new ResizeObserver(resize);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    isVisible = entry.isIntersecting;
    if (isVisible) resume();
  }, { rootMargin: "100px" });
  const themeObserver = new MutationObserver(updatePalette);

  container.appendChild(canvas);
  updatePalette();
  resize();
  resizeObserver.observe(container);
  intersectionObserver.observe(container);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  if (allowPointerInteraction) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", () => { pointer.targetActive = 0; }, { passive: true });
  }

  document.addEventListener("visibilitychange", () => {
    isPageVisible = !document.hidden;
    if (isPageVisible) resume();
  });

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    container.classList.remove("is-ready");
    container.classList.add("is-static");
  });

  resume();
}
