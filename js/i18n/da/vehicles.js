// Dansk: navne på køretøjer, tog og materialer. Nøglerne starter med "vehicles.". Se docs/I18N.md.
// `name` på hvert element i BG.Materials, BG.Vehicles, BG.RailCars og BG.Trains er en getter, der læser disse nøgler.
// *.count-flertalsformerne bygger BG.Model.trafficSummary ("2 biler, 1 bus"). Ordvalg: GLOSSARY i core.js.
(function (root) {
  'use strict';
  root.BG.i18n.add('da', 'vehicles', {
    // ---- materialer
    'vehicles.material.road': 'Vej',
    'vehicles.material.reinforced_road': 'Forstærket vej',
    'vehicles.material.wood': 'Træ',
    'vehicles.material.steel': 'Stål',
    'vehicles.material.rope': 'Reb',
    'vehicles.material.cable': 'Stålkabel',
    'vehicles.material.rail': 'Jernbanespor',
    'vehicles.material.masonry': 'Murværk',
    'vehicles.material.girder': 'Kassedrager',

    // ---- vejkøretøjer og antal
    'vehicles.road.car': 'Bil',
    'vehicles.road.van': 'Varevogn',
    'vehicles.road.bus': 'Bus',
    'vehicles.road.truck': 'Lastbil',
    'vehicles.road.semi': 'Sættevogn',
    'vehicles.road.tanker': 'Tankbil',
    'vehicles.road.heavy': 'Mobilkran',
    'vehicles.road.car.count': { one: '{n} bil', other: '{n} biler' },
    'vehicles.road.van.count': { one: '{n} varevogn', other: '{n} varevogne' },
    'vehicles.road.bus.count': { one: '{n} bus', other: '{n} busser' },
    'vehicles.road.truck.count': { one: '{n} lastbil', other: '{n} lastbiler' },
    'vehicles.road.semi.count': { one: '{n} sættevogn', other: '{n} sættevogne' },
    'vehicles.road.tanker.count': { one: '{n} tankbil', other: '{n} tankbiler' },
    'vehicles.road.heavy.count': { one: '{n} mobilkran', other: '{n} mobilkraner' },

    // ---- rullende materiel
    'vehicles.car.handcar': 'Dræsine',
    'vehicles.car.tram': 'Sporvogn',
    'vehicles.car.loco_steam': 'Damplokomotiv',
    'vehicles.car.tender': 'Tender',
    'vehicles.car.coach': 'Personvogn',
    'vehicles.car.loco_diesel': 'Diesellokomotiv',
    'vehicles.car.boxcar': 'Godsvogn',
    'vehicles.car.tank_wagon': 'Tankvogn',
    'vehicles.car.ore_wagon': 'Malmvogn',
    'vehicles.car.hs_power': 'Højhastighedsmotorvogn',
    'vehicles.car.hs_coach': 'Højhastighedsvogn',

    // ---- tog og antal
    'vehicles.train.handcar': 'Dræsine',
    'vehicles.train.tram': 'Sporvogn',
    'vehicles.train.steam_local': 'Lokalt damptog',
    'vehicles.train.steam_express': 'Dampekspres',
    'vehicles.train.commuter': 'Pendlertog',
    'vehicles.train.freight_short': 'Kort godstog',
    'vehicles.train.freight_long': 'Langt godstog',
    'vehicles.train.ore': 'Malmtog',
    'vehicles.train.highspeed': 'Højhastighedstog',
    'vehicles.train.highspeed_long': 'Højhastighedstog (langt)',
    'vehicles.train.handcar.count': { one: '{n} dræsine', other: '{n} dræsiner' },
    'vehicles.train.tram.count': { one: '{n} sporvogn', other: '{n} sporvogne' },
    'vehicles.train.steam_local.count': { one: '{n} lokalt damptog', other: '{n} lokale damptog' },
    'vehicles.train.steam_express.count': { one: '{n} dampekspres', other: '{n} dampeksprestog' },
    'vehicles.train.commuter.count': { one: '{n} pendlertog', other: '{n} pendlertog' },
    'vehicles.train.freight_short.count': { one: '{n} kort godstog', other: '{n} korte godstog' },
    'vehicles.train.freight_long.count': { one: '{n} langt godstog', other: '{n} lange godstog' },
    'vehicles.train.ore.count': { one: '{n} malmtog', other: '{n} malmtog' },
    'vehicles.train.highspeed.count': { one: '{n} højhastighedstog', other: '{n} højhastighedstog' },
    'vehicles.train.highspeed_long.count': { one: '{n} langt højhastighedstog', other: '{n} lange højhastighedstog' },
    'vehicles.train.other.count': { one: '{n} tog ({name})', other: '{n} tog ({name})' },

    // ---- trafikoversigt
    'vehicles.traffic.cars': { one: '{n} vogn', other: '{n} vogne' },
    'vehicles.traffic.withCars': '{train} ({cars})',
  });
})(typeof window !== 'undefined' ? window : globalThis);
