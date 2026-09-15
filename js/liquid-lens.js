/**
 * Liquid lens — SVG feDisplacementMap refraction (Shu Ding technique).
 * Applied only to stable chrome (nav / hero). Cards stay on CSS frosted
 * glass: hover transform + will-change break backdrop-filter sampling
 * (dark bars, edge misalignment).
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XLINK_NS = 'http://www.w3.org/1999/xlink';
  var maps = {};
  var applied = false;

  function smoothStep(a, b, t) {
    t = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function length(x, y) {
    return Math.sqrt(x * x + y * y);
  }

  function roundedRectSDF(x, y, width, height, radius) {
    var qx = Math.abs(x) - width + radius;
    var qy = Math.abs(y) - height + radius;
    return (
      Math.min(Math.max(qx, qy), 0) +
      length(Math.max(qx, 0), Math.max(qy, 0)) -
      radius
    );
  }

  /** Rim-only inward refraction — no pinch-to-center, no out-of-bounds sample. */
  function lensFragment(uv, halfW, halfH, radiusNorm) {
    var ix = uv.x - 0.5;
    var iy = uv.y - 0.5;
    var distanceToEdge = roundedRectSDF(ix, iy, halfW, halfH, radiusNorm);
    var edge = smoothStep(0.14, 0.0, distanceToEdge);
    var pull = edge * 0.22;
    return {
      x: 0.5 + ix * (1 - pull),
      y: 0.5 + iy * (1 - pull),
    };
  }

  function buildDisplacementData(width, height, halfW, halfH, radiusNorm) {
    var count = width * height;
    var data = new Uint8ClampedArray(count * 4);
    var rawDx = new Float32Array(count);
    var rawDy = new Float32Array(count);
    var maxAbs = 0.5;
    var i;
    var x;
    var y;
    var pos;
    var dx;
    var dy;

    for (i = 0; i < count; i++) {
      x = i % width;
      y = (i / width) | 0;
      pos = lensFragment(
        { x: (x + 0.5) / width, y: (y + 0.5) / height },
        halfW,
        halfH,
        radiusNorm
      );
      dx = pos.x * width - x;
      dy = pos.y * height - y;
      rawDx[i] = dx;
      rawDy[i] = dy;
      if (Math.abs(dx) > maxAbs) maxAbs = Math.abs(dx);
      if (Math.abs(dy) > maxAbs) maxAbs = Math.abs(dy);
    }

    var scale = maxAbs;
    for (i = 0; i < count; i++) {
      data[i * 4] = (rawDx[i] / scale + 0.5) * 255;
      data[i * 4 + 1] = (rawDy[i] / scale + 0.5) * 255;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 255;
    }

    return { data: data, scale: scale };
  }

  function ensureSvgHost() {
    var host = document.getElementById('liquid-lens-host');
    if (host) return host;

    host = document.createElementNS(SVG_NS, 'svg');
    host.setAttribute('id', 'liquid-lens-host');
    host.setAttribute('xmlns', SVG_NS);
    host.setAttribute('width', '0');
    host.setAttribute('height', '0');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:-1;overflow:hidden';
    document.body.insertBefore(host, document.body.firstChild);
    return host;
  }

  /** Map resolution keeps aspect; never exceeds filter region. */
  function mapSize(w, h) {
    var maxSide = 192;
    var scale = Math.min(1, maxSide / Math.max(w, h));
    return {
      w: Math.max(24, Math.round(w * scale)),
      h: Math.max(16, Math.round(h * scale)),
    };
  }

  function ensureFilter(key, shape) {
    if (maps[key]) return maps[key].filterId;

    var host = ensureSvgHost();
    var filterId = 'liquid-lens-' + key;
    var mapId = filterId + '-map';
    var res = mapSize(shape.w, shape.h);

    var built = buildDisplacementData(
      res.w,
      res.h,
      shape.halfW,
      shape.halfH,
      shape.radius
    );

    var canvas = document.createElement('canvas');
    canvas.width = res.w;
    canvas.height = res.h;
    canvas
      .getContext('2d')
      .putImageData(new ImageData(built.data, res.w, res.h), 0, 0);

    var filter = document.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', filterId);
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    // Exact element box — larger regions cause edge misalignment
    filter.setAttribute('width', String(shape.w));
    filter.setAttribute('height', String(shape.h));

    var feImage = document.createElementNS(SVG_NS, 'feImage');
    feImage.setAttribute('id', mapId);
    feImage.setAttribute('width', String(shape.w));
    feImage.setAttribute('height', String(shape.h));
    feImage.setAttribute('preserveAspectRatio', 'none');
    var href = canvas.toDataURL();
    feImage.setAttributeNS(XLINK_NS, 'xlink:href', href);
    feImage.setAttribute('href', href);

    var feMap = document.createElementNS(SVG_NS, 'feDisplacementMap');
    feMap.setAttribute('in', 'SourceGraphic');
    feMap.setAttribute('in2', mapId);
    feMap.setAttribute('x-channel-selector', 'R');
    feMap.setAttribute('y-channel-selector', 'G');
    // Cap hard so we never sample outside the backdrop snapshot
    var safeScale = Math.min(built.scale, Math.min(shape.w, shape.h) * 0.08, 10);
    feMap.setAttribute('scale', String(safeScale));

    filter.appendChild(feImage);
    filter.appendChild(feMap);
    host.appendChild(filter);

    maps[key] = {
      filterId: filterId,
      cssValue:
        'url(#' +
        filterId +
        ') blur(0.25px) contrast(1.2) brightness(1.05) saturate(1.15)',
    };

    return maps[key].filterId;
  }

  function supportsSvgBackdrop() {
    if (typeof CSS === 'undefined' || !CSS.supports) return false;
    return (
      CSS.supports('backdrop-filter', 'url(#x)') ||
      CSS.supports('-webkit-backdrop-filter', 'url(#x)')
    );
  }

  function applyLensTo(el, key, shape) {
    ensureFilter(key, shape);
    var entry = maps[key];
    if (!entry) return;
    el.classList.add('has-liquid-lens');
    el.style.backdropFilter = entry.cssValue;
    el.style.webkitBackdropFilter = entry.cssValue;
  }

  var SHAPE_BY_KIND = {
    capsule: { halfW: 0.4, halfH: 0.26, radius: 0.5 },
    hero: { halfW: 0.42, halfH: 0.36, radius: 0.26 },
  };

  function applyLensMeasured(el, kind) {
    var rect = el.getBoundingClientRect();
    // Exact CSS pixels — no bucket overshoot
    var w = Math.max(40, Math.round(rect.width));
    var h = Math.max(24, Math.round(rect.height));
    var base = SHAPE_BY_KIND[kind];
    if (!base) return;

    applyLensTo(el, kind + '_' + w + 'x' + h, {
      w: w,
      h: h,
      halfW: base.halfW,
      halfH: base.halfH,
      radius: base.radius,
    });
  }

  function clearLens(el) {
    el.classList.remove('has-liquid-lens');
    el.style.backdropFilter = '';
    el.style.webkitBackdropFilter = '';
  }

  function measureAndApply() {
    if (!supportsSvgBackdrop()) {
      document.documentElement.classList.add('no-svg-lens');
      return;
    }

    document.documentElement.classList.remove('no-svg-lens');

    var nav = document.getElementById('nav-capsule');
    if (nav) applyLensMeasured(nav, 'capsule');

    document.querySelectorAll('[data-lens="hero"]').forEach(function (el) {
      applyLensMeasured(el, 'hero');
    });

    applied = true;
  }

  function boot() {
    // Wait a frame so layout/fonts settle before measuring
    window.requestAnimationFrame(function () {
      measureAndApply();
    });

    var resizeTimer = 0;
    window.addEventListener(
      'resize',
      function () {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function () {
          window.LiquidLens.rebuild();
        }, 200);
      },
      { passive: true }
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.LiquidLens = {
    rebuild: function () {
      maps = {};
      var host = document.getElementById('liquid-lens-host');
      if (host) host.innerHTML = '';
      document.querySelectorAll('.has-liquid-lens').forEach(clearLens);
      measureAndApply();
    },
    supported: supportsSvgBackdrop,
    isApplied: function () {
      return applied;
    },
  };
})();
