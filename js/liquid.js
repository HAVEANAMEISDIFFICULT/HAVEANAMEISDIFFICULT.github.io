/**
 * Liquid Space — client interactions
 * Vanilla JS only. UI via classList; coordinates via CSS variables.
 */
(function () {
  'use strict';

  var config = window.LIQUID_CONFIG || {};
  var i18n = config.i18n || {};

  /* ---------- RAF-safe listeners ---------- */
  function onRafPassive(target, type, handler) {
    var ticking = false;
    target.addEventListener(
      type,
      function () {
        if (!ticking) {
          window.requestAnimationFrame(function () {
            handler();
            ticking = false;
          });
          ticking = true;
        }
      },
      { passive: true }
    );
  }

  /* ---------- Specular / ray-tracing illusion ---------- */
  function setSpecularPos(el, e) {
    var rect = el.getBoundingClientRect();
    el.style.setProperty('--mouse-x', e.clientX - rect.left + 'px');
    el.style.setProperty('--mouse-y', e.clientY - rect.top + 'px');
  }

  function initSpecular(root) {
    var nodes = root.querySelectorAll('.liquid-specular');
    nodes.forEach(function (el) {
      el.addEventListener(
        'mouseenter',
        function (e) {
          setSpecularPos(el, e);
          el.classList.add('is-lit');
        },
        { passive: true }
      );

      el.addEventListener(
        'mousemove',
        function (e) {
          setSpecularPos(el, e);
          if (!el.classList.contains('is-lit')) {
            el.classList.add('is-lit');
          }
        },
        { passive: true }
      );

      el.addEventListener(
        'mouseleave',
        function () {
          el.classList.remove('is-lit');
        },
        { passive: true }
      );
    });
  }

  /* ---------- Floating nav collapse on scroll ---------- */
  function initNavScroll() {
    var nav = document.getElementById('nav-capsule');
    if (!nav) return;

    var collapsed = false;
    var syncTimer = 0;

    function notifyLayoutChange() {
      // Soft-follow the indicator while labels/padding ease (~550ms)
      var start = performance.now();
      var duration = 620;

      function frame(now) {
        nav.dispatchEvent(new CustomEvent('liquid:navlayout'));
        if (now - start < duration) {
          window.requestAnimationFrame(frame);
        }
      }

      window.requestAnimationFrame(frame);
      window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(function () {
        nav.dispatchEvent(new CustomEvent('liquid:navlayout'));
      }, duration + 60);
    }

    onRafPassive(window, 'scroll', function () {
      var shouldCollapse = window.scrollY > 120;
      if (shouldCollapse !== collapsed) {
        collapsed = shouldCollapse;
        nav.classList.toggle('nav-collapsed', collapsed);
        notifyLayoutChange();
      }
    });
  }

  /* ---------- Reading progress ---------- */
  function initReadingProgress() {
    var bar = document.getElementById('reading-progress');
    if (!bar) return;

    onRafPassive(window, 'scroll', function () {
      var doc = document.documentElement;
      var scrollable = doc.scrollHeight - window.innerHeight;
      var progress = scrollable > 0 ? window.scrollY / scrollable : 0;
      bar.style.setProperty('--progress', Math.min(1, Math.max(0, progress)));
    });
  }

  /* ---------- Floating TOC panel ---------- */
  function initToc() {
    var toggle = document.getElementById('toc-toggle');
    var panel = document.getElementById('toc-panel');
    if (!toggle || !panel) return;

    function openPanel() {
      panel.classList.remove('hidden');
      toggle.classList.add('bg-white/25');
      toggle.setAttribute('aria-expanded', 'true');
      panel.dispatchEvent(new CustomEvent('liquid:tocopen'));
    }

    function closePanel() {
      panel.classList.add('hidden');
      toggle.classList.remove('bg-white/25');
      toggle.setAttribute('aria-expanded', 'false');
    }

    toggle.addEventListener('click', function () {
      if (panel.classList.contains('hidden')) openPanel();
      else closePanel();
    });

    document.addEventListener('click', function (e) {
      if (
        !panel.classList.contains('hidden') &&
        !panel.contains(e.target) &&
        !toggle.contains(e.target)
      ) {
        closePanel();
      }
    });
  }

  /* ---------- Vertical Apple-style TOC indicator + scroll spy ---------- */
  function initTocIndicator() {
    var root = document.getElementById('toc-root');
    var indicator = document.getElementById('toc-indicator');
    var panel = document.getElementById('toc-panel');
    if (!root || !indicator || !panel) return;

    var links = Array.prototype.slice.call(root.querySelectorAll('.toc-link'));
    if (!links.length) return;

    var busy = false;
    var currentId = null;

    function headingFor(link) {
      var href = link.getAttribute('href') || '';
      if (href.charAt(0) !== '#') return null;
      return document.getElementById(decodeURIComponent(href.slice(1)));
    }

    function measure(el) {
      var rootRect = root.getBoundingClientRect();
      var r = el.getBoundingClientRect();
      return {
        left: r.left - rootRect.left + root.scrollLeft,
        top: r.top - rootRect.top + root.scrollTop,
        width: r.width,
        height: r.height,
      };
    }

    function applyGeom(m, instant) {
      if (instant) indicator.classList.add('is-instant');
      indicator.style.left = Math.round(m.left) + 'px';
      indicator.style.top = Math.round(m.top) + 'px';
      indicator.style.width = Math.round(m.width) + 'px';
      indicator.style.height = Math.round(m.height) + 'px';
      if (instant) {
        void indicator.offsetWidth;
        indicator.classList.remove('is-instant');
      }
    }

    function setActiveLink(link) {
      links.forEach(function (item) {
        item.removeAttribute('aria-current');
      });
      if (link) link.setAttribute('aria-current', 'true');
    }

    function keepInView(link) {
      if (panel.classList.contains('hidden')) return;
      var m = measure(link);
      var viewTop = root.scrollTop;
      var viewBottom = viewTop + root.clientHeight;
      var pad = 8;
      if (m.top < viewTop + pad) {
        root.scrollTop = Math.max(0, m.top - pad);
      } else if (m.top + m.height > viewBottom - pad) {
        root.scrollTop = m.top + m.height - root.clientHeight + pad;
      }
    }

    function place(link, mode) {
      if (!link) return;
      var m = measure(link);

      if (mode === 'instant') {
        indicator.classList.remove('is-boost');
        applyGeom(m, true);
        indicator.classList.add('is-on');
        return;
      }

      indicator.classList.add('is-on');

      if (mode === 'switch') {
        // Apple: expand → slide → settle
        indicator.classList.add('is-boost');
        window.setTimeout(function () {
          applyGeom(m, false);
        }, 90);
        window.setTimeout(function () {
          indicator.classList.remove('is-boost');
        }, 300);
        return;
      }

      // follow: smooth slide without extra boost
      indicator.classList.remove('is-boost');
      applyGeom(m, false);
    }

    function pickActiveHeading() {
      var offset = 140;
      var active = links[0];
      for (var i = 0; i < links.length; i++) {
        var h = headingFor(links[i]);
        if (!h) continue;
        if (h.getBoundingClientRect().top <= offset) {
          active = links[i];
        }
      }
      return active;
    }

    function syncFromScroll() {
      if (busy || panel.classList.contains('hidden')) return;
      var link = pickActiveHeading();
      if (!link) return;
      var href = link.getAttribute('href');
      if (href === currentId) {
        keepInView(link);
        return;
      }
      currentId = href;
      setActiveLink(link);
      place(link, 'follow');
      keepInView(link);
    }

    links.forEach(function (link) {
      link.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var heading = headingFor(link);
        if (!heading) return;
        e.preventDefault();

        var href = link.getAttribute('href');
        if (href === currentId) {
          heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }

        busy = true;
        root.classList.add('toc-busy');
        currentId = href;
        setActiveLink(link);
        place(link, 'switch');
        keepInView(link);

        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.setTimeout(function () {
          busy = false;
          root.classList.remove('toc-busy');
        }, 360);
      });
    });

    // Place without motion when panel is visible (open / resize)
    function placeInstant() {
      if (panel.classList.contains('hidden')) return;
      var link = root.querySelector('.toc-link[aria-current="true"]');
      if (!link) link = pickActiveHeading();
      currentId = link ? link.getAttribute('href') : null;
      setActiveLink(link);
      if (link) {
        place(link, 'instant');
        keepInView(link);
      }
    }

    panel.addEventListener('liquid:tocopen', placeInstant);

    window.addEventListener(
      'resize',
      function () {
        if (!busy) placeInstant();
      },
      { passive: true }
    );

    onRafPassive(window, 'scroll', syncFromScroll);
  }

  /* ---------- Hero typewriter ---------- */
  function initTypewriter() {
    var nodes = document.querySelectorAll('[data-typewriter]');
    if (!nodes.length) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    var pending = [];
    nodes.forEach(function (el) {
      pending.push({
        el: el,
        text: el.textContent,
        delay: parseInt(el.getAttribute('data-typewriter-delay') || '0', 10) || 0,
      });
      el.textContent = '';
    });

    // Chain: each span finishes before the next starts
    var index = 0;
    var charMs = 55;

    function typeOne(item, done) {
      item.el.classList.add('is-typing');
      window.setTimeout(function () {
        var i = 0;
        function tick() {
          if (i <= item.text.length) {
            item.el.textContent = item.text.slice(0, i);
            i += 1;
            window.setTimeout(tick, charMs);
            return;
          }
          item.el.classList.remove('is-typing');
          item.el.classList.add('is-done');
          done();
        }
        tick();
      }, item.delay);
    }

    function next() {
      if (index >= pending.length) return;
      var item = pending[index];
      index += 1;
      typeOne(item, next);
    }

    next();
  }

  /* ---------- Code copy capsule ---------- */
  function initCopyCode() {
    if (config.enableCopy === false) return;

    var blocks = document.querySelectorAll('.prose-liquid pre');
    blocks.forEach(function (pre) {
      if (pre.dataset.copyReady) return;
      pre.dataset.copyReady = '1';

      pre.classList.add('liquid-code');
      pre.style.position = 'relative';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'liquid-badge absolute right-3 top-3 z-10 cursor-pointer border-0 text-badge text-slate-200 transition hover:bg-white/15';
      btn.textContent = i18n.copy || 'Copy';
      btn.addEventListener('click', function () {
        var code = pre.querySelector('code');
        var text = code ? code.innerText : pre.innerText;

        function done(ok) {
          btn.textContent = ok
            ? i18n.copy_success || 'Copied'
            : i18n.copy_failed || 'Failed';
          btn.classList.add(ok ? 'bg-white/20' : 'bg-red-400/20');
          window.setTimeout(function () {
            btn.textContent = i18n.copy || 'Copy';
            btn.classList.remove('bg-white/20', 'bg-red-400/20');
          }, 1600);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            done(true);
          }).catch(function () {
            done(false);
          });
        } else {
          done(false);
        }
      });

      pre.appendChild(btn);
    });
  }

  /* ---------- Reveal on enter viewport ---------- */
  function initReveal() {
    if (!('IntersectionObserver' in window)) return;

    var targets = document.querySelectorAll('.liquid-card, .liquid-capsule, .liquid-reading');
    if (!targets.length) return;

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );

    targets.forEach(function (el) {
      el.classList.add('will-change-transform');
      io.observe(el);
    });
  }

  /* ---------- Soft image fade for content images ---------- */
  function initImageFade() {
    var imgs = document.querySelectorAll('.prose-liquid img');
    imgs.forEach(function (img) {
      if (img.complete) return;
      img.style.opacity = '0';
      img.style.transition = 'opacity 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
      img.addEventListener(
        'load',
        function () {
          img.style.opacity = '1';
        },
        { once: true }
      );
    });
  }

  /* ---------- Aurora parallax (living background) ---------- */
  function initAuroraParallax() {
    var shift = document.querySelector('.aurora-shift');
    if (!shift) return;

    var targetX = 0;
    var targetY = 0;
    var currentX = 0;
    var currentY = 0;
    var raf = 0;

    function tick() {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      shift.style.setProperty('--aurora-x', currentX.toFixed(2));
      shift.style.setProperty('--aurora-y', currentY.toFixed(2));
      if (
        Math.abs(targetX - currentX) > 0.05 ||
        Math.abs(targetY - currentY) > 0.05
      ) {
        raf = window.requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    }

    window.addEventListener(
      'mousemove',
      function (e) {
        var nx = e.clientX / window.innerWidth - 0.5;
        var ny = e.clientY / window.innerHeight - 0.5;
        // Subtle parallax range
        targetX = nx * -36;
        targetY = ny * -28;
        if (!raf) raf = window.requestAnimationFrame(tick);
      },
      { passive: true }
    );
  }

  /* ---------- Apple-style nav indicator ---------- */
  function initNavIndicator() {
    var nav = document.getElementById('nav-capsule');
    var indicator = document.getElementById('nav-indicator');
    if (!nav || !indicator) return;

    var items = nav.querySelectorAll('[data-nav-menu]');
    if (!items.length) return;

    var busy = false;

    function measure(el) {
      // offset* ignores CSS transforms (:active scale)
      var collapsed = nav.classList.contains('nav-collapsed');

      if (collapsed) {
        var bw = el.offsetWidth;
        var bh = el.offsetHeight;
        var size = Math.round(Math.min(bw, bh) + 2);
        return {
          left: Math.round(el.offsetLeft + (bw - size) / 2),
          top: Math.round(el.offsetTop + (bh - size) / 2),
          width: size,
          height: size,
          circle: true,
        };
      }

      return {
        left: el.offsetLeft,
        top: 7,
        width: el.offsetWidth,
        height: 52,
        circle: false,
      };
    }

    function applyGeom(m, instant) {
      if (instant) indicator.classList.add('is-instant');
      indicator.classList.toggle('is-circle', !!m.circle);
      indicator.style.left = m.left + 'px';
      indicator.style.top = m.top + 'px';
      indicator.style.width = m.width + 'px';
      indicator.style.height = m.height + 'px';
      if (instant) {
        void indicator.offsetWidth;
        indicator.classList.remove('is-instant');
      }
    }

    function place(el, mode) {
      var m = measure(el);

      if (mode === 'instant') {
        indicator.classList.remove('is-boost');
        applyGeom(m, true);
        indicator.classList.add('is-on');
        return;
      }

      indicator.classList.add('is-on');

      if (mode === 'switch') {
        // Apple: expand → slide → settle (click only)
        indicator.classList.add('is-boost');
        window.setTimeout(function () {
          applyGeom(m, false);
        }, 90);
        window.setTimeout(function () {
          indicator.classList.remove('is-boost');
        }, 300);
        return;
      }

      indicator.classList.remove('is-boost');
      applyGeom(m, false);
    }

    function activeItem() {
      return (
        nav.querySelector('[data-nav-menu][aria-current="page"]') || items[0]
      );
    }

    // Initial placement after layout
    window.requestAnimationFrame(function () {
      place(activeItem(), 'instant');
    });

    items.forEach(function (link) {
      link.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var href = link.getAttribute('href');
        if (!href || href.charAt(0) === '#') return;

        // Already active — no motion
        if (link.getAttribute('aria-current') === 'page') {
          e.preventDefault();
          return;
        }

        e.preventDefault();
        busy = true;
        nav.classList.add('nav-capsule-busy');
        place(link, 'switch');

        items.forEach(function (item) {
          item.removeAttribute('aria-current');
        });
        link.setAttribute('aria-current', 'page');

        window.setTimeout(function () {
          window.location.href = link.href;
        }, 360);
      });
    });

    window.addEventListener(
      'resize',
      function () {
        place(activeItem(), 'instant');
      },
      { passive: true }
    );

    // Track the active button tightly while collapse/expand animates
    nav.addEventListener('liquid:navlayout', function () {
      if (!busy) place(activeItem(), 'instant');
    });
  }

  /* ---------- Card press (no delayed navigation) ---------- */
  function initCardPress() {
    document.querySelectorAll('.liquid-card').forEach(function (card) {
      function press() {
        card.classList.add('is-pressed');
      }
      function release() {
        card.classList.remove('is-pressed');
      }

      card.addEventListener('pointerdown', press, { passive: true });
      card.addEventListener('pointerup', release, { passive: true });
      card.addEventListener('pointerleave', release, { passive: true });
      card.addEventListener('pointercancel', release, { passive: true });
    });
  }

  /* ---------- Boot ---------- */
  function boot() {
    initSpecular(document);
    initTypewriter();
    initNavScroll();
    initReadingProgress();
    initToc();
    initTocIndicator();
    initCopyCode();
    initReveal();
    initImageFade();
    initAuroraParallax();
    initNavIndicator();
    initCardPress();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
