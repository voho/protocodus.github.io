// Biomes change materials and scenery independently of the sector's tactical relief.
// Arrays are subdued RGB ground, deposit, raised rock and sunken stone colours.
export const ENVIRONMENTS = {
  ash: {
    name: 'Ash wastes', description: 'Charcoal ash, fractured basalt, deadwood and abandoned industrial debris.',
    ground: [41, 44, 45], deposit: [38, 8, -13], rock: [92, 89, 82], basalt: [47, 53, 55],
    wash: '#222c322c', dust: '#b9ad9424', density: .095,
    mini: { ground: [60, 59, 54], rock: [87, 84, 76], basalt: [45, 51, 53], tree: [54, 56, 47], crater: [49, 48, 43] },
  },
  jungle: {
    name: 'Jungle frontier', description: 'Deep olive forest soil, broadleaf trees, palms, ferns and moss-covered stone.',
    ground: [29, 44, 31], deposit: [7, 22, 3], rock: [72, 85, 69], basalt: [38, 51, 43],
    wash: '#233b22a8', dust: '#99aa7020', density: .25,
    mini: { ground: [44, 61, 43], rock: [70, 80, 62], basalt: [35, 49, 41], tree: [34, 54, 34], crater: [34, 43, 31] },
  },
  desert: {
    name: 'Dune desert', description: 'Dusky ochre sands, wind-carved sandstone, cactus stands and dry scrub.',
    ground: [67, 53, 35], deposit: [24, 10, -3], rock: [111, 94, 69], basalt: [66, 57, 46],
    wash: '#71533096', dust: '#c4aa7430', density: .12,
    mini: { ground: [84, 69, 47], rock: [107, 90, 66], basalt: [64, 56, 45], tree: [64, 65, 40], crater: [65, 51, 35] },
  },
  tundra: {
    name: 'Frost tundra', description: 'Cold slate earth, pale frost seams, stunted conifers, hardy grass and glacial boulders.',
    ground: [39, 47, 53], deposit: [5, 10, 18], rock: [82, 94, 102], basalt: [41, 50, 61],
    wash: '#30455180', dust: '#b1c5cd28', density: .13,
    mini: { ground: [51, 64, 73], rock: [77, 89, 99], basalt: [39, 49, 61], tree: [38, 54, 53], crater: [40, 48, 56] },
  },
};
export const environmentFor = state => Object.hasOwn(ENVIRONMENTS, state?.environment) ? ENVIRONMENTS[state.environment] : ENVIRONMENTS.ash;
