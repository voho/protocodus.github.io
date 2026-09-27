import { createGame, restoreGame, validateGame } from './model.js';
import { encodeGame } from './save-codec.js';
import { captureWorld, materializeWorld, worldTransferables } from './world-transfer.js';

self.onmessage=async({data})=>{
  const {id,operation,payload}=data;
  const progress=value=>self.postMessage({id,progress:value});
  try{
    let game;
    if(operation==='create'){
      progress({phase:'generating'});game=createGame(payload);
    }else if(operation==='restore'){
      progress({phase:'restoring'});game=restoreGame(typeof payload==='string'?JSON.parse(payload):payload);
      if(!game)throw new Error('This save is damaged or incompatible.');
    }else if(operation==='encode'){
      game=await materializeWorld(payload,{cooperative:false});
    }else throw new Error('Unknown background operation.');
    progress({phase:'encoding'});
    if(!validateGame(game))throw new Error('The game state could not be validated.');
    const serialized=JSON.stringify(encodeGame(game));
    if(operation==='encode'){self.postMessage({id,result:{serialized}});return;}
    const snapshot=await captureWorld(game,{cooperative:false,copyBaseline:false,onProgress:progress});
    self.postMessage({id,result:{snapshot,serialized}},worldTransferables(snapshot));
  }catch(error){self.postMessage({id,error:{name:error.name,message:error.message}});}
};
self.postMessage({ready:true});
