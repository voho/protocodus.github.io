// Required Notice: Copyright (c) 2026 Protocodus (https://protocodus.cz)
// Distributed under the terms in fun/oregana/dsp/LICENSE.
#include "OreganaInstrument.h"
#include "OreganaPresets.h"

namespace {
using namespace oregana;

// Each JS factory instance has its own linear memory. Set up the instrument
// once, outside the render callback. Its native state includes all pipe buffers.
Instrument* organ;
Controls controls;
double wheel = 0.0, expression = 1.0;
constexpr int blockSize = 128;
float left[blockSize], right[blockSize];

void applyControls() {
    organ->SetControls(controls, wheel, expression);
}
}

#define EXPORTED(name) extern "C" __attribute__((export_name(#name)))

EXPORTED(init) void init(double rate) {
    organ = new oregana::Instrument;
    organ->Prepare(rate);
    controls = oregana::kPresets[0].ToControls();
    applyControls();
}

EXPORTED(setPreset) void setPreset(int index) {
    if (index < 0 || index >= static_cast<int>(oregana::kPresets.size())) return;
    controls = oregana::kPresets[index].ToControls();
    applyControls();
}

EXPORTED(setControl) void setControl(int index, double value) {
    if (index < 0 || index >= oregana::kControlCount) return;
    controls[index] = value;
    applyControls();
}

EXPORTED(setControllers) void setControllers(double modWheel, double swellPedal) {
    wheel = modWheel;
    expression = swellPedal;
    applyControls();
}

EXPORTED(setBend) void setBend(double value) { organ->SetBend(value); }
EXPORTED(noteOn) void noteOn(int note, int velocity) { organ->KeyDown(note, velocity); }
EXPORTED(noteOff) void noteOff(int note, int velocity) { organ->KeyUp(note, 0, velocity); }
EXPORTED(allKeysUp) void allKeysUp() { organ->AllKeysUp(); }
EXPORTED(allSoundOff) void allSoundOff() { organ->AllSoundOff(); }
EXPORTED(leftSamples) float* leftSamples() { return left; }
EXPORTED(rightSamples) float* rightSamples() { return right; }
EXPORTED(render) void render(int frames) {
    if (frames > 0 && frames <= blockSize) organ->Render(left, right, frames);
}
