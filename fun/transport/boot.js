import { requiresComputer, showComputerRequired } from './computer-only.js';

if (requiresComputer()) {
 showComputerRequired();
} else {
 document.head.append(document.querySelector('#startup-preloads').content);
 const { showLoading, paintLoading, failLoading } = await import('./loading-screen.js');
 try {
  const {chooseStartupGame}=await import('./start-menu.js');
  await chooseStartupGame();
  showLoading({status:'Preparing your transport company…',stage:2});await paintLoading();
  await import('./app.js');
 } catch (error) { console.error('Transport could not start.',error);failLoading(); }
}
