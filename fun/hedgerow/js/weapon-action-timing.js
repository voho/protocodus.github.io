/* Seconds from the triggering shot/reload, on the simulation clock. Keep
   visible hand/bolt actions and their scheduled mechanical foley together.
   Shot cycling and a full stripper-clip reload are separate sequences. */
export const KAR98K_ACTION_TIMING = Object.freeze({
  shot: Object.freeze({ liftPull: .34, eject: .43, push: .66, lock: .72 }),
  reload: Object.freeze({
    lift: .18, pull: .24, eject: .24, clipIn: .76, roundsIn: 1.03,
    roundClicks: Object.freeze([1.08, 1.132, 1.184, 1.236]),
    clipOut: 2.25, push: 2.56, lock: 2.78,
  }),
});
