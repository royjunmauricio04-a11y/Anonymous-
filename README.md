# Anonymous

## 1. Database (Supabase, free)
1. supabase.com > New project.
2. SQL Editor > New query > paste schema.sql > Run.
3. Project Settings > API: copy the Project URL and the anon public key.
4. Paste both into config.js (SUPABASE_URL, SUPABASE_KEY).

## 2. Host on Render (free Static Site)
1. Upload ALL files (index.html, style.css, app.js, config.js, schema.sql, README.md) to a GitHub repo, in the root.
2. render.com > sign up with GitHub > New + > Static Site > pick your repo.
3. Name: anything. Branch: main. Build Command: leave blank. Publish Directory: .  (a single dot).
4. Create Static Site. In 1 to 2 minutes you get https://your-name.onrender.com

## 3. Fix the share link
1. Open config.js in GitHub (pencil icon).
2. Set SITE_URL to your Render link, e.g. "https://your-name.onrender.com"
3. Commit. Render redeploys by itself.
Now the link under Inbox looks like https://your-name.onrender.com/#to=username

## Files
index.html (layout) / style.css (design) / app.js (logic) / config.js (your keys and link) / schema.sql (database)

## Start fresh (clear test data)
Supabase > SQL Editor > run:
    delete from messages;
    delete from users;
You can only send to a username that someone has already claimed, and the Inbox search needs the exact username.
