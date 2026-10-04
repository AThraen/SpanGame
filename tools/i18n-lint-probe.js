// Probe for the hard-coded string lint in tools/test-i18n.js (never loaded by the game). The lint must report
// exactly the seven English texts marked "caught" and nothing else.
(function () {
  'use strict';
  const el = document.createElement('div');
  el.classList.add('btn-primary', 'is-open');                       // classes: ignored
  console.log('Some debug message that is not shown to players');   // console: ignored
  const re = /Hello there, regex/g;                                 // regex: ignored
  const key = t('hud.title.play');                                  // a key: ignored
  Hud.toast('Hard-coded toast', 'info');                            // caught
  el.textContent = 'Hello there';                                   // caught
  const msg = 'A sentence that nobody translated.';                 // caught
  el.innerHTML = `<button class="btn" title="Tool tip">${key}</button><p>Visible text</p>`; // caught x2
  const ch = { n: 1, key: 'road1', name: 'Chapter name', theme: 'meadow' }; // caught (name:)
  ctx.fillText('Canvas label', 10, 10);                             // caught
  return [el, re, msg, ch];
})();
