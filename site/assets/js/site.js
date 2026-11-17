// Copy buttons and reel playback. No dependencies.
(function () {
  // Copy the command next to a .copy button.
  document.querySelectorAll('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var code = btn.parentNode.querySelector('code');
      var text = code ? code.textContent : '';
      var done = function () {
        btn.textContent = 'Copied';
        btn.classList.add('done');
        setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1800);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () { select(code); });
      } else { select(code); }
    });
  });
  function select(node) {
    var r = document.createRange(); r.selectNodeContents(node);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Hero reels: play muted while on screen (not for reduced motion).
  var heroVideos = Array.prototype.slice.call(document.querySelectorAll('.hero-reels video'));
  if (heroVideos.length && !calm && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        else v.pause();
      });
    }, { threshold: 0.4 });
    heroVideos.forEach(function (v) { io.observe(v); });
  }

  // Gallery reels: tap to play or pause, one at a time.
  var tiles = Array.prototype.slice.call(document.querySelectorAll('.gallery .phone'));
  tiles.forEach(function (tile) {
    var v = tile.querySelector('video');
    tile.addEventListener('click', function () {
      if (v.paused) {
        tiles.forEach(function (t) { if (t !== tile) { t.querySelector('video').pause(); t.classList.remove('is-playing'); t.setAttribute('aria-pressed', 'false'); } });
        var p = v.play();
        tile.classList.add('is-playing'); tile.setAttribute('aria-pressed', 'true');
        if (p && p.catch) p.catch(function () { tile.classList.remove('is-playing'); tile.setAttribute('aria-pressed', 'false'); });
      } else {
        v.pause(); tile.classList.remove('is-playing'); tile.setAttribute('aria-pressed', 'false');
      }
    });
  });
})();
