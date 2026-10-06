// Keep display-aligned work responsive without polling an idle map every frame.
// Timers wake a little before a deadline; rAF supplies the actual display time.
export function createFrameScheduler(callback,{
 now=()=>performance.now(),requestFrame=fn=>requestAnimationFrame(fn),cancelFrame=id=>cancelAnimationFrame(id),
 setTimer=(fn,delay)=>setTimeout(fn,delay),clearTimer=id=>clearTimeout(id),
}={}){
 let frame=null,timer=null,deadline=-Infinity;
 const clear=()=>{if(timer!==null){clearTimer(timer);timer=null;}};
 const request=()=>{if(frame===null)frame=requestFrame(scheduledFrame);};
 function scheduledFrame(time){
  frame=null;
  if(time+.5<deadline){request();return;}
  deadline=-Infinity;callback(time);
 }
 return{
  wake(){clear();deadline=-Infinity;request();},
  schedule(delay=0,from=now()){
   // An input or invalidation that already requested a frame takes precedence.
   if(frame!==null)return;
   clear();deadline=from+Math.max(0,delay);
   const remaining=deadline-now();
   if(remaining<=0)request();
   else timer=setTimer(()=>{timer=null;request();},remaining>=100?remaining:Math.max(0,remaining-16));
  },
  cancel(){clear();if(frame!==null){cancelFrame(frame);frame=null;}deadline=-Infinity;},
 };
}
