// Required Notice: Copyright (c) 2026 Protocodus (https://protocodus.cz)
#pragma once
#include "KeyraPresets.h"
#include <algorithm>
#include <cmath>
#include <cstddef>

namespace web {
enum class ControlType { number, body, microphone, polarity };
struct Control {
    const char* id;
    const char* name;
    float minimum, maximum;
    bool inPreset;
    ControlType type;
    float keyra::Parameters::* member;
    int mic = 0;
};

// Parameter IDs, physical ranges and presentation order from the native host.
// The member or microphone index is shared by the bridge and catalog exporter.
inline constexpr Control controls[] = {
    {"gain", "Output", 0, 1, false, ControlType::number, &keyra::Parameters::gain},
    {"width", "Stereo width", 0, 1, true, ControlType::number, &keyra::Parameters::width},
    {"tuning", "Concert tuning", 415, 466, false, ControlType::number, &keyra::Parameters::tuning},
    {"mute", "Felt mute", 0, 1, false, ControlType::number, &keyra::Parameters::mute},
    {"sustain", "Sustain pedal", 0, 1, false, ControlType::number, &keyra::Parameters::sustain},
    {"sostenuto", "Sostenuto pedal", 0, 1, false, ControlType::number, &keyra::Parameters::sostenuto},
    {"soft", "Soft pedal", 0, 1, false, ControlType::number, &keyra::Parameters::soft},
    {"mechanics", "Mechanics", 0, 2, false, ControlType::number, &keyra::Parameters::mechanics},
    {"body", "Piano", 0, 4, true, ControlType::body, nullptr},
    {"hammer", "Hammer hardness", -1, 1, true, ControlType::number, &keyra::Parameters::hammer},
    {"age", "String age", 0, 1, true, ControlType::number, &keyra::Parameters::age},
    {"detune", "Unison detune", 0, 1, true, ControlType::number, &keyra::Parameters::detune},
    {"stretch", "Stretch tuning", 0, 2, true, ControlType::number, &keyra::Parameters::stretch},
    {"dynamics", "Dynamic range", 0, 1, true, ControlType::number, &keyra::Parameters::dynamics},
    {"lid", "Lid", 0, 1, true, ControlType::number, &keyra::Parameters::lid},
    {"soundboard", "Soundboard resonance", 0, 1, true, ControlType::number, &keyra::Parameters::soundboard},
    {"sympathetic", "Sympathetic resonance", 0, 1, true, ControlType::number, &keyra::Parameters::sympathetic},
    {"duplex", "Duplex resonance", 0, 1, true, ControlType::number, &keyra::Parameters::duplex},
    {"micClose", "Close mics", 0, 1, true, ControlType::microphone, nullptr, 0},
    {"micXY", "XY mics", 0, 1, true, ControlType::microphone, nullptr, 1},
    {"micLive", "Live mics", 0, 1, true, ControlType::microphone, nullptr, 2},
    {"micDistant", "Distant mics", 0, 1, true, ControlType::microphone, nullptr, 3},
    {"room", "Room size", 0, 1, true, ControlType::number, &keyra::Parameters::room},
    {"felt", "Practice felt", 0, 1, true, ControlType::number, &keyra::Parameters::felt},
    {"micTube", "Tube mic", 0, 1, true, ControlType::microphone, nullptr, 4},
    {"invertClose", "Close mic polarity", 0, 1, false, ControlType::polarity, nullptr, 0},
    {"invertXY", "XY mic polarity", 0, 1, false, ControlType::polarity, nullptr, 1},
    {"invertLive", "Live mic polarity", 0, 1, false, ControlType::polarity, nullptr, 2},
    {"invertDistant", "Distant mic polarity", 0, 1, false, ControlType::polarity, nullptr, 3},
    {"invertTube", "Tube mic polarity", 0, 1, false, ControlType::polarity, nullptr, 4},
};
inline constexpr int controlCount = sizeof(controls) / sizeof(controls[0]);

inline float read(const Control& c, const keyra::Parameters& p) {
    switch (c.type) {
    case ControlType::body: return static_cast<int>(p.body);
    case ControlType::microphone: return p.mic[c.mic];
    case ControlType::polarity: return p.invert[c.mic] ? 1.f : 0.f;
    case ControlType::number: return p.*c.member;
    }
    return 0;
}

inline void write(const Control& c, keyra::Parameters& p, float input) {
    const float value = std::clamp(input, c.minimum, c.maximum);
    switch (c.type) {
    case ControlType::body: p.body = static_cast<keyra::model::Body>(std::lround(value)); break;
    case ControlType::microphone: p.mic[c.mic] = value; break;
    case ControlType::polarity: p.invert[c.mic] = value >= .5f; break;
    case ControlType::number: p.*c.member = value; break;
    }
}
}
