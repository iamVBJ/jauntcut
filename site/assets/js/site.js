// Jauntcut site. No dependencies.
// - nav turns solid after the hero starts scrolling
// - headings split into words that rise in; [data-reveal] blocks fade up
// - the hero reel drives the timeline: playhead, active shot, timecode, beat counter,
//   pulse and audio meters, all at the song's 128 BPM
// - pinned layer scenes separate in 3D as you scroll through them
// - vision readings cycle; reels tilt and play on tap; counters, render log, terminal
(function () {
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var play = function (v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); };
  var BPM = 128, BEAT = 60 / BPM;

  // ---------- Nav ----------
  var nav = $('.nav');
  var navTick = function () { nav.classList.toggle('solid', window.scrollY > 40); };
  window.addEventListener('scroll', navTick, { passive: true }); navTick();

  // ---------- Split headings into words ----------
  $$('[data-split]').forEach(function (h) {
    var i = 0, out = document.createDocumentFragment();
    var addWords = function (text, cls) {
      text.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { out.appendChild(document.createTextNode(' ')); return; }
        var w = document.createElement('span'); w.className = 'w';
        var s = document.createElement('span'); s.textContent = part; s.style.setProperty('--i', i++);
        if (cls) s.className = cls;
        w.appendChild(s); out.appendChild(w);
      });
    };
    Array.prototype.slice.call(h.childNodes).forEach(function (n) {
      if (n.nodeType === 3) addWords(n.textContent);
      else if (n.nodeName === 'BR') out.appendChild(n.cloneNode());
      else addWords(n.textContent, n.className);
    });
    h.setAttribute('aria-label', h.textContent.replace(/\s+/g, ' ').trim());
    h.textContent = ''; h.appendChild(out);
    h.classList.add('split');
    $$('.w', h).forEach(function (w) { w.setAttribute('aria-hidden', 'true'); });
  });

  // ---------- Reveal on scroll ----------
  var revealables = $$('[data-reveal], .split, [data-log], [data-term]');
  if ('IntersectionObserver' in window && !calm) {
    var rio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); rio.unobserve(e.target); } });
    }, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
    revealables.forEach(function (el) { rio.observe(el); });
  } else revealables.forEach(function (el) { el.classList.add('in'); });

  // ---------- Copy buttons ----------
  $$('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var code = btn.parentNode.querySelector('code');
      var text = code ? code.textContent : '';
      var done = function () {
        btn.textContent = 'Copied'; btn.classList.add('done');
        setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1800);
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () { select(code); });
      else select(code);
    });
  });
  function select(node) { var r = document.createRange(); r.selectNodeContents(node); var s = getSelection(); s.removeAllRanges(); s.addRange(r); }

  // ---------- Clips play only while on screen (muted). Reduced motion: posters only. ----------
  var reel = $('#hero-reel');
  if (!calm && 'IntersectionObserver' in window) {
    var vio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) { if (v.preload === 'none') v.preload = 'auto'; play(v); } else v.pause();
      });
    }, { threshold: 0.3 });
    $$('video[data-autoplay]').forEach(function (v) {
      if (v === reel) {
        new IntersectionObserver(function (es) {
          es.forEach(function (e) { if (e.isIntersecting) play(v); else v.pause(); });
        }, { threshold: 0.02 }).observe(v.closest('.hero'));
      } else vio.observe(v);
    });
  }

  // ---------- The timeline, driven by the hero reel ----------
  var head = $('#playhead'), tl = $('.timeline');
  var segs = $$('#track .seg');
  var files = $$('.bin .file');
  files.forEach(function (f, n) { f.style.setProperty('--n', n); });
  var tc = $('#hero-tc'), beatEl = $('#beat'), pulse = $('#pulse');
  var meters = $$('#meters i');
  var DUR = 21.1, NBEATS = Math.round(DUR / BEAT);

  // Beat grid over V1, a bar line every 4 beats.
  var beats = $('#beats');
  if (beats) for (var b = 1; b < NBEATS; b++) {
    var m = document.createElement('i'); m.style.left = (b * BEAT / DUR * 100) + '%';
    if (b % 4 === 0) m.className = 'bar'; beats.appendChild(m);
  }
  // A1: a waveform that peaks on every beat (illustrative, seeded so it's stable).
  var wave = $('#wave');
  if (wave) {
    var seed = 7, rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var N = 360, top = [], bot = [];
    for (var k = 0; k <= N; k++) {
      var t = k / N * DUR, ph = (t % BEAT) / BEAT;
      var env = Math.exp(-ph * 5) * .75 + .18 + rnd() * .22;
      if (Math.floor(t / BEAT) % 4 === 0) env *= 1.12;
      var a = Math.min(.96, env) * 50, x = (k / N * 1000).toFixed(1);
      top.push(x + ',' + (50 - a).toFixed(1)); bot.unshift(x + ',' + (50 + a * .9).toFixed(1));
    }
    wave.innerHTML = '<svg viewBox="0 0 1000 100" preserveAspectRatio="none"><path d="M' + top.join('L') + 'L' + bot.join('L') + 'Z"/></svg>';
  }

  if (reel && head) {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var lastBeat = -1, level = 0;
    var tick = function () {
      var t = reel.currentTime || 0, d = reel.duration || DUR;
      tl.style.setProperty('--t', Math.min(1, t / d).toFixed(4));
      var src = null;
      segs.forEach(function (s) { var on = t >= +s.dataset.from && t < +s.dataset.to; s.classList.toggle('on', on); if (on) src = s.dataset.file; });
      files.forEach(function (f) { f.classList.toggle('on', f.dataset.file === src); });
      if (tc) tc.textContent = '00:' + pad(Math.floor(t)) + ':' + pad(Math.floor((t % 1) * 60));
      var bi = Math.floor(t / BEAT);
      if (bi !== lastBeat) {
        lastBeat = bi; level = 1;
        if (beatEl) beatEl.textContent = pad(bi % 4 + 1);
        if (pulse) { pulse.classList.add('hit'); setTimeout(function () { pulse.classList.remove('hit'); }, 110); }
      }
      level *= 0.9;
      meters.forEach(function (mt, j) {
        var l = Math.max(.08, Math.min(1, level * (1 - j * .07) + Math.random() * .25));
        mt.style.setProperty('--l', l.toFixed(2));
      });
      if (!reel.paused) requestAnimationFrame(tick);
    };
    reel.addEventListener('play', function () { requestAnimationFrame(tick); });
    reel.addEventListener('seeked', tick);
    tick();
    segs.forEach(function (s) {
      s.addEventListener('click', function () { reel.currentTime = +s.dataset.from + 0.05; play(reel); });
    });
  }

  // ---------- Scroll-driven bits ----------
  var smooth = function (x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
  var pins = $$('[data-pin]').map(function (sec) {
    return { sec: sec, stack: $('[data-stack]', sec), notes: $$('[data-notes] li', sec), btn: $('[data-toggle]', sec), pinned: null };
  });
  var setStack = function (pin, p) {
    pin.stack.style.setProperty('--p', p.toFixed(3));
    var idx = Math.min(pin.notes.length - 1, Math.floor(p * pin.notes.length * 0.999));
    pin.notes.forEach(function (n, i) { n.classList.toggle('on', i === Math.max(0, idx)); });
  };
  pins.forEach(function (pin) {
    if (!pin.btn) return;
    pin.btn.addEventListener('click', function () {
      var apart = pin.btn.getAttribute('aria-pressed') !== 'true';
      pin.pinned = apart ? 1 : 0;
      pin.btn.setAttribute('aria-pressed', String(apart));
      pin.btn.textContent = apart ? 'Put them back' : 'Separate layers';
      setStack(pin, pin.pinned);
    });
  });

  var pipe = $('#pipeline'), steps = $$('#pipeline .step');
  var ticking = false;
  var onScroll = function () {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var vh = window.innerHeight;
      pins.forEach(function (pin) {
        if (pin.pinned !== null) return;
        var r = pin.sec.getBoundingClientRect();
        var span = r.height - vh, p;
        if (span > vh * 0.3) p = (-r.top) / span;              // pinned: progress through the sticky run
        else p = (vh - r.top) / (vh * 0.9 + r.height * 0.15);   // not pinned (small screens)
        setStack(pin, smooth(p * 1.15 - 0.05));
      });
      if (pipe) {
        var pr = pipe.getBoundingClientRect();
        // Starts once the steps are well on screen (top past 60% of the height), full by the time they reach 20%.
        var pp = Math.max(0, Math.min(1, (vh * 0.6 - pr.top) / (vh * 0.4)));
        pipe.style.setProperty('--p', pp.toFixed(3));
        steps.forEach(function (s, i) { s.classList.toggle('lit', pp > 0 && pp >= i / steps.length); });
      }
    });
  };
  if (!calm) { window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onScroll); onScroll(); }
  else { pins.forEach(function (p) { setStack(p, 0); }); steps.forEach(function (s) { s.classList.add('lit'); }); if (pipe) pipe.style.setProperty('--p', 1); }

  // ---------- Vision readings ----------
  var viewer = $('#viewer'), readings = $$('.reading'), vtag = $('#viewer-tag');
  if (viewer && readings.length) {
    // Each reading: the measurement for ANALYSE ms, then the effect it enables wipes in; next after DWELL.
    var rds = $$('.rd', viewer), cur = 0, timer = null, fxTimer = null, visible = false, picked = false;
    var ANALYSE = 1300, DWELL = 3400;
    viewer.parentNode.style.setProperty('--dur', DWELL + 'ms');
    var tag = function (i, fx) {
      if (!vtag) return;
      var r = rds[i];
      vtag.textContent = 'ABCD'[i] + ' · ' + (fx ? '→ ' + r.dataset.fx : r.dataset.an);
    };
    var show = function (i) {
      cur = i;
      clearTimeout(timer); clearTimeout(fxTimer);
      rds.forEach(function (r, j) { r.classList.toggle('on', j === i); r.classList.remove('fx-on'); });
      readings.forEach(function (r, j) {
        r.classList.remove('on'); r.setAttribute('aria-selected', String(j === i));
        if (j === i) { void r.offsetWidth; r.classList.add('on'); }
      });
      tag(i, false);
      var hasFx = !!rds[i].dataset.fx, dwell = hasFx ? DWELL : 2000;
      viewer.parentNode.style.setProperty('--dur', (picked ? 1 : dwell) + 'ms');
      if (calm) { if (hasFx) { rds[i].classList.add('fx-on'); tag(i, true); } return; }
      viewer.classList.remove('scanning'); void viewer.offsetWidth; viewer.classList.add('scanning');
      if (hasFx) fxTimer = setTimeout(function () { rds[i].classList.add('fx-on'); tag(i, true); }, ANALYSE);
      if (!picked && visible) timer = setTimeout(function () { show((cur + 1) % rds.length); }, dwell);
    };
    // A click stops the auto-cycle and holds that reading with its bar full.
    readings.forEach(function (r, i) {
      r.addEventListener('click', function () { picked = true; show(i); });
    });
    if ('IntersectionObserver' in window && !calm) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting && !visible) { visible = true; if (!picked) show(cur); }
          else if (!e.isIntersecting) { visible = false; clearTimeout(timer); }
        });
      }, { threshold: 0.4 }).observe(viewer);
    }
  }

  // ---------- Reels: tilt, tap to play, one at a time ----------
  var tiles = $$('.reel-btn');
  tiles.forEach(function (tile) {
    var v = $('video', tile);
    tile.addEventListener('click', function () {
      if (v.paused) {
        tiles.forEach(function (t) { if (t !== tile) { $('video', t).pause(); t.classList.remove('is-playing'); t.setAttribute('aria-pressed', 'false'); } });
        v.preload = 'auto'; play(v); tile.classList.add('is-playing'); tile.setAttribute('aria-pressed', 'true');
      } else { v.pause(); tile.classList.remove('is-playing'); tile.setAttribute('aria-pressed', 'false'); }
    });
    if (calm) return;
    tile.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var r = tile.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      tile.style.setProperty('--rx', ((x - .5) * 10).toFixed(2) + 'deg');
      tile.style.setProperty('--ry', ((.5 - y) * 10).toFixed(2) + 'deg');
      tile.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
      tile.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
    });
    tile.addEventListener('pointerleave', function () { tile.style.setProperty('--rx', '0deg'); tile.style.setProperty('--ry', '0deg'); });
  });

  // ---------- Spotlight cards and magnetic buttons ----------
  if (!calm) {
    $$('.card').forEach(function (c) {
      c.addEventListener('pointermove', function (e) {
        var r = c.getBoundingClientRect();
        c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
    $$('[data-magnet]').forEach(function (b) {
      b.addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse') return;
        var r = b.getBoundingClientRect();
        b.style.transform = 'translate(' + ((e.clientX - r.left - r.width / 2) * .18).toFixed(1) + 'px,' + ((e.clientY - r.top - r.height / 2) * .3).toFixed(1) + 'px)';
      });
      b.addEventListener('pointerleave', function () { b.style.transform = ''; });
    });
  }

  // ---------- Counters ----------
  var counters = $$('[data-count]');
  if (!calm && 'IntersectionObserver' in window) {
    var cio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return; cio.unobserve(e.target);
        var el = e.target, to = +el.dataset.count, t0 = performance.now(), D = 1400;
        if (to === 0) return;
        var step = function (now) {
          var x = Math.min(1, (now - t0) / D), y = 1 - Math.pow(1 - x, 4);
          el.textContent = Math.round(to * y);
          if (x < 1) requestAnimationFrame(step);
        };
        el.textContent = '0'; requestAnimationFrame(step);
      });
    }, { threshold: 0.6 });
    counters.forEach(function (c) { cio.observe(c); });
  }
})();
