# Anonymous: gawing app at ipamahagi (v7)

## Ano ang meron ka na
- Ang app mo ay **PWA** (may manifest, service worker, icons) at may **APK** na ginawa mo sa PWABuilder (`com.onrender.anonymous_ztsp.twa`).
- Ang `.well-known/assetlinks.json` mo ay may totoong fingerprint. Ito ang dahilan kung bakit nawawala ang URL bar sa loob ng APK.
- **Tapos na ang pag-check ko:** lahat ng file na kailangan ng manifest at service worker ay nandoon, tama ang format ng fingerprint, at walang error sa pag-load.

## Ano ang bago (v7)
- **`install.html`**: ang pahina na ibibigay mo sa mga tao. May 3 paraan: (1) **Install app** na button (pinakamadali, hindi na kailangan ng APK at walang "unknown apps"), (2) **Download the APK** (ang Linkvertise link mo), (3) steps para sa iPhone. Kapag naka-install na, sasabihin nitong "you're all set".
- **`apk-link.js`**: dito mo ilalagay ang Linkvertise link mo (isang linya lang).
- May link na **Install the app** sa footer ng main app.
- Ang manifest ay may 2 screenshot para mas maganda ang install window ng Chrome. Binago ang service worker (v10).

## Paano ibigay sa iba (APK + Linkvertise)
Ang **Linkvertise ay link lang** (ads bago ang download). Hindi ito pwedeng pag-imbakan ng file. Kaya:

### 1. Kunin ang APK
Sa PWABuilder zip na dina-download mo, ang gagamitin ay `app-release-signed.apk`. **Huwag ibigay kahit kanino ang `signing.keystore` at ang `signing-key-info.txt` (may password).** Itago ang dalawa na iyon sa safe na lugar. Kapag nawala, hindi ka na makakagawa ng update na tatanggapin ng mga naka-install na.

### 2. I-upload ang APK sa GitHub Releases (libre at maaasahan)
1. Buksan ang repo mo sa GitHub (Desktop site sa phone), pindutin ang **Releases**, tapos **Draft a new release**.
2. Tag: `v1.0.0`. Title: `Anonymous app`.
3. I-attach ang `app-release-signed.apk`. Pangalanan itong `Anonymous.apk` bago i-upload.
4. **Publish release.**
5. Sa release page, i-long-press ang `Anonymous.apk` at **Copy link address**. Ito ang direct link.

### 3. Gumawa ng Linkvertise link
Sa linkvertise.com, gumawa ng bagong link at i-paste ang direct link galing sa GitHub bilang destination. Kopyahin ang Linkvertise link na ibibigay nila.

### 4. Ilagay sa app mo
Buksan ang `apk-link.js` at ilagay sa pagitan ng mga quote:
```
window.APK_URL = "https://linkvertise.com/...";
```
Tapos i-push (Termux commands sa baba). Ang ibibigay mo sa mga tao ay ang link ng install page: `https://anonymous-ztsp.onrender.com/install.html`

## Kapag may update
- **Mga update sa site (design, features, SQL):** awtomatiko na ito sa lahat ng naka-install. Ang app ay bintana lang papunta sa website mo, kaya hindi nila kailangang mag-download ulit ng APK.
- **Kailangan lang ng bagong APK** kapag binago mo ang pangalan, icon, o package settings. Sa PWABuilder, piliin ang **Signing key: Use mine** at ilagay ang keystore at password mo (hindi "New"). Dagdagan ang **Version code** (2, 3, ...). Hindi dapat magbago ang Package ID. Kung "New" ang pinili mo, magkakaiba na ang fingerprint, kaya babalik ang URL bar at hindi mag-uupdate ang lumang install.

## Kailangan mong malaman
- **Play Protect:** sa mga APK na hindi galing sa Play Store, maaaring lumabas ang "unrecognized developer". Kaya may steps sa install page (More details, Install anyway). Hindi ito nangangahulugang may virus.
- **Hindi secure ang Linkvertise bilang pintuan:** pwedeng makita ng iba ang direct GitHub link (halimbawa sa Releases page mo, kung public ang repo) at laktawan ang ads. Okay lang kung ang gusto mo ay kita, hindi proteksyon.
- **Tiwala ng users:** maraming ads at paghihintay bago mag-download ang pwedeng magpa-alinlangan sa mga tao. Kaya inuna sa install page ang libreng **Install app** na button.
- **Sa 2027:** simula Setyembre 30, 2026, humihingi na ang Google ng verified developer para sa mga app na ini-install sa Brazil, Indonesia, Singapore at Thailand. Kasunod ang buong mundo sa 2027. Ang Pilipinas ay wala sa unang apat. Ang mga APK na hindi verified ay mas mahirap i-install (may dagdag na hakbang at paghihintay). Hindi ito nakakaapekto sa **Install app** na button o sa pag-gamit ng site.
- **Notifications:** gumagana habang bukas ang app. Wala pang totoong push notification kapag sarado.
- **Kapag mali ang fingerprint:** mawawala ang full-screen at lalabas ang URL bar. Buksan ang `https://anonymous-ztsp.onrender.com/.well-known/assetlinks.json` sa browser. Dapat JSON ang lumabas, hindi isang page. Kung page ang lumabas (dahil sa `/* -> /send.html` rewrite sa Render), magdagdag ng rule sa Render: `/.well-known/*` -> `/.well-known/*` na NASA ITAAS ng catch-all.

## Termux: i-upload ang bagong files
```
cd ~/Anonymous-
git pull
unzip -o ~/storage/downloads/anonymous-v7-app.zip
git add -A
git commit -m "v7: install page, APK link, manifest screenshots"
git push
```
(Kung wala pa ang folder: `git clone https://github.com/royjunmauricio04-a11y/Anonymous-.git` muna, tapos `cd Anonymous-`.)
Pagkatapos ng 1 hanggang 2 minuto sa Render, buksan ang `/install.html`. Kung luma pa ang itsura, i-clear ang site data o i-hard refresh (may service worker).

## Paano subukan
1. Sa Chrome ng Android, buksan ang `/install.html`. Pindutin ang **Install app**. Dapat may Anonymous na sa home screen at bubukas ito full-screen.
2. Ilagay ang Linkvertise link sa `apk-link.js`. Buksan ulit ang install page. Dapat lumabas ang **Download the APK**.
3. I-install ang APK sa ibang phone. Dapat walang URL bar sa taas.
4. Sa iPhone (Safari), dapat ang steps ng Add to Home Screen lang ang nakikita.

---

# Anonymous: gabay sa setup at update (Taglish)

## v6.2: Views at pag-update
- Dalawa na ang pwedeng i-edit sa Profile: **Message card style** (para sa mga card) at **Link page background** (ang itaas ng link page mo). Ang litrato sa background ay lumalabas nang **buo**, hindi naka-crop. **I-run ulit ang `profile-upgrade.sql`** (may bagong `page_bg` column at `set_page_bg`).
- Ang card design ng nag-send ay naka-save na sa mismong post (column `card`), kaya nakikita ito ng lahat sa Browse. Kinukuha ito ng server mula sa saved profile ng nag-send. May checkbox sa Profile para patayin. **I-run ulit ang `profile-upgrade.sql`** (may bagong 10-argument na `send_message`). Hangga't hindi pa na-run, gumagana pa rin ang pag-send at Browse, pero hindi pa nakikita ng iba ang design.
- Sa **Browse** at **History**, ang post para sa taong may card design ay suot ang design niya. Ang post na ipinadala mo mismo (sa device mo) ay suot ang design mo kung walang design ang tatanggap. Kailangan ng `profile-upgrade.sql` ulit (may bagong `public_cards`).
- Hiwalay na ulit ang **Inbox** (mga message lang) at ang **Profile** tab (litrato, stats, checklist, card style, link at PIN). Bumalik ang Profile button sa ibaba.
- Ang card design na ginawa mo sa Profile ay ginagamit sa Inbox, sa Submit preview, at sa link page ng bisita.
- Bumalik na ang **Views** (ilang beses binuksan ang link mo) sa Inbox profile. Para gumana: i-run sa Supabase SQL Editor ang `profile-upgrade.sql` (o ang buong `setup.sql`, kumpleto na ito ulit).
- Ang `setup.sql` ay kasama na ulit ang `admin-upgrade.sql` at `profile-upgrade.sql` sa dulo, kaya hindi na nawawala ang profile photo, card style, views at blocked words kapag ni-run ulit.
- Hindi na tinatakpan ng Support button ang Play button (nawawala ito habang nag-i-scroll), at hindi na natatakpan ng bottom bar ang footer.

## Ano ang bago sa bersyong ito (v5)
- **Na-fix ang bug:** hindi natatanggap ng may-ari ang message galing sa link page. Ang Inbox ay naghahanap gamit ang username na may capital letters (hal. "RoyJun"), pero lowercase ang naka-save, kaya laging walang laman. Ngayon, ang Inbox ay nagpapakita ng lahat ng direct message na para sa account mo, kahit anong spelling.
- **Bagong send.html:** malaking pulang header na may pangalan, mga ideya ng message na pipindutin, bilang ng letra, preview ng kanta bago mag-send, at success screen na may cover ng kanta.
- **Username na may random number:** pwede nang pareho ang napiling pangalan ng maraming tao. Dinadagdagan ng app ang dulo ng 4 na numero, halimbawa `rjay_4821`, kaya laging magkakaiba ang buong username. Ang pangalan mo ay 3 hanggang 15 letra, at ang buong username ay hanggang 20. Ang buong username (kasama ang numero) ang gamit sa link mo at sa pag-log in. Ang mga lumang username na walang numero ay gumagana pa rin at hindi nagbabago.
- **PIN login:** buong username + PIN. Pwede ka nang mag-log in ulit sa bagong phone at kasama ang Inbox mo. May "Add a PIN" na paalala sa mga walang PIN pa.
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
2. **Random number:** gumawa ng account sa dalawang browser gamit ang parehong pangalan (hal. rjay). Dapat magkaiba ang numero sa dulo (rjay_4821 at rjay_7302). Lalabas ang buong username sa asul na kahon sa Home. Isulat ito.
3. **PIN login:** sa ibang browser, Send a song, tab na Log in, ilagay ang BUONG username (may numero) at PIN. Dapat nandoon pa rin ang Inbox.
4. **Link page:** pindutin ang mga ideya, pumili ng kanta, pindutin ang play para sa preview, Send.
5. **Chatbot:** Support tab, pindutin ang isang topic. Dapat sumagot na parang kausap, may kasamang mungkahing kanta paminsan-minsan.
6. **Logo:** buksan ang site, dapat may pulang mask sa tab.

## Kung may error
| Sinasabi ng app | Gawin |
|---|---|
| Username login is not switched on yet | Step 2 |
| Create a PIN with 4 to 20 characters | Maglagay ng PIN |
| Wrong username or PIN | Ilagay ang BUONG username na may numero (hal. rjay_4821) at ang tamang PIN |
| That name is very popular right now | Subukan ang bahagyang ibang pangalan |
| Too many wrong tries | Maghintay ng 15 minuto |
| Required database functions / Tables are missing | Step 1 (i-run ulit ang setup.sql) |
| The AI helper is not switched on yet | Step 4 |
| Support Buddy is resting for today | Naabot ang DAILY_CAP. Itaas ito sa Secrets |
| Not allowed. Is your account listed as an admin? | Step 3 |

## Mga limitasyon
- Kapag walang PIN at binura ang data ng browser, hindi na mababawi ang username at Inbox.
- Hindi pa nasubukan ang `setup.sql`, ang `pg_cron` ng bot, at ang chatbot sa totoong Supabase mo. Kung may error, kopyahin ang eksaktong text.

## Admin upgrade (run once)
1. In Supabase > SQL Editor, run `fix-300.sql` if posting shows "Database error (300)". It removes the duplicate `send_message` copy. The last two result tables must show one row and no rows.
2. Run `admin-upgrade.sql` once. It adds reports, blocked words, the announcement banner, the bot pool tools, the People list and the dashboard numbers.
3. Open `/admin.html` and sign in. Until step 2 is done the admin shows a yellow "One step left" card.

Private direct messages are never shown in the admin. Messages do not store who sent them.

## Secrets (important)
Never put the Anthropic key or the Supabase service-role/secret key in any file in this repo.
Set them only as Edge Function secrets (Supabase > Edge Functions > support-chat > Secrets, or `supabase secrets set`).
`config.js` may only contain the public `anon` key.

## Short link na parang NGL (`site.com/username`)
1. Render Dashboard > ang Static Site mo > **Redirects/Rewrites** > Add Rule: Source `/*`, Destination `/send.html`, Action **Rewrite**. (Ang mga totoong file tulad ng style.css at index.html ay gumagana pa rin.)
2. Sa `config.js`, gawing `SHORT_LINKS: true`.
3. I-deploy. Ang link sa Profile ay magiging `https://anonymous-ztsp.onrender.com/dreamy`. Gumagana pa rin ang lumang `send.html?to=dreamy`.
