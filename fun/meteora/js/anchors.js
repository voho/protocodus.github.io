// PROVISIONAL — hand-written stand-in until tools/blender/build_ships.py
// generates this file from the models. glTF/three space, metres, nose −Z.
const port = (name, pos, dir) => ({ name, pos, dir });
export const ANCHORS = {
  fighter: {
    radius: 7.1,
    nozzles: [port('nozzle_L', [-1.6, 0, 6.8], [0, 0, 1]), port('nozzle_R', [1.6, 0, 6.8], [0, 0, 1])],
    muzzles: [{ name: 'muzzle_L', pos: [-5.3, -0.2, -3.5] }, { name: 'muzzle_R', pos: [5.3, -0.2, -3.5] }],
    rcs: [
      port('rcs_01', [0, 0.6, -6], [0, 1, 0]), port('rcs_02', [0, -0.6, -6], [0, -1, 0]),
      port('rcs_03', [0.7, 0, -6], [1, 0, 0]), port('rcs_04', [-0.7, 0, -6], [-1, 0, 0]),
      port('rcs_05', [0, 0.8, 5.5], [0, 1, 0]), port('rcs_06', [0, -0.8, 5.5], [0, -1, 0]),
      port('rcs_07', [1.2, 0, 5.5], [1, 0, 0]), port('rcs_08', [-1.2, 0, 5.5], [-1, 0, 0]),
      port('rcs_09', [5.5, 0.3, 1], [0, 1, 0]), port('rcs_10', [5.5, -0.3, 1], [0, -1, 0]),
      port('rcs_11', [-5.5, 0.3, 1], [0, 1, 0]), port('rcs_12', [-5.5, -0.3, 1], [0, -1, 0]),
      port('rcs_13', [0.5, 0, -6.8], [0, 0, -1]), port('rcs_14', [-0.5, 0, -6.8], [0, 0, -1]),
      port('rcs_15', [0.9, 0.5, 6.5], [0, 0, 1]), port('rcs_16', [-0.9, 0.5, 6.5], [0, 0, 1]),
    ],
    cockpit: [0, 1.1, -3],
  },
  interceptor: {
    radius: 6,
    nozzles: [port('nozzle_C', [0, 0, 5.3], [0, 0, 1])],
    muzzles: [{ name: 'muzzle_L', pos: [-1.4, -0.5, -3.8] }, { name: 'muzzle_R', pos: [1.4, -0.5, -3.8] }],
    rcs: [
      port('rcs_01', [0, 0.5, -5], [0, 1, 0]), port('rcs_02', [0, -0.5, -5], [0, -1, 0]),
      port('rcs_03', [0.6, 0, -5], [1, 0, 0]), port('rcs_04', [-0.6, 0, -5], [-1, 0, 0]),
      port('rcs_05', [0, 0.6, 4.5], [0, 1, 0]), port('rcs_06', [0, -0.6, 4.5], [0, -1, 0]),
      port('rcs_07', [1, 0, 4.5], [1, 0, 0]), port('rcs_08', [-1, 0, 4.5], [-1, 0, 0]),
      port('rcs_09', [0.4, 0, -5.5], [0, 0, -1]), port('rcs_10', [-0.4, 0, -5.5], [0, 0, -1]),
      port('rcs_11', [0.8, 0.3, 5], [0, 0, 1]), port('rcs_12', [-0.8, 0.3, 5], [0, 0, 1]),
    ],
    cockpit: [0, 0.6, -2.5],
  },
};
