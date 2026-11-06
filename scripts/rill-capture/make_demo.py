"""Original, deterministic demo session for current RILL UI captures."""
import array, json, math, random, wave
from pathlib import Path
import sys
root=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).parent/'output'
for directory in ['audio','config','cache','scratch','captures']:
    (root/directory).mkdir(parents=True,exist_ok=True)
rate=24000
random.seed(61106)
for kind in ['kick','snare','hats','texture']:
    samples=array.array('h')
    for n in range(rate*8):
        t=n/rate; beat=t*2; phase=beat%1
        if kind=='kick':
            local=phase*.5
            sample=.7*math.exp(-local*15)*math.sin(2*math.pi*(47*local+2.8*(1-math.exp(-local*24))))
        elif kind=='snare':
            local=(beat%2-1)*.5
            sample=(random.uniform(-1,1)*.5+math.sin(t*2*math.pi*175)*.15)*math.exp(-max(0,local)*25) if local>=0 else 0
        elif kind=='hats':
            local=(beat%.5)*.5
            sample=random.uniform(-1,1)*.23*math.exp(-local*100)
        else:
            env=math.sin(math.pi*t/8)**2
            sample=.16*env*(math.sin(2*math.pi*146.83*t)+.45*math.sin(2*math.pi*220*t)+.25*math.sin(2*math.pi*293.66*t))
        value=int(max(-.98,min(.98,sample))*32767)
        samples.extend([value,value])
    with wave.open(str(root/'audio'/f'{kind}.wav'),'wb') as w:
        w.setnchannels(2);w.setsampwidth(2);w.setframerate(rate);w.writeframes(samples.tobytes())
next_id=100
def ident():
    global next_id
    next_id+=1; return next_id

def track(name,kind,color,out=None):
    return dict(id=ident(),name=name,kind=kind,color=color,gain=.75,pan=0.0,mute=False,solo=False,instrument='None',instrument_state=[],instrument_parameters=[],clips=[],latency_samples=0,inserts=[],sends=[],output_bus=out,parent_folder=None,collapsed=False,automation=None,audio_input=None,midi_input=None)
rhythm=track('Rhythm bus','Bus',[93,166,158])
music=track('Music bus','Bus',[162,141,203])
tracks=[]
for name,kind,color in [('Kick','kick',[87,174,156]),('Snare','snare',[108,155,216]),('Hi-hats','hats',[155,140,213]),('Atmosphere','texture',[197,150,105])]:
    tr=track(name,'Audio',color,rhythm['id'] if kind!='texture' else music['id'])
    for b in range(8):
        if (kind=='snare' and b in [0,4]) or (kind=='hats' and b==4):continue
        section='Intro' if b==0 else 'Break' if b==4 else 'Return' if b>=5 else 'Groove'
        tr['clips'].append(dict(id=ident(),name=f'{section} · {name.lower()}',start=b*16.0,length=16.0,offset=0.0,source_rate=1.0,content={'Audio':dict(path=str(root/'audio'/f'{kind}.wav'),gain=1.0,fade_in=.02,fade_out=.08)}))
    tracks.append(tr)
for name,color,mode in [('Glass chords',[203,184,109],'chords'),('Round bass',[153,190,111],'bass'),('Glass arpeggio',[92,176,189],'arp'),('Echo lead',[183,144,201],'lead')]:
    tr=track(name,'Midi',color,music['id'])
    tr['instrument']={'Vst3':{'path':'/Library/Audio/Plug-Ins/VST3/Surge XT.vst3','class_id':None}}
    tr['instrument_name']='Surge XT'
    for b in range(8):
        if (mode in ['bass','arp'] and b in [0,4]) or (mode=='lead' and b not in [2,3,6,7]):continue
        notes=[]
        for bar,rootnote in enumerate([50,46,53,48]):
            if mode=='chords':events=[(pitch,bar*4,3.75,80) for pitch in [rootnote+12+i for i in ([0,3,7,10] if bar==0 else [0,4,7,11] if bar in [1,2] else [0,4,7,10])]]
            elif mode=='bass':events=[(rootnote-12,bar*4+p,.7,v) for p,v in [(0,104),(1.5,82),(2.5,90),(3.5,76)]]
            elif mode=='arp':events=[(rootnote+12+[0,7,12,15,19,15,12,7][i],bar*4+i*.5,.38,72+(i%3)*8) for i in range(8)]
            else:events=[(rootnote+24+p,bar*4+i*.75,.6,85) for i,p in enumerate([7,3,0,5,3])]
            notes.extend(dict(id=ident(),pitch=p,start=s,length=l,velocity=v) for p,s,l,v in events)
        section='Opening' if b==0 else 'Breakdown' if b==4 else 'Chorus' if b>=5 else 'Verse'
        tr['clips'].append(dict(id=ident(),name=f'{section} · '+name.lower(),start=b*16.0,length=16.0,offset=0.0,source_rate=1.0,content={'Midi':{'notes':notes}}))
    tracks.append(tr)
for t,gain,pan in zip(tracks,[.7,.55,.32,.3,.62,.72,.45,.48],[0,-.05,-.18,.12,0,0,.25,-.15]): t.update(gain=gain,pan=pan)
rhythm['gain']=1.0;music['gain']=1.0
project=dict(name='Glass Current',tempo=120.0,beats_per_bar=4,loop_enabled=True,loop_start=0.0,loop_end=128.0,metronome_enabled=False,metronome_gain=.25,precount_bars=0,tracks=tracks+[rhythm,music])
(root/'glass-current.daw.json').write_text(json.dumps({'version':4,'project':project},indent=2)+'\n')
chords=next(i for i,t in enumerate(project['tracks']) if t['name']=='Glass chords')
project['tracks'].insert(0,project['tracks'].pop(chords))
(root/'glass-current-midi.daw.json').write_text(json.dumps({'version':4,'project':project},indent=2)+'\n')
(root/'config'/'settings.json').write_text(json.dumps({'appearance':'Dark','scratch_dir':str(root/'scratch'),'vst_dirs':[]},indent=2)+'\n')
print('Demo: 32 bars, four audio tracks, four MIDI tracks, two buses; original WAV loops generated.')
