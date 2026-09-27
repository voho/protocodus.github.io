import { showLoading, paintLoading, failLoading } from './loading-screen.js';
try {
 const {chooseStartupGame}=await import('./start-menu.js');
 await chooseStartupGame();
 showLoading({status:'Preparing your transport company…',stage:2});await paintLoading();
 await import('./app.js');
} catch (error) { console.error('Transport could not start.',error);failLoading(); }
