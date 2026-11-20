// A native oracle built against the unmodified Oregana instrument. The runner
// sends the same score to this process and to the shipped JavaScript module.
#include "DSP/OreganaInstrument.h"
#include "DSP/OreganaPresets.h"

#include <algorithm>
#include <array>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>

using namespace oregana;

int main(int argc, char** argv) {
    if (argc != 2) return 1;
    auto organ = std::make_unique<Instrument>();
    organ->Prepare(std::stod(argv[1]));
    Controls controls = kPresets.front().ToControls();
    double wheel = 0, expression = 1;
    organ->SetControls(controls, wheel, expression);

    std::string command;
    while (std::cin >> command) {
        if (command == "setPreset") {
            int index;
            if (!(std::cin >> index)) return 1;
            controls = kPresets.at(index).ToControls();
            organ->SetControls(controls, wheel, expression);
        } else if (command == "setControl") {
            std::string id;
            double value;
            if (!(std::cin >> id >> value)) return 1;
            const auto control = std::find_if(kControlInfo.begin(), kControlInfo.end(),
                [&](const auto& info) { return info.id == id; });
            if (control == kControlInfo.end()) return 1;
            controls[static_cast<int>(control - kControlInfo.begin())] = value;
            organ->SetControls(controls, wheel, expression);
        } else if (command == "setControllers") {
            if (!(std::cin >> wheel >> expression)) return 1;
            organ->SetControls(controls, wheel, expression);
        } else if (command == "setBend") {
            double bend;
            if (!(std::cin >> bend)) return 1;
            organ->SetBend(bend);
        } else if (command == "noteOn" || command == "noteOff") {
            int note, velocity;
            if (!(std::cin >> note >> velocity)) return 1;
            if (command == "noteOn") organ->KeyDown(note, velocity);
            else organ->KeyUp(note, 0, velocity);
        } else if (command == "allSoundOff") {
            organ->AllSoundOff();
        } else if (command == "allKeysUp") {
            organ->AllKeysUp();
        } else if (command == "render") {
            int frames;
            if (!(std::cin >> frames) || frames <= 0) return 1;
            std::array<float, 128> left, right;
            std::array<float, 256> interleaved;
            while (frames) {
                const int count = std::min(frames, 128);
                organ->Render(left.data(), right.data(), count);
                for (int i = 0; i < count; ++i) {
                    interleaved[2 * i] = left[i];
                    interleaved[2 * i + 1] = right[i];
                }
                if (std::fwrite(interleaved.data(), 2 * sizeof(float), count, stdout) !=
                    static_cast<std::size_t>(count)) return 1;
                frames -= count;
            }
        } else {
            std::cerr << "Unrecognised instrument command: " << command << '\n';
            return 1;
        }
    }
    return 0;
}
