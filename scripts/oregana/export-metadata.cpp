// Generate fun/oregana/metadata.js using the same native headers as the audio engine.
#include "OreganaPresets.h"

#include <charconv>
#include <iomanip>
#include <iostream>
#include <string>

namespace {
using namespace oregana;

// Shortest decimal that round-trips to the native double, including
// interpolated room settings in the registration bank.
std::string number(double value) {
    char buffer[64];
    const auto result = std::to_chars(buffer, buffer + sizeof(buffer), value, std::chars_format::general);
    return std::string(buffer, result.ptr);
}

const char* curveName(Curve curve) {
    switch (curve) {
        case Curve::kLinear: return "linear";
        case Curve::kLog: return "log";
        case Curve::kStepped: return "stepped";
    }
    return "";
}

void writeControls() {
    std::cout << "export const controls = [\n";
    for (int index = 0; index < kControlCount; ++index) {
        const auto& c = kControlInfo[index];
        std::cout << "  { id: " << std::quoted(c.id) << ", name: " << std::quoted(c.name)
                  << ", min: " << number(c.min) << ", max: " << number(c.max)
                  << ", initial: " << number(c.initial) << ", steps: " << c.steps
                  << ", curve: " << std::quoted(curveName(c.curve)) << ", unit: " << std::quoted(c.unit);
        if (index < kStopCount) {
            std::cout << ", division: " << kStops[index].division << ", ranks: " << kStops[index].ranks;
        }
        if (index == kTemperament) {
            std::cout << ", options: [";
            for (size_t i = 0; i < kTemperaments.size(); ++i) {
                if (i) std::cout << ", ";
                std::cout << std::quoted(kTemperaments[i].name);
            }
            std::cout << "]";
        }
        if (index == kWindSupply) std::cout << R"(, options: ["Off", "Blower", "Bellows"])";
        if (index == kKeyboard) std::cout << ", options: divisions.slice(0, 3)";
        if (index == kPedalMode) std::cout << R"(, options: ["Off", "Bass", "Split"])";
        std::cout << " },\n";
    }
    std::cout << "];\n\n";
}

void writePresets() {
    std::cout << "export const presets = [\n";
    for (size_t index = 0; index < kPresets.size(); ++index) {
        const auto& p = kPresets[index];
        const char* group = index < kFirstOrgan ? "Registrations" : index < kFirstRegion ? "Organs" : "Regions";
        std::cout << "  { name: " << std::quoted(p.name) << ", group: " << std::quoted(group) << ", values: [";
        for (size_t i = 0; i < p.values.size(); ++i) {
            if (i) std::cout << ", ";
            std::cout << number(p.values[i]);
        }
        std::cout << "] },\n";
    }
    std::cout << "];\n";
}
} // namespace

int main() {
    std::cout << "// Generated from Oregana by scripts/oregana/export-metadata.cpp.\n"
                 "// PolyForm Noncommercial 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0/).\n"
                 "// Required Notice: Copyright (c) 2026 Protocodus (https://protocodus.cz)\n\n"
                 "export const divisions = [\"Hauptwerk\", \"Positiv\", \"Récit\", \"Pedal\"];\n\n";
    writeControls();
    writePresets();
}
