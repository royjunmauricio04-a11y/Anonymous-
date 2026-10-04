# Anonymous: gabay sa setup at update (Taglish)

## Ano ang bago sa bersyong ito (v5)
- **Na-fix ang bug:** hindi natatanggap ng may-ari ang message galing sa link page. Ang Inbox ay naghahanap gamit ang username na may capital letters (hal. "RoyJun"), pero lowercase ang naka-save, kaya laging walang laman. Ngayon, ang Inbox ay nagpapakita ng lahat ng direct message na para sa account mo, kahit anong spelling.
- **Bagong send.html:** malaking pulang header na may pangalan, mga ideya ng message na pipindutin, bilang ng letra, preview ng kanta bago mag-send, at success screen na may cover ng kanta.
- **PIN login:** username + PIN. Pwede ka nang mag-log in ulit sa bagong phone at kasama ang Inbox mo. May "Add a PIN" na paalala sa mga walang PIN pa.
- **Hindi ka na basta nalolog-out:** kapag mahina ang signal, hindi na buburahin ang session mo (dati, ito ang pinakamalamang na dahilan ng pagkawala ng Inbox).
- **Badge sa Inbox:** may bilang ng bagong message.
- **Logo at icons:** favicon, app icon, at preview image kapag ni-share ang link.
- **Mas matalinong Support Buddy:** mas malakas na model, naaalala ang buong usapan, may kaalaman tungkol sa app, nagmumungkahi ng kanta, at may daily cap para hindi ka mabigla sa bill.

## Ano ang buburahin sa GitHub repo mo
Ang mga lumang SQL na ito ay napalitan na ng `setup.sql`. Burahin para hindi ka malito:
`schema.sql`, `bot.sql`, `account-delivery-migration.sql`, `delivery-mode-migration.sql`
Itira ang `admin-user.sql`. Wala nang ibang buburahin.

## Mga file
| File | Para saan |
|---|---|
| index.html, style.css, app.js | Main platform |
| send.html, send.js | Personal link page |
| admin.html, admin.js | Maintenance Center |
| config.js | Ang keys mo |
| setup.sql | ISANG SQL para sa buong database |
| admin-user.sql | Gawing admin ang account mo |
| supabase/functions/support-chat/index.ts | Chatbot (optional) |
| favicon.svg, favicon.ico, favicon-32/48.png, apple-touch-icon.png, icon-192/512.png, icon-maskable-512.png, site.webmanifest | Logo at icons |
| og-image.png | Larawan kapag ni-share ang link (Facebook, Messenger) |
| robots.txt, sitemap.xml | Para sa search engines |

## PART 1. Supabase (kapag may update, gawin ito ulit)

### Step 1. I-run ulit ang setup.sql (kailangan, may bago itong laman)
SQL Editor, New query, i-paste ang LAHAT ng `setup.sql`, Run. Ligtas ito at hindi binubura ang data mo.
Kasama na rito ang PIN login at ang daily cap ng chatbot.

### Step 2. Anonymous sign-ins
Authentication, Sign In / Providers: ON ang **Allow anonymous sign-ins** at ON ang **Allow new users to sign up**.
Authentication, Rate Limits: itaas ang anonymous sign-ins kung maraming gumagamit sa iisang Wi-Fi (default 30 kada oras kada IP).
Huwag munang i-on ang CAPTCHA sa Supabase (wala pang CAPTCHA box ang app).

### Step 3. Admin account (kung hindi mo pa nagagawa)
Authentication, Users, Add user (tick Auto Confirm). Kopyahin ang UID, ilagay sa `admin-user.sql`, i-Run.

### Step 4. Chatbot (optional, pero ito ang nagpapatalino)
1. console.anthropic.com: gumawa ng API key at maglagay ng credits.
2. Supabase, Edge Functions, `support-chat`: i-paste ang BAGONG `index.ts`, Deploy. (Kung wala ka pa nito, Deploy a new function, pangalan `support-chat`.)
3. Edge Functions, Secrets, idagdag:
   - `ANTHROPIC_API_KEY` = ang key mo (required)
   - `AI_MODEL` = `claude-sonnet-5-5` (default na ito, mas matalino). Mas mura: `claude-haiku-4-5-20251001`
   - `DAILY_CAP` = `400` (ang pinakamaraming chat message kada araw para sa lahat. Bawasan para mas mababa ang gastos.)
4. Kung may error, tingnan ang Edge Functions, Logs.

## PART 2. I-upload gamit ang Termux
I-download ang `anonymous-v5.zip` sa phone (Downloads).
```
pkg update -y && pkg install git unzip -y
termux-setup-storage
cd ~
git clone https://github.com/royjunmauricio04-a11y/Anonymous-.git
cd Anonymous-
git pull
unzip -o ~/storage/downloads/anonymous-v5.zip
git rm -f --ignore-unmatch schema.sql bot.sql account-delivery-migration.sql delivery-mode-migration.sql
git add -A
git commit -m "v5: inbox fix, PIN login, new link page, logo, smarter chatbot"
git push
```
- Kung na-clone mo na dati, laktawan ang `git clone` at `cd Anonymous-` na lang.
- Sa `git push`: username = GitHub username, password = Personal Access Token.
- Maghintay ng 1 hanggang 2 minuto sa Render, tapos i-refresh (kung luma pa rin ang itsura, i-hard refresh o i-clear ang cache).

## PART 3. Logo at search
- Ang icon ay lumalabas agad sa tab ng browser, bookmarks, at kapag ni-add sa home screen.
- Kapag ni-share ang link sa Facebook o Messenger, lalabas ang `og-image.png`. Nakasulat sa HTML ang link na `https://anonymous-ztsp.onrender.com`. Kung magpalit ka ng domain, palitan ang `og:image` at `og:url` sa index.html, send.html, admin.html, at ang robots.txt at sitemap.xml.
- **Google search:** lalabas lang ang icon ng site mo sa resulta pagkatapos ma-index ng Google, na inaabot ng ilang araw o linggo. Gawin ito: search.google.com/search-console, Add property (URL prefix), i-verify, tapos Sitemaps, idagdag ang `sitemap.xml`, tapos URL Inspection, Request indexing para sa homepage. Mas mabilis kung may sarili kang domain kaysa sa onrender.com.

## PART 4. Paano subukan
1. **Bug fix:** gumawa ng username na may capital letters (hal. RoyJun) at PIN. Buksan ang link mo sa private tab, magpadala. Sa Inbox, dapat nandoon ang message. May pulang bilang sa Inbox tab bago mo ito buksan.
2. **PIN login:** sa ibang browser, Send a song, tab na Log in, ilagay ang username at PIN. Dapat nandoon pa rin ang Inbox.
3. **Link page:** pindutin ang mga ideya, pumili ng kanta, pindutin ang play para sa preview, Send.
4. **Chatbot:** Support tab, pindutin ang isang topic. Dapat sumagot na parang kausap, may kasamang mungkahing kanta paminsan-minsan.
5. **Logo:** buksan ang site, dapat may pulang mask sa tab.

## Kung may error
| Sinasabi ng app | Gawin |
|---|---|
| Username login is not switched on yet | Step 2 |
| Create a PIN with 4 to 20 characters | Maglagay ng PIN |
| Wrong username or PIN | Tingnan ang spelling at PIN |
| Too many wrong tries | Maghintay ng 15 minuto |
| Required database functions / Tables are missing | Step 1 (i-run ulit ang setup.sql) |
| The AI helper is not switched on yet | Step 4 |
| Support Buddy is resting for today | Naabot ang DAILY_CAP. Itaas ito sa Secrets |
| Not allowed. Is your account listed as an admin? | Step 3 |

## Mga limitasyon
- Kapag walang PIN at binura ang data ng browser, hindi na mababawi ang username at Inbox.
- Hindi pa nasubukan ang `setup.sql`, ang `pg_cron` ng bot, at ang chatbot sa totoong Supabase mo. Kung may error, kopyahin ang eksaktong text.
