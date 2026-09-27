// Several zoom factories can retain their prepared pixels without each owning
// a separate memory allowance. Only resident canvases count toward this LRU.
export function createSpriteCache({limit=128*1024*1024}={}){
  const entries=new Map();let bytes=0,revision=null;
  const budget=Math.max(1024,Number(limit)||128*1024*1024);
  const clear=()=>{entries.clear();bytes=0;};
  return {
    get(key){const image=entries.get(key);if(image){entries.delete(key);entries.set(key,image);}return image;},
    set(key,image){
      const old=entries.get(key);if(old){bytes-=old.width*old.height*4;entries.delete(key);}
      const size=image.width*image.height*4;
      while(entries.size&&bytes+size>budget){const oldest=entries.keys().next().value,canvas=entries.get(oldest);bytes-=canvas.width*canvas.height*4;entries.delete(oldest);}
      if(size<=budget){entries.set(key,image);bytes+=size;}
      return image;
    },
    clear,
    syncRevision(value){if(value!==revision){clear();revision=value;}},
    getStats:()=>({entries:entries.size,bytes,limit:budget}),
  };
}
