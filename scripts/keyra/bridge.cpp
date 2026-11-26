// Required Notice: Copyright (c) 2026 Protocodus (https://protocodus.cz)
#include "controls.h"
#include <array>

namespace {
keyra::Engine* piano;
keyra::Parameters parameters;
constexpr int blockSize = 128;
std::array<float, blockSize> left{}, right{};
}
#define EXPORTED(name) extern "C" __attribute__((export_name(#name)))

EXPORTED(init) void init(double sampleRate) {
    piano = new keyra::Engine(sampleRate);
    piano->setParameters(parameters);
}
EXPORTED(setPreset) void setPreset(int index) {
    if (index < 0 || index >= static_cast<int>(keyra::factoryPresets.size())) return;
    parameters = keyra::withPreset(parameters, keyra::factoryPresets[index]);
    piano->setParameters(parameters);
}
EXPORTED(setControl) void setControl(int index, float value) {
    if (index < 0 || index >= web::controlCount || !std::isfinite(value)) return;
    web::write(web::controls[index], parameters, value);
    piano->setParameters(parameters);
}
EXPORTED(noteOn) void noteOn(int note, int velocity, int channel) {
    piano->noteOn(note, std::clamp(velocity, 0, 127) / 127.f, channel);
}
EXPORTED(noteOff) void noteOff(int note, int channel) { piano->noteOff(note, channel); }
EXPORTED(controlChange) void controlChange(int cc, int value, int channel) { piano->controlChange(cc, value, channel); }
EXPORTED(pitchBend) void pitchBend(float semitones, int channel) { piano->pitchBend(semitones, channel); }
EXPORTED(allKeysUp) void allKeysUp() {
    for (int channel = 1; channel <= 16; ++channel) piano->controlChange(123, 0, channel);
}
EXPORTED(allSoundOff) void allSoundOff() {
    for (int channel = 1; channel <= 16; ++channel) piano->controlChange(120, 0, channel);
}
EXPORTED(leftSamples) float* leftSamples() { return left.data(); }
EXPORTED(rightSamples) float* rightSamples() { return right.data(); }
EXPORTED(render) void render(int count) {
    if (count > 0 && count <= blockSize) piano->process(left.data(), right.data(), count);
}
