// Dansk: fælles ord, som flere skærme bruger. Nøglerne starter med "core.". Se docs/I18N.md.
//
// GLOSSARY (en -> da). Every Danish dictionary follows these words, so the game speaks one language.
// Tone: short, friendly, game-like ("du"-form), never stiff. Puns and witty names are adapted, not translated.
//
//   level -> bane            crossing -> overgang           chapter -> kapitel        line (Iron Road) -> linje
//   campaign -> kampagne     Roads -> Veje                   Iron Road -> Jernbanen    Famous Bridges -> Berømte broer
//   star -> stjerne          badge -> mærke                  hint -> tip               budget -> budget
//   cost -> pris             over budget -> over budgettet     test (verb/noun) -> test  run (a test) -> forsøg
//   build -> byg             erase -> slet                   select -> vælg            mirror -> spejl
//   undo / redo -> fortryd / gentag                          template -> skabelon      pier zone -> pillezone
//   beam / member -> bjælke  joint -> knudepunkt             anchor -> ankerpunkt      deadman (anchor) -> ankerblok
//   deck -> kørebane (road) / spor (rail)                    road -> vej               reinforced road -> forstærket vej
//   rail track -> jernbanespor (short: spor)                 wood -> træ               steel -> stål
//   rope -> reb              steel cable -> stålkabel        masonry -> murværk        box girder -> kassedrager
//   pier -> pille            pylon -> pylon                  tower -> tårn             main cable -> bærekabel
//   hanger -> hængestang     post -> stolpe                  stay -> skråstag          backstay -> bagstag
//   truss -> gitterdrager (the structure type: fagværk)       arch -> bue               viaduct -> viadukt
//   suspension bridge -> hængebro                            cable-stayed bridge -> skråstagsbro
//   span -> spænd            rise (arch) -> pilhøjde         sag (cable) -> nedhæng    sag (deck) -> nedbøjning
//   panel -> fag             segment -> segment              no-build zone -> byggeforbudszone
//   build area -> byggefelt  bank -> bred                    gap -> kløft              ship channel -> sejlrende
//   load -> last (vægten)    stress -> belastning (% af styrken)   peak stress -> maks. belastning
//   stress map -> belastningskort   failed -> mislykket   collapse -> sammenbrud   Inspect -> Undersøg   Test -> Test
//   tension -> træk          compression -> tryk             bending -> bøjning        force -> kraft
//   derail -> afspore        derailment -> afsporing         grade -> stigning         kink -> knæk
//   ride quality -> kørekomfort                             smoothness -> jævnhed     track recording -> sporregistrering
//   train -> tog             car (rail) -> vogn              coach -> personvogn       locomotive -> lokomotiv
//   car (road) -> bil        van -> varevogn                 bus -> bus                truck -> lastbil
//   semi-trailer -> sættevogn  tanker -> tankbil            heavy hauler -> blokvogn  traffic -> trafik
//   wind -> vind             earthquake -> jordskælv         hurricane -> orkan
//   finale -> finale         unlock -> låse op               skip -> springe over      daily challenge -> dagens udfordring
//   (content) ledge -> klippeafsats   strut -> stiver   chord -> gurt   springing -> vederlag   spandrel -> svikkel
//   cantilever -> udkragning / konsol   guy line -> bardun   crane carrier -> mobilkran   handcar -> dræsine
//   tram -> sporvogn   high-speed train -> højhastighedstog   freight train -> godstog   bolt (cliff) -> bolt
//
// Numbers and units come from BG.i18n (1.234,5 · 4,5 m · 70 % · $31.975); never write them by hand.
(function (root) {
  'use strict';
  root.BG.i18n.add('da', 'core', {
    'core.docTitle': 'SPAN — Brobygger',
    'core.canvasAria': 'Visning af brobyggeriet',
    'core.level': 'Bane {n}',
    'core.settings': 'Indstillinger',
    'core.close': 'Luk',
    'core.done': 'Færdig',
    'core.back': 'Tilbage',
    'core.or': 'eller',
    'core.comingSoon': 'Kommer snart',
    'core.fullscreen': 'Fuld skærm',
    'core.exitFullscreen': 'Afslut fuld skærm',
    'core.runs': { one: '{n} forsøg', other: '{n} forsøg' },
    'core.stars': { one: '{n} stjerne', other: '{n} stjerner' },
  });
})(typeof window !== 'undefined' ? window : globalThis);
