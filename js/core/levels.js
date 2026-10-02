/* SPAN — level definitions (BG.Levels). STARTER SET: levels 1–3.
 * Level designers append further levels following the same shape (SPEC §4.3).
 * Every level must have a reference solution in tools/solutions/level-NN.json that
 * passes `node tools/verify-levels.js` (peak stress <= 0.92, cost <= budget). */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  BG.Levels = [
    {
      id: 1,
      name: 'First Crossing',
      hint: 'Drag from an anchor to build a road across. A flat road alone sags and snaps - brace the middle with wood struts down to the lower anchors.',
      theme: 'meadow',
      terrain: { leftEdge: 0, leftY: 0, rightEdge: 10, rightY: 0, floorY: -8, waterY: -5.5 },
      anchors: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -2.5 }, { x: 10, y: -2.5 }],
      pierZones: [],
      maxPiers: 0,
      noBuild: [],
      buildArea: { x0: 0, x1: 10, y0: -5, y1: 6 },
      materials: ['road', 'wood'],
      budget: 2300,
      traffic: [{ type: 'car', count: 2, interval: 2.5 }],
      timeLimit: 30,
      templates: false,
    },
    {
      id: 2,
      name: 'Timber Truss',
      hint: 'Triangles are strong. Build a wooden truss above the road so the van loads flow into the banks.',
      theme: 'autumn',
      terrain: { leftEdge: 0, leftY: 0, rightEdge: 20, rightY: 0, floorY: -10, waterY: -7 },
      anchors: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: -3 }, { x: 20, y: -3 }],
      pierZones: [],
      maxPiers: 0,
      noBuild: [],
      buildArea: { x0: 0, x1: 20, y0: -7, y1: 8 },
      materials: ['road', 'wood'],
      budget: 6700,
      traffic: [{ type: 'van', count: 3, interval: 2.5 }],
      timeLimit: 35,
      templates: true,
    },
    {
      id: 3,
      name: 'River Pier',
      hint: 'Too far for one span. Place a pier in the marked zone, then build two steel trusses that rest on it.',
      theme: 'canyon',
      terrain: { leftEdge: 0, leftY: 0, rightEdge: 40, rightY: 0, floorY: -12, waterY: -8 },
      anchors: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: -4 }, { x: 40, y: -4 }],
      pierZones: [{ x0: 17, x1: 23 }],
      maxPiers: 1,
      noBuild: [],
      buildArea: { x0: 0, x1: 40, y0: -9, y1: 10 },
      materials: ['road', 'wood', 'steel'],
      budget: 27000,
      traffic: [{ type: 'van', count: 2, interval: 2.5 }, { type: 'bus', count: 2, interval: 4 }],
      timeLimit: 50,
      templates: true,
    },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
