// AUTO-GENERATED from lowpoly__fps__tdm__game__map_by_resoforge.glb by
// server/tools/glb-gen-colliders.mjs. Do not edit by hand; re-run the tool.
// Solid prop colliders (crates / barrels / pillars), perimeter walls for the
// larger central buildings, and walkable ramp slopes, all in world space. The
// outer bounds are brought in slightly so players don't clip the GLB walls.

export const MAP = {
  asset: 'assets/maps/tdm_arena.glb',
  scale: 3,
  halfX: 11.85,
  halfZ: 23.7,
  floorY: 0,
};

// each collider is an axis-aligned box in world units
export const COLLIDERS = [{"minX":-4.662,"maxX":0.138,"minY":0.12,"maxY":2.28,"minZ":-10.341,"maxZ":-8.073},{"minX":-4.662,"maxX":0.138,"minY":0,"maxY":2.4,"minZ":-10.461,"maxZ":-8.061},{"minX":-12.3,"maxX":-10.5,"minY":0,"maxY":3,"minZ":11.7,"maxZ":12.3},{"minX":9.423,"maxX":12.423,"minY":0,"maxY":3,"minZ":11.4,"maxZ":12},{"minX":-7.489,"maxX":-5.989,"minY":0,"maxY":1.5,"minZ":13.36,"maxZ":14.86},{"minX":9.423,"maxX":12.423,"minY":0,"maxY":3,"minZ":-15.509,"maxZ":-14.909},{"minX":5.345,"maxX":6.845,"minY":0,"maxY":1.5,"minZ":3,"maxZ":4.5},{"minX":5.345,"maxX":6.845,"minY":0,"maxY":1.5,"minZ":-5.715,"maxZ":-4.215},{"minX":7.989,"maxX":9.489,"minY":3,"maxY":4.5,"minZ":-0.75,"maxZ":0.75},{"minX":9.101,"maxX":10.601,"minY":0,"maxY":1.5,"minZ":6.521,"maxZ":8.021},{"minX":1.298,"maxX":6.37,"minY":-0.013,"maxY":1.582,"minZ":7.38,"maxZ":12.997},{"minX":1.834,"maxX":7.117,"minY":-0.013,"maxY":1.582,"minZ":-20.692,"maxZ":-18.245},{"minX":5.847,"maxX":6.297,"minY":-0.015,"maxY":5.92,"minZ":17.171,"maxZ":18.361},{"minX":6.447,"maxX":6.897,"minY":-0.015,"maxY":5.92,"minZ":17.171,"maxZ":18.361},{"minX":-8.088,"maxX":-7.488,"minY":0,"maxY":3,"minZ":12.54,"maxZ":15.54},{"minX":0.616,"maxX":2.116,"minY":0,"maxY":1.5,"minZ":16.857,"maxZ":18.357},{"minX":-12.086,"maxX":-9.086,"minY":0,"maxY":3,"minZ":-15.509,"maxZ":-14.909},{"minX":-12.016,"maxX":-11.136,"minY":-0.035,"maxY":5.938,"minZ":-0.448,"maxZ":-0.148},{"minX":-12.011,"maxX":-10.813,"minY":-0.019,"maxY":5.922,"minZ":-2.188,"maxZ":-1.059},{"minX":-12.006,"maxX":-10.817,"minY":-0.027,"maxY":5.741,"minZ":-3.725,"maxZ":-1.723},{"minX":-12.008,"maxX":-10.819,"minY":-0.016,"maxY":5.919,"minZ":-0.144,"maxZ":1.165},{"minX":-11.981,"maxX":-10.792,"minY":-0.016,"maxY":5.919,"minZ":4.078,"maxZ":4.378},{"minX":-12.002,"maxX":-10.812,"minY":-0.016,"maxY":5.919,"minZ":1.275,"maxZ":1.575},{"minX":2.648,"maxX":4.148,"minY":3,"maxY":4.5,"minZ":-4.143,"maxZ":-2.643},{"minX":10.484,"maxX":11.984,"minY":0,"maxY":1.5,"minZ":-17.051,"maxZ":-15.551},{"minX":6.429,"maxX":7.929,"minY":3,"maxY":4.5,"minZ":-0.75,"maxZ":0.75},{"minX":-1.445,"maxX":0.955,"minY":0,"maxY":12,"minZ":10.5,"maxZ":12.9},{"minX":-1.445,"maxX":0.955,"minY":0,"maxY":12,"minZ":-12.9,"maxZ":-10.5},{"minX":3.818,"maxX":8.806,"minY":-0.013,"maxY":1.582,"minZ":-12.443,"maxZ":-6.79},{"minX":-5.532,"maxX":-2.532,"minY":0,"maxY":1.5,"minZ":-19.907,"maxZ":-18.407},{"minX":8.995,"maxX":11.995,"minY":0,"maxY":1.5,"minZ":18.402,"maxZ":19.902},{"minX":-4.439,"maxX":-2.939,"minY":3.15,"maxY":4.65,"minZ":-20.267,"maxZ":-18.767},{"minX":-6.6,"maxX":12,"minY":0,"maxY":6,"minZ":-4.2,"maxZ":-3.6},{"minX":-6.6,"maxX":12,"minY":0,"maxY":6,"minZ":2.4,"maxZ":3},{"minX":-6.6,"maxX":-6,"minY":0,"maxY":6,"minZ":-4.2,"maxZ":3},{"minX":11.4,"maxX":12,"minY":0,"maxY":6,"minZ":-4.2,"maxZ":3}];

// walkable slopes: surface height interpolates from y0 (at the axis-min edge)
// to y1 (at the axis-max edge) across the footprint.
export const RAMPS = [{"minX":-12.114,"maxX":-9.114,"minZ":13.872,"maxZ":18.372,"axis":"x","y0":2.15,"y1":1.13},{"minX":10.621,"maxX":12.121,"minZ":3,"maxZ":9,"axis":"z","y0":3,"y1":0.03},{"minX":10.621,"maxX":12.121,"minZ":-9,"maxZ":-3,"axis":"z","y0":0.03,"y1":3},{"minX":0.566,"maxX":8.405,"minZ":-23.145,"maxZ":-22.204,"axis":"x","y0":3.279,"y1":0.119}];

export const MAP_SPAWNS = {
  A: [{"x":-10.66,"z":-22.49},{"x":-6.71,"z":-18.48},{"x":-1.97,"z":-14.46},{"x":4.35,"z":-16.87},{"x":10.66,"z":-13.66}],
  D: [{"x":-10.66,"z":19.28},{"x":-4.34,"z":17.67},{"x":-0.39,"z":21.69},{"x":5.13,"z":21.69},{"x":10.66,"z":22.49}],
};

export const MAP_SITES = [{"id":"A","name":"Site Alpha","x":-5.92,"z":-6.43,"r":4.2},{"id":"B","name":"Site Bravo","x":5.92,"z":6.43,"r":4.2}];
