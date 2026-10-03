# Anonymous: gabay sa setup (Taglish, step by step)

## Ano ang laman ng folder
| File | Para saan |
|---|---|
| index.html, style.css, app.js | Main platform (Home, Submit, Browse, Inbox, History, Support) |
| send.html, send.js | Personal link page na parang NGL. Dito nagpapadala ang mga bisita. |
| admin.html, admin.js | Maintenance Center. Hiwalay na page. |
| config.js | Ang keys mo (Supabase URL, anon key, SITE_URL) |
| setup.sql | ISANG SQL para sa buong database. Palitan nito ang lahat ng lumang .sql |
| admin-user.sql | Para gawing admin ang account mo |
| supabase/functions/support-chat/index.ts | Chatbot (optional) |

Burahin sa GitHub repo ang mga luma: schema.sql, bot.sql, account-delivery-migration.sql, delivery-mode-migration.sql. Hindi mo na sila kailangan.

## Paano gumagana ang login ngayon
Username lang. Walang email, walang password.
Kapag nagbigay ka ng username, gumagawa ang app ng "anonymous account" sa Supabase para sa device mo at ikinakabit doon ang username. Naka-save ang login sa browser.
May email option pa rin ("Email sign in") para sa mga account na ginawa mo dati.
Limitasyon: kapag binura mo ang data ng browser o lumipat ka ng phone, hindi mo na mababawi ang username at Inbox mo. Sinasabi ito ng app bago ka mag-sign out.

## PART 1. Supabase (sundin ang pagkakasunod)

### Step 1. Patakbuhin ang setup.sql
1. Buksan ang supabase.com, piliin ang project mo.
2. Kaliwang menu: SQL Editor, tapos New query.
3. Buksan ang `setup.sql`, kopyahin ang LAHAT, i-paste, pindutin ang Run.
4. Dapat lumabas ang "Success. No rows returned".
5. Tingnan sa Table Editor. Dapat may: users, messages, settings, bot_pool, admins, support_tickets, kb_entries, send_log.
Ligtas itong i-run ulit kahit kailan. Hindi nito binubura ang mga message at user mo.
Kung may red error, kopyahin ang eksaktong text at ipadala sa akin.

### Step 2. I-on ang anonymous sign-ins (kailangan para sa username login)
1. Authentication, tapos Sign In / Providers.
2. I-ON ang **Allow anonymous sign-ins**.
3. Siguraduhing naka-ON din ang **Allow new users to sign up**.
4. Save.
Kapag hindi ito naka-on, ang sasabihin ng app ay "Username login is not switched on yet."

### Step 3. Rate limit (maganda nang gawin)
Authentication, tapos Rate Limits. Ang anonymous sign-ins ay 30 kada oras kada IP address. Kung maraming gumagamit sa iisang Wi-Fi o load network, itaas ito (halimbawa 100).
Huwag munang i-on ang CAPTCHA sa Supabase. Wala pang CAPTCHA box ang app, kaya babagsak ang lahat ng sign-up.

### Step 4. Tingnan ang config.js
- SUPABASE_URL: ang Project URL mo (Settings, API).
- SUPABASE_KEY: ang `anon` public key (nagsisimula sa `eyJ`). HUWAG ilagay ang service_role key.
- SITE_URL: ang Render link mo, halimbawa https://anonymous-ztsp.onrender.com

### Step 5. Gumawa ng ADMIN account (hiwalay ito sa username mo)
1. Authentication, tapos Users, tapos Add user, tapos Create new user.
2. Maglagay ng email at password. I-tick ang **Auto Confirm User**. Create.
3. I-click ang user na ginawa mo at kopyahin ang **UID** (mahabang id).
4. Buksan ang `admin-user.sql`, palitan ang `PASTE-YOUR-USER-UID-HERE` ng UID mo (iwanan ang mga quote).
5. SQL Editor, New query, i-paste, Run. Dapat may lumabas na 1 row na may email mo.
Kapag ang UID mo lang ang nasa listahan, ikaw lang ang admin. Walang user ang makakapagpalit nito.

### Step 6. Bot
Walang kailangang i-run. Naka-schedule na ito sa setup.sql. Pumunta sa admin page at pindutin ang Start bot.

### Step 7. Chatbot (optional)
1. Gumawa ng API key sa console.anthropic.com (kailangan ng credits).
2. Supabase, tapos Edge Functions, tapos Deploy a new function. Pangalan: `support-chat`.
3. I-paste ang laman ng `supabase/functions/support-chat/index.ts`, tapos Deploy.
4. Edge Functions, tapos Secrets, tapos Add: `ANTHROPIC_API_KEY` = ang key mo.
Kapag walang key, sasabihin ng chat na hindi muna ito makakasagot, pero gumagana pa rin ang "Send my concern to a real person".
Huwag ilalagay ang API key sa GitHub o sa config.js.

## PART 2. I-upload gamit ang Termux
Una, i-download ang `anonymous-v4.zip` sa phone mo (mapupunta sa Downloads).
```
pkg update -y && pkg install git unzip -y
termux-setup-storage
cd ~
git clone https://github.com/royjunmauricio04-a11y/Anonymous-.git
cd Anonymous-
git pull
unzip -o ~/storage/downloads/anonymous-v4.zip
git rm -f --ignore-unmatch schema.sql bot.sql account-delivery-migration.sql delivery-mode-migration.sql
git add -A
git commit -m "Username login, link page, admin center, support chat"
git push
```
- Kung na-clone mo na dati, laktawan ang `git clone` at gawin ang `cd Anonymous-` lang.
- Sa `git push`: username = GitHub username mo, password = Personal Access Token (GitHub, Settings, Developer settings, Personal access tokens, Contents: Read and write).
- Maghintay ng 1 hanggang 2 minuto para mag-redeploy ang Render, tapos i-refresh ang page.

## PART 3. Paano subukan
1. **Username login:** buksan ang site, pindutin ang Send a song, maglagay ng username, Continue. Dapat nasa Home ka na. I-refresh, dapat naka-login ka pa rin.
2. **Link page:** Inbox, kopyahin ang link. Buksan sa private tab o ibang phone. Dapat may kard na may pangalan mo. Magsulat, pumili ng kanta, Send!. Dapat lumabas ito sa Inbox mo.
3. **Album art:** sa Home, dapat may cover na ang mga sample message at ang bot posts.
4. **Admin:** buksan ang `/admin.html`, mag-sign in gamit ang admin email. Dapat lumabas ang Overview.
5. **Bot:** Start bot, tapos Post one now. Dapat may bagong "Bot" na post sa Browse.
6. **Maintenance:** i-on, tapos buksan ang main site sa ibang tab. Dapat "back soon" ang makikita. Bukas pa rin ang admin.
7. **Support chat:** Support tab, mag-chat, hayaang mag-alok ng admin help, tapos pindutin ang yes. Sa admin, Support tab, buksan ang ticket, mag-reply. Sa user, Check for replies.
8. **Knowledge:** sa ticket, Add to knowledge, tick ang privacy box, Approve.

## Kung may error
| Sinasabi ng app | Gawin |
|---|---|
| Username login is not switched on yet | Step 2 |
| Required database functions are not installed / Tables are missing | Step 1 (i-run ulit ang setup.sql) |
| Too many tries from this network | Hintayin ng ilang minuto, o Step 3 |
| This link is not connected to anyone yet | Wala pang nag-claim ng username na iyon |
| Not allowed. Is your account listed as an admin? | Step 5 |
| The admin tools are not installed | Step 1 |
