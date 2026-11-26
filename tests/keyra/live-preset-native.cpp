#include "KeyraPresets.h"
#include "MechanicsControl.h"
#include <iomanip>
#include <iostream>
int main() {
  keyra::Parameters p;
  p.gain=.43f; p.tuning=444.25f; p.mute=.37f; p.sustain=.24f; p.sostenuto=.36f; p.soft=.52f;
  p.mechanics=keyra::mechanicsGainFromPosition(.62f);
  for (auto& polarity : p.invert) polarity=true;
  std::cout<<std::setprecision(9);
  for (const auto& preset : keyra::factoryPresets) {
    p=keyra::withPreset(p,preset);
    std::cout<<preset.name<<'\t'<<p.gain<<'\t'<<p.width<<'\t'<<p.tuning<<'\t'<<p.mute
      <<'\t'<<p.sustain<<'\t'<<p.sostenuto<<'\t'<<p.soft<<'\t'<<p.mechanics<<'\t'<<int(p.body)
      <<'\t'<<p.hammer<<'\t'<<p.age<<'\t'<<p.detune<<'\t'<<p.stretch<<'\t'<<p.dynamics
      <<'\t'<<p.lid<<'\t'<<p.soundboard<<'\t'<<p.sympathetic<<'\t'<<p.duplex<<'\t'<<p.room<<'\t'<<p.felt;
    for (const auto level : p.mic) std::cout<<'\t'<<level;
    for (const auto polarity : p.invert) std::cout<<'\t'<<polarity;
    std::cout<<'\n';
  }
}
