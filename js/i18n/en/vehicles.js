// English: vehicle, train and material names. Keys start with "vehicles.". See docs/I18N.md.
// The `name` of every entry in BG.Materials, BG.Vehicles, BG.RailCars and BG.Trains is a getter that reads these
// keys (js/core/materials.js, vehicles.js, trains.js), so every screen that shows `.name` follows the language.
// The *.count plurals build BG.Model.trafficSummary ("2 cars, 1 bus").
(function (root) {
  'use strict';
  root.BG.i18n.add('en', 'vehicles', {
    // ---- materials (BG.Materials[id].name)
    'vehicles.material.road': 'Road',
    'vehicles.material.reinforced_road': 'Reinforced Road',
    'vehicles.material.wood': 'Wood',
    'vehicles.material.steel': 'Steel',
    'vehicles.material.rope': 'Rope',
    'vehicles.material.cable': 'Steel Cable',
    'vehicles.material.rail': 'Rail Track',
    'vehicles.material.masonry': 'Masonry',
    'vehicles.material.girder': 'Box Girder',

    // ---- road vehicles (BG.Vehicles[type].name) and their counts
    'vehicles.road.car': 'Car',
    'vehicles.road.van': 'Van',
    'vehicles.road.bus': 'Bus',
    'vehicles.road.truck': 'Truck',
    'vehicles.road.semi': 'Semi Trailer',
    'vehicles.road.tanker': 'Tanker',
    'vehicles.road.heavy': 'Crane Carrier',
    'vehicles.road.car.count': { one: '{n} car', other: '{n} cars' },
    'vehicles.road.van.count': { one: '{n} van', other: '{n} vans' },
    'vehicles.road.bus.count': { one: '{n} bus', other: '{n} buses' },
    'vehicles.road.truck.count': { one: '{n} truck', other: '{n} trucks' },
    'vehicles.road.semi.count': { one: '{n} semi trailer', other: '{n} semi trailers' },
    'vehicles.road.tanker.count': { one: '{n} tanker', other: '{n} tankers' },
    'vehicles.road.heavy.count': { one: '{n} crane carrier', other: '{n} crane carriers' },

    // ---- rolling stock (BG.RailCars[type].name)
    'vehicles.car.handcar': 'Handcar',
    'vehicles.car.tram': 'Tram',
    'vehicles.car.loco_steam': 'Steam Locomotive',
    'vehicles.car.tender': 'Tender',
    'vehicles.car.coach': 'Coach',
    'vehicles.car.loco_diesel': 'Diesel Locomotive',
    'vehicles.car.boxcar': 'Boxcar',
    'vehicles.car.tank_wagon': 'Tank Wagon',
    'vehicles.car.ore_wagon': 'Ore Wagon',
    'vehicles.car.hs_power': 'High-Speed Power Car',
    'vehicles.car.hs_coach': 'High-Speed Coach',

    // ---- trains (BG.Trains[id].name) and their counts
    'vehicles.train.handcar': 'Handcar',
    'vehicles.train.tram': 'Tram',
    'vehicles.train.steam_local': 'Local Steam',
    'vehicles.train.steam_express': 'Steam Express',
    'vehicles.train.commuter': 'Commuter',
    'vehicles.train.freight_short': 'Short Freight',
    'vehicles.train.freight_long': 'Long Freight',
    'vehicles.train.ore': 'Ore',
    'vehicles.train.highspeed': 'High-Speed',
    'vehicles.train.highspeed_long': 'High-Speed (long)',
    'vehicles.train.handcar.count': { one: '{n} handcar train', other: '{n} handcar trains' },
    'vehicles.train.tram.count': { one: '{n} tram train', other: '{n} tram trains' },
    'vehicles.train.steam_local.count': { one: '{n} local steam train', other: '{n} local steam trains' },
    'vehicles.train.steam_express.count': { one: '{n} steam express train', other: '{n} steam express trains' },
    'vehicles.train.commuter.count': { one: '{n} commuter train', other: '{n} commuter trains' },
    'vehicles.train.freight_short.count': { one: '{n} short freight train', other: '{n} short freight trains' },
    'vehicles.train.freight_long.count': { one: '{n} long freight train', other: '{n} long freight trains' },
    'vehicles.train.ore.count': { one: '{n} ore train', other: '{n} ore trains' },
    'vehicles.train.highspeed.count': { one: '{n} high-speed train', other: '{n} high-speed trains' },
    'vehicles.train.highspeed_long.count': { one: '{n} high-speed (long) train', other: '{n} high-speed (long) trains' },
    'vehicles.train.other.count': { one: '{n} {name} train', other: '{n} {name} trains' },

    // ---- traffic summary (BG.Model.trafficSummary)
    'vehicles.traffic.cars': { one: '{n} car', other: '{n} cars' },
    'vehicles.traffic.withCars': '{train} ({cars})',
  });
})(typeof window !== 'undefined' ? window : globalThis);
