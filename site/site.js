// OWLA Butler site: theme toggle and demo playback. No tracking, no network requests.
(function () {
  var root = document.documentElement;
  var dark = window.matchMedia('(prefers-color-scheme: dark)');
  function current() { return root.dataset.theme || (dark.matches ? 'dark' : 'light'); }

  var toggle = document.querySelector('.theme-toggle');
  if (toggle) {
    var label = function () { toggle.setAttribute('aria-label', current() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'); };
    label();
    dark.addEventListener('change', label);
    toggle.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('owla-theme', next); } catch (e) { /* storage unavailable */ }
      label();
    });
  }

  // The demo autoplays muted unless the visitor prefers reduced motion; the button always works.
  var video = document.querySelector('video.demo');
  var button = document.querySelector('.play-toggle');
  if (video && button) {
    // Native controls are the no-JavaScript fallback; the custom button replaces them.
    video.removeAttribute('controls');
    var sync = function () {
      var playing = !video.paused;
      button.textContent = playing ? 'Pause demo' : 'Play demo';
      button.setAttribute('aria-pressed', String(playing));
    };
    video.addEventListener('play', sync);
    video.addEventListener('pause', sync);
    button.addEventListener('click', function () { if (video.paused) { video.play().catch(function () {}); } else { video.pause(); } });
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      video.play().catch(function () {});
    }
    sync();
  }
})();
