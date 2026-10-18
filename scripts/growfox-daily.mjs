#!/usr/bin/env node
/**
 * Growfox internal-project daily automation.
 * Reads GROWFOX_EMAIL / GROWFOX_PASSWORD from env (never commit secrets).
 *
 * Flow:
 * 1) Visit battle/profile/shop/daily to unlock missions
 * 2) Claim daily login
 * 3) Spin Daily gacha (completes "Open a Card")
 * 4) Claim missions (+ clear bonus)
 * 5) Gold gacha via duplicate-exchange
 * 6) Lucky / salt / free spins
 * 7) Use ALL POINTS_* cards (การ์ดบวกคะแนน)
 */
import { chromium } from 'playwright';

const EMAIL = process.env.GROWFOX_EMAIL || 'nattarapong@growfox.co';
const PASSWORD = process.env.GROWFOX_PASSWORD;
const BASE = process.env.GROWFOX_URL?.replace(/\/$/, '') || 'https://marketing.growfox.co';

if (!PASSWORD) {
  console.error('Set GROWFOX_PASSWORD in the environment');
  process.exit(1);
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'th-TH' })
  ).newPage();

  await page.goto(`${BASE}/accounts/login/?next=/internal-profile/`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 45000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  if (page.url().includes('/login')) throw new Error('Login failed');

  // Unlock visit-based missions first
  for (const path of ['/internal-battle/', '/internal-profile/', '/internal-shop/', '/internal-shop/daily/']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    log('visited', path);
  }

  const csrf = await page.evaluate(() => document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '');

  const api = (path, body = {}) =>
    page.evaluate(
      async ({ path, body, csrf, BASE }) => {
        const res = await fetch(BASE + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
          credentials: 'same-origin',
          body: JSON.stringify(body),
        });
        return { status: res.status, json: await res.json().catch(async () => ({ raw: await res.text() })) };
      },
      { path, body, csrf, BASE }
    );

  const summary = { missions: [], daily: [], gold: [], lucky: [], free: [], pointsUsed: [], awarded: 0 };

  summary.claim = (await api('/api/daily-login/claim/', {})).json;
  log('claim', summary.claim?.success ?? summary.claim?.error);

  // Claim visit missions that are already done (deck/shop/arena), then spin daily, then pull/clear
  for (const mission_id of ['arena', 'deck', 'shop']) {
    const r = await api('/api/daily-login/mission/', { mission_id });
    summary.missions.push({ mission_id, ...r.json });
    log('mission', mission_id, r.json?.granted ?? r.json?.error, 'tokens', r.json?.login_tokens);
  }

  for (let i = 0; i < 10; i++) {
    const r = await api('/api/shop/purchase/', { box_type: 'daily' });
    summary.daily.push(r.json);
    log('daily', i, r.json?.success, r.json?.card?.display || r.json?.error, 'tokens', r.json?.tokens_after);
    if (!r.json?.success) break;
  }

  for (const mission_id of ['pull', 'clear']) {
    const r = await api('/api/daily-login/mission/', { mission_id });
    summary.missions.push({ mission_id, ...r.json });
    log('mission', mission_id, r.json?.granted ?? r.json?.error, 'tokens', r.json?.login_tokens);
  }

  // Extra daily spins from clear bonus tokens
  for (let i = 0; i < 5; i++) {
    const r = await api('/api/shop/purchase/', { box_type: 'daily' });
    if (!r.json?.success) break;
    summary.daily.push(r.json);
    log('daily-extra', i, r.json.card?.display, 'tokens', r.json.tokens_after);
  }

  const goldTypes = [
    'IMMUNITY',
    'DREAM_ON',
    'REFLECT',
    'KICK',
    'STEAL',
    'SWITCH_TEAM',
    'STEAL_BONUS',
    'SOUL_BIND',
    'BLACKHOLE',
  ];
  for (let i = 0; i < 5; i++) {
    let ok = false;
    for (const card_type of goldTypes) {
      const r = await api('/api/shop/duplicate-exchange/', { card_type, box_type: 'gold' });
      if (r.json?.success) {
        summary.gold.push({ card_type, card: r.json.card?.display, burned: r.json.burned });
        log('gold', card_type, '→', r.json.card?.display);
        ok = true;
        break;
      }
    }
    if (!ok) break;
  }

  for (let i = 0; i < 20; i++) {
    const r = await api('/api/cards/gacha-lucky-spin/', {});
    if (!r.json?.success) break;
    summary.lucky.push(r.json.card?.type_display);
    log('lucky', r.json.card?.type_display, 'left', r.json.lucky_available);
  }

  for (let i = 0; i < 10; i++) {
    const r = await api('/api/cards/gacha-salt-exchange/', {});
    if (!r.json?.success) break;
    log('salt exchange', r.json.message || r.json);
  }

  for (let i = 0; i < 20; i++) {
    const r = await api('/api/cards/gacha-spin/', {});
    if (!r.json?.success) break;
    summary.free.push(r.json.card?.type_display);
    log('free spin', r.json.card?.type_display, 'left', r.json.spins_remaining);
  }

  async function useAllPointCards() {
    await page.goto(`${BASE}/internal-profile/`, { waitUntil: 'networkidle' });
    const cards = await page.evaluate(() => {
      const html = document.body.innerHTML;
      const out = [];
      const re = /useCard\(event,(\d+),'(POINTS_\d+)',(\d+)\)/g;
      let m;
      while ((m = re.exec(html))) out.push({ id: +m[1], type: m[2], points: +m[3] });
      return [...new Map(out.map((c) => [c.id, c])).values()];
    });
    for (const c of cards) {
      const r = await api('/api/cards/use/', { card_id: c.id });
      if (r.json?.success) {
        summary.awarded += r.json.points_awarded || c.points || 0;
        summary.pointsUsed.push({ ...c, awarded: r.json.points_awarded });
        log('use +card', c.type, r.json.points_awarded);
      }
    }
    return cards.length;
  }

  await useAllPointCards();
  await useAllPointCards();

  await page.goto(`${BASE}/internal-profile/`, { waitUntil: 'networkidle' });
  summary.final = await page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/(\d+)\s*ใช้ได้\s*\/\s*(\d+)\s*ใช้แล้ว/);
    return { available: m && +m[1], used: m && +m[2] };
  });

  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
