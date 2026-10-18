# Growfox daily gacha automation

Runs the Growfox internal-project daily loop at noon (Asia/Bangkok) via Cursor Cloud Agent timer `growfox-daily-gacha-noon`.

## Local / agent script

```bash
export GROWFOX_EMAIL=nattarapong@growfox.co
export GROWFOX_PASSWORD='…'
npm i playwright
npx playwright install chromium
node scripts/growfox-daily.mjs
```

What it does:

1. Claim daily missions (`/api/daily-login/mission/`)
2. Spin Daily gacha (`/api/shop/purchase/` `box_type=daily`)
3. Gold gacha via duplicate trade (`/api/shop/duplicate-exchange/` `box_type=gold`)
4. Lucky + salt free spins
5. Use every `POINTS_*` card (`/api/cards/use/`) — การ์ดบวกคะแนน
