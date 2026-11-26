// Independent oracle using the public native engine and factory bank directly.
#include "DSP/KeyraEngine.h"
#include "DSP/KeyraPresets.h"

#include <algorithm>
#include <array>
#include <cstdio>
#include <iostream>
#include <string>

int main(int argc, char** argv) {
    if (argc != 3) return 1;
    keyra::Engine piano(std::stod(argv[1]));
    keyra::Parameters parameters;
    piano.setParameters(parameters);
    const int block = std::stoi(argv[2]);
    std::array<float, 512> left{}, right{};
    std::array<float, 1024> interleaved{};
    if (block < 1 || block > static_cast<int>(left.size())) return 1;
    std::string op;
    while (std::cin >> op) {
        int a{}, b{}, ch{};
        if (op == "setPreset") {
            if (!(std::cin >> a)) return 1;
            parameters = keyra::withPreset(parameters, keyra::factoryPresets.at(a));
            piano.setParameters(parameters);
        } else if (op == "setControl") {
            std::string id;
            float value;
            if (!(std::cin >> id >> value)) return 1;
            if (id == "width") parameters.width = value;
            else if (id == "tuning") parameters.tuning = value;
            else if (id == "micTube") parameters.mic[keyra::model::micTube] = value;
            else return 1;
            piano.setParameters(parameters);
        } else if (op == "noteOn") {
            if (!(std::cin >> a >> b >> ch)) return 1;
            piano.noteOn(a, b / 127.f, ch);
        } else if (op == "noteOff") {
            if (!(std::cin >> a >> ch)) return 1;
            piano.noteOff(a, ch);
        } else if (op == "controlChange") {
            if (!(std::cin >> a >> b >> ch)) return 1;
            piano.controlChange(a, b, ch);
        } else if (op == "pitchBend") {
            float amount;
            if (!(std::cin >> amount >> ch)) return 1;
            piano.pitchBend(amount, ch);
        } else if (op == "allKeysUp" || op == "allSoundOff") {
            for (int channel = 1; channel <= 16; ++channel) piano.controlChange(op == "allKeysUp" ? 123 : 120, 0, channel);
        } else if (op == "render") {
            if (!(std::cin >> a) || a < 1) return 1;
            while (a > 0) {
                const int count = std::min(a, block);
                piano.process(left.data(), right.data(), count);
                for (int i = 0; i < count; ++i) {
                    interleaved[2 * i] = left[i];
                    interleaved[2 * i + 1] = right[i];
                }
                if (std::fwrite(interleaved.data(), 2 * sizeof(float), count, stdout) != static_cast<std::size_t>(count)) return 1;
                a -= count;
            }
        } else {
            std::cerr << "Unknown event " << op << '\n';
            return 1;
        }
    }
}
