/* SPAN — vehicle definitions (BG.Vehicles, BG.VehicleOrder).
 * Body-local frame: origin at the rear bumper on the ground line, x forward, y up.
 * wheels[].x = axle position from the rear (m); wheel centres sit at y = wheelRadius.
 * Sum of wheel masses == mass. speed = cruise target (m/s), accel = m/s^2. */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  function def(o) {
    let sum = 0;
    for (const w of o.wheels) sum += w.mass;
    o.mass = sum;
    return o;
  }

  BG.Vehicles = {
    car: def({
      type: 'car', name: 'Car', length: 4.2, height: 1.45, wheelRadius: 0.33,
      wheels: [{ x: 0.85, mass: 600 }, { x: 3.4, mass: 600 }],
      speed: 9, accel: 3.5, color: '#e2463f',
    }),
    van: def({
      type: 'van', name: 'Van', length: 5.3, height: 2.25, wheelRadius: 0.36,
      wheels: [{ x: 1.0, mass: 1350 }, { x: 4.3, mass: 1150 }],
      speed: 8.5, accel: 3.0, color: '#f2f2ee',
    }),
    bus: def({
      type: 'bus', name: 'Bus', length: 12.0, height: 3.2, wheelRadius: 0.5,
      wheels: [{ x: 3.2, mass: 7500 }, { x: 9.6, mass: 4500 }],
      speed: 7.5, accel: 2.0, color: '#f2b51d',
    }),
    truck: def({
      type: 'truck', name: 'Truck', length: 9.5, height: 3.5, wheelRadius: 0.52,
      wheels: [{ x: 1.5, mass: 6800 }, { x: 2.9, mass: 6800 }, { x: 7.9, mass: 6400 }],
      speed: 7, accel: 1.8, color: '#2f7fd0',
    }),
    semi: def({
      type: 'semi', name: 'Semi Trailer', length: 16.5, height: 4.0, wheelRadius: 0.52,
      wheels: [
        { x: 1.3, mass: 7500 }, { x: 2.6, mass: 7500 }, { x: 3.9, mass: 7500 },
        { x: 11.6, mass: 6000 }, { x: 12.9, mass: 6000 }, { x: 15.6, mass: 3500 },
      ],
      speed: 6.5, accel: 1.4, color: '#7a3fb0',
    }),
    tanker: def({
      type: 'tanker', name: 'Tanker', length: 17.0, height: 3.9, wheelRadius: 0.52,
      wheels: [
        { x: 1.3, mass: 9000 }, { x: 2.6, mass: 9000 }, { x: 3.9, mass: 9000 },
        { x: 12.0, mass: 7000 }, { x: 13.3, mass: 7000 }, { x: 16.0, mass: 4000 },
      ],
      speed: 6, accel: 1.2, color: '#d7dde3',
    }),
    heavy: def({
      type: 'heavy', name: 'Crane Carrier', length: 14.0, height: 3.9, wheelRadius: 0.62,
      wheels: [
        { x: 1.6, mass: 12000 }, { x: 4.2, mass: 12000 }, { x: 6.8, mass: 12000 },
        { x: 9.4, mass: 12000 }, { x: 12.0, mass: 12000 },
      ],
      speed: 5, accel: 1.0, color: '#f07a1a',
    }),
  };

  // i18n (docs/I18N.md): `name` reads vehicles.road.<type> in the current language
  if (BG.i18n && BG.i18n.lazy) Object.keys(BG.Vehicles).forEach(k => BG.i18n.lazy(BG.Vehicles[k], { name: 'vehicles.road.' + k }));

  BG.VehicleOrder = ['car', 'van', 'bus', 'truck', 'semi', 'tanker', 'heavy'];
})(typeof window !== 'undefined' ? window : globalThis);
