// Jauntcut site: copy buttons, clips that play while on screen, the edit timeline's
// playhead (synced to the hero reel), tap-to-play reels and the layer stacks that
// separate as you scroll. No dependencies.
(function () {
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Copy the command next to a .copy button.
  document.querySelectorAll('.copy').forEach(function (btn) {
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

  // Short clips play only while on screen (muted). Reduced motion: posters only.
  var auto = Array.prototype.slice.call(document.querySelectorAll('video[data-autoplay]'));
  if (!calm && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) { if (v.preload === 'none') v.preload = 'auto'; var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        else v.pause();
      });
    }, { threshold: 0.35 });
    auto.forEach(function (v) {
      // The hero reel drives the timeline, so it keeps playing while any of the hero is on screen.
      if (v.id === 'hero-reel') {
        var hero = v.closest('.hero');
        new IntersectionObserver(function (es) {
          es.forEach(function (e) { if (e.isIntersecting) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause(); });
        }, { threshold: 0.05 }).observe(hero);
      } else io.observe(v);
    });
  }

  // Edit timeline: the playhead follows the hero reel; the shot on screen lights up.
  var reel = document.getElementById('hero-reel');
  var head = document.getElementById('playhead');
  var tc = document.getElementById('hero-tc');
  var segs = Array.prototype.slice.call(document.querySelectorAll('#track .seg'));
  if (reel && head) {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var tick = function () {
      var t = reel.currentTime || 0, d = reel.duration || 21.1;
      head.style.left = Math.min(100, (t / d) * 100) + '%';
      segs.forEach(function (s) { s.classList.toggle('on', t >= +s.dataset.from && t < +s.dataset.to); });
      if (tc) tc.textContent = '00:' + pad(Math.floor(t)) + ':' + pad(Math.floor((t % 1) * 60));
      if (!reel.paused) requestAnimationFrame(tick);
    };
    reel.addEventListener('play', function () { requestAnimationFrame(tick); });
    reel.addEventListener('seeked', tick);
    tick();
    // Click a shot on the timeline to jump the reel there.
    segs.forEach(function (s) {
      s.style.cursor = 'pointer';
      s.addEventListener('click', function () { reel.currentTime = +s.dataset.from + 0.05; var p = reel.play(); if (p && p.catch) p.catch(function () {}); });
    });
  }

  // Reels: tap to play or pause, one at a time.
  var tiles = Array.prototype.slice.call(document.querySelectorAll('.reel-btn'));
  tiles.forEach(function (tile) {
    var v = tile.querySelector('video');
    tile.addEventListener('click', function () {
      if (v.paused) {
        tiles.forEach(function (t) { if (t !== tile) { t.querySelector('video').pause(); t.classList.remove('is-playing'); t.setAttribute('aria-pressed', 'false'); } });
        var p = v.play(); tile.classList.add('is-playing'); tile.setAttribute('aria-pressed', 'true');
        if (p && p.catch) p.catch(function () { tile.classList.remove('is-playing'); tile.setAttribute('aria-pressed', 'false'); });
      } else { v.pause(); tile.classList.remove('is-playing'); tile.setAttribute('aria-pressed', 'false'); }
    });
  });

  // Layer stacks: separate as the stage scrolls through the middle of the screen.
  // The button pins them apart (or together); reduced motion: no scroll effect.
  var stages = Array.prototype.slice.call(document.querySelectorAll('.stage'));
  var pinned = {};
  stages.forEach(function (stage) {
    var btn = stage.querySelector('[data-toggle]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var apart = btn.getAttribute('aria-pressed') !== 'true';
      pinned[stage.id] = apart ? 1 : 0;
      btn.setAttribute('aria-pressed', String(apart));
      btn.textContent = apart ? 'Put them back' : 'Separate layers';
      set(stage, pinned[stage.id]);
    });
  });
  function set(stage, p) { stage.querySelector('[data-stack]').style.setProperty('--p', p.toFixed(3)); }
  function ease(x) { return x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x); }
  var ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var vh = window.innerHeight;
      stages.forEach(function (stage) {
        if (stage.id in pinned) return;
        var r = stage.getBoundingClientRect();
        // 0 when the stage's top is at the bottom of the screen, 1 by the time its middle is a third of the way up
        var x = (vh - r.top) / (vh * 0.9 + r.height * 0.15);
        set(stage, ease(x));
      });
    });
  }
  if (!calm) { window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onScroll); onScroll(); }
})();
