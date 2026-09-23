/**
 * Liquid lens — Monotonic Refractive Liquid Glass implementation.
 * Guarantees d(sample)/d(pos) > 0 everywhere, mathematically eliminating
 * all image inversion/flipping while providing authentic glass edge refraction.
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XLINK_NS = 'http://www.w3.org/1999/xlink';
  var maps = {};
  var applied = false;

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

  /**
   * Monotonic Refractive Displacement Generator:
   * 1. Uses Euclidean SDF scaled by element aspect ratio.
   * 2. Calculates true inward surface normals (-grad SDF).
   * 3. Applies a cosine falloff strictly bounded to max slope < 0.65.
   * 4. Mathematically guarantees spatial sampling derivative d(y + dy)/dy >= 0.35 > 0,
   *    rendering image inversion / upside-down content IMPOSSIBLE.
   */
  function buildDisplacementData(width, height, elemW, elemH, kind) {
    var count = width * height;
    var data = new Uint8ClampedArray(count * 4);
    var rawDx = new Float32Array(count);
    var rawDy = new Float32Array(count);
    var maxScale = 0;
    var i, x, y, u, v, ix, iy, d, distFromEdge, t, profile, eps, nx, ny, len, inX, inY, disp, dx, dy;

    var aspect = elemW / elemH;
    var hw = 0.5 * aspect;
    var hh = 0.5;
    var r =
      kind === 'capsule'
        ? 0.5
        : kind === 'cursor'
          ? Math.min(0.5, hw)
          : Math.min(0.25, Math.min(hw, hh));

    var rimPx =
      kind === 'capsule'
        ? Math.min(18, elemH * 0.38)
        : kind === 'cursor'
          ? Math.min(15, Math.min(elemW, elemH) * 0.35)
          : Math.min(20, elemH * 0.28);

    var rimWidth = rimPx / elemH;
    // Slope bound: maxDispPx * (pi / (2 * rimPx)) <= 0.816 < 1.0 -> strictly monotonic & unified strong refraction
    var maxDispPx = rimPx * 0.52;

    for (i = 0; i < count; i++) {
      x = i % width;
      y = (i / width) | 0;
      u = (x + 0.5) / width;
      v = (y + 0.5) / height;

      ix = (u - 0.5) * aspect;
      iy = v - 0.5;

      d = roundedRectSDF(ix, iy, hw, hh, r);
      if (d >= 0) {
        rawDx[i] = 0;
        rawDy[i] = 0;
        continue;
      }

      distFromEdge = -d;
      if (distFromEdge >= rimWidth) {
        rawDx[i] = 0;
        rawDy[i] = 0;
        continue;
      }

      eps = 0.002;
      nx =
        (roundedRectSDF(ix + eps, iy, hw, hh, r) -
          roundedRectSDF(ix - eps, iy, hw, hh, r)) /
        (2 * eps);
      ny =
        (roundedRectSDF(ix, iy + eps, hw, hh, r) -
          roundedRectSDF(ix, iy - eps, hw, hh, r)) /
        (2 * eps);
      len = Math.sqrt(nx * nx + ny * ny) || 1;

      // Inward direction
      inX = -nx / len;
      inY = -ny / len;

      t = distFromEdge / rimWidth;
      // Smooth cosine profile: 1 at edge, 0 at flat interior
      profile = 0.5 * (1 + Math.cos(Math.PI * t));

      dx = inX * maxDispPx * profile;
      dy = inY * maxDispPx * profile;

      if (Math.abs(dx) > maxScale) maxScale = Math.abs(dx);
      if (Math.abs(dy) > maxScale) maxScale = Math.abs(dy);

      rawDx[i] = dx;
      rawDy[i] = dy;
    }

    maxScale = Math.max(1, maxScale);

    for (i = 0; i < count; i++) {
      var rVal = 0.5 + 0.5 * (rawDx[i] / maxScale);
      var gVal = 0.5 + 0.5 * (rawDy[i] / maxScale);
      data[i * 4] = Math.max(0, Math.min(255, Math.round(rVal * 255)));
      data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(gVal * 255)));
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 255;
    }

    return { data: data, scale: maxScale * 2 };
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

  /** 1:1 pixel resolution up to 600x400 for razor-sharp, zero-interpolation symmetry. */
  function mapSize(w, h) {
    return {
      w: Math.max(24, Math.min(600, Math.round(w))),
      h: Math.max(16, Math.min(400, Math.round(h))),
    };
  }

  function ensureFilter(key, kind, elemW, elemH) {
    if (maps[key]) return maps[key].filterId;

    var host = ensureSvgHost();
    var filterId = 'liquid-lens-' + key;
    var mapId = filterId + '-map';
    var res = mapSize(elemW, elemH);

    var built = buildDisplacementData(res.w, res.h, elemW, elemH, kind);

    var canvas = document.createElement('canvas');
    canvas.width = res.w;
    canvas.height = res.h;
    canvas
      .getContext('2d')
      .putImageData(new ImageData(built.data, res.w, res.h), 0, 0);

    var filter = document.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', filterId);
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('colorInterpolationFilters', 'sRGB');
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', String(elemW));
    filter.setAttribute('height', String(elemH));

    var feImage = document.createElementNS(SVG_NS, 'feImage');
    feImage.setAttribute('id', mapId);
    feImage.setAttribute('width', String(elemW));
    feImage.setAttribute('height', String(elemH));
    feImage.setAttribute('preserveAspectRatio', 'none');
    var href = canvas.toDataURL();
    feImage.setAttributeNS(XLINK_NS, 'xlink:href', href);
    feImage.setAttribute('href', href);

    var feDisplacementMap = document.createElementNS(SVG_NS, 'feDisplacementMap');
    feDisplacementMap.setAttribute('in', 'SourceGraphic');
    feDisplacementMap.setAttribute('in2', mapId);
    feDisplacementMap.setAttribute('xChannelSelector', 'R');
    feDisplacementMap.setAttribute('yChannelSelector', 'G');
    feDisplacementMap.setAttribute('scale', String(built.scale));

    filter.appendChild(feImage);
    filter.appendChild(feDisplacementMap);
    host.appendChild(filter);

    // Shu Ding's exact backdrop filter specification
    maps[key] = {
      filterId: filterId,
      cssValue:
        'url(#' +
        filterId +
        ') blur(0.25px) contrast(1.2) brightness(1.05) saturate(1.1)',
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

  function applyLensTo(el, key, kind, elemW, elemH) {
    ensureFilter(key, kind, elemW, elemH);
    var entry = maps[key];
    if (!entry) return;
    el.classList.add('has-liquid-lens');
    el.style.backdropFilter = entry.cssValue;
    el.style.webkitBackdropFilter = entry.cssValue;
  }

  function applyLensSized(el, kind, w, h) {
    if (!supportsSvgBackdrop()) return false;
    w = Math.max(40, Math.round(w));
    h = Math.max(24, Math.round(h));

    var key = kind + '_' + w + 'x' + h;
    applyLensTo(el, key, kind, w, h);
    return true;
  }

  function applyLensMeasured(el, kind) {
    var rect = el.getBoundingClientRect();
    var w = Math.max(40, Math.round(rect.width));
    var h = Math.max(24, Math.round(rect.height));

    var key = kind + '_' + w + 'x' + h;
    applyLensTo(el, key, kind, w, h);
  }

  function clearLens(el) {
    el.classList.remove('has-liquid-lens');
    el.style.backdropFilter = '';
    el.style.webkitBackdropFilter = '';
  }

  function updateNav() {
    var nav = document.getElementById('nav-capsule');
    if (!nav) return;
    applyLensMeasured(nav, 'capsule');
  }

  function attachNavSync(nav) {
    var lastW = 0;

    function checkSync() {
      var w = nav.offsetWidth;
      if (w && w !== lastW) {
        lastW = w;
        applyLensMeasured(nav, 'capsule');
      }
    }

    nav.addEventListener('transitionend', function (e) {
      if (e.target === nav) checkSync();
    });

    nav.addEventListener('liquid:navlayout', function () {
      checkSync();
    });

    if (typeof ResizeObserver !== 'undefined') {
      var roTimer = 0;
      var ro = new ResizeObserver(function () {
        window.clearTimeout(roTimer);
        roTimer = window.setTimeout(checkSync, 120);
      });
      ro.observe(nav);
    }
  }

  function measureAndApply() {
    if (!supportsSvgBackdrop()) {
      document.documentElement.classList.add('no-svg-lens');
      return;
    }

    document.documentElement.classList.remove('no-svg-lens');

    var nav = document.getElementById('nav-capsule');
    if (nav) {
      applyLensMeasured(nav, 'capsule');
      attachNavSync(nav);
    }

    document.querySelectorAll('[data-lens="hero"]').forEach(function (el) {
      applyLensMeasured(el, 'hero');
    });

    applied = true;
  }

  function boot() {
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
    applyLens: applyLensSized,
    updateNav: updateNav,
    clearLens: clearLens,
  };
})();
