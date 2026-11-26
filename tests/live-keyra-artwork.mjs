import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const base = 'https://protocodus.cz';
const expected = '19f8eb62ff90966057d368b7047c9c576e306a62';
function hash(bytes) {
  return crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: {width: 1280, height: 800}, reducedMotion:'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const salt = '?cardverify=' + Date.now();
  for (const path of ['/fun/keyra/keyra-card.webp', '/fun/keyra/keyra-card.webp' + salt]) {
    const response = await context.request.get(base + path);
    const header = response.headers();
    console.log('PREVIEW_ASSET', path, response.status(), hash(await response.body()), 'CF-Cache-Status=' + header['cf-cache-status'], 'ETag=' + header.etag);
  }
  const issues = [];
  for (const path of ['/#fun', '/fun/', '/' + salt + '#fun', '/fun/' + salt]) {
    const response = await page.goto(base + path, {waitUntil:'domcontentloaded'});
    assert.equal(response.status(), 200);
    const img = page.locator('[data-analytics-cta="instrument_keyra"] img');
    await img.scrollIntoViewIfNeeded();
    await img.evaluate(x => x.decode());
    await img.waitFor({state:'visible'});
    const shot = await img.evaluate(x=>{
      const r=x.getBoundingClientRect();
      const hit=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
      return {src:x.currentSrc,alt:x.alt,intrinsic:[x.naturalWidth,x.naturalHeight],rendered:[r.width,r.height], hit:hit===x||hit?.closest('a')===x.closest('a')};
    });
    const bytes = await (await context.request.get(shot.src)).body();
    shot.blob=hash(bytes);
    assert(shot.rendered.every(x=>x>50) && shot.hit);
    console.log('DISPLAYED',path,JSON.stringify(shot));
    await img.click();
    await page.waitForURL(base + '/fun/keyra/');
    await page.waitForFunction(()=>document.querySelectorAll('#presets button').length===13 && document.querySelectorAll('#keyboard [data-note]').length===88);
    console.log('NAVIGATED',path,page.url(), '13 presets, 88 piano keys');
    if (new URL(shot.src).pathname !== '/fun/keyra/keyra-card.webp' || shot.blob !== expected || shot.intrinsic[0] !== 880 || shot.intrinsic[1] !== 495) issues.push(path);
  }
  assert.deepEqual(issues, [], 'Both placements must show the designated live player screenshot');
  console.log('BOTH_PUBLIC_PLACEMENTS_VERIFIED');
} finally { await browser.close(); }
