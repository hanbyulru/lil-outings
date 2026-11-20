# Admin dashboard login (Cloudflare Access)

The admin dashboard lives at **liloutings.com/admin/** (Sources, Activity, Events & coverage). GitHub Pages has no logins of its own, so Cloudflare Access sits in front of `/admin/`. It asks each visitor for their email, emails them a one-time code, and only lets in the addresses you list. It's free for up to 50 people.

Until this is set up, the page is reachable by anyone who knows the address. It isn't linked from the site, and `robots.txt` keeps search engines out. Most of what it shows (events, sources' results) is already in the site's public data files, so the extra exposure is the run log and the review queue.

## One-time setup (about 30 minutes)

### 1. Move the domain's DNS to Cloudflare (the domain stays registered at GoDaddy)
1. Create a free account at cloudflare.com, then **Add a domain**: `liloutings.com`, Free plan.
2. Cloudflare copies your current DNS records. Check it found the GitHub Pages records: four **A** records for `liloutings.com` (185.199.108.153, .109.153, .110.153, .111.153) and the **CNAME** `www → hanbyulru.github.io`. Also keep the ImprovMX **MX** and **TXT** records exactly as they are, so hello@liloutings.com keeps working.
3. Make sure the A and CNAME records show an **orange cloud (Proxied)**. Access only works on proxied records. Leave the MX records as they are (they can't be proxied).
4. Cloudflare shows two nameservers. In GoDaddy: **My Products → liloutings.com → DNS → Nameservers → Change → Enter my own nameservers**, and paste Cloudflare's two. It can take a few minutes to a few hours to switch over; Cloudflare emails you when it's active.
5. In Cloudflare: **SSL/TLS → Overview → Full**. (Not "Flexible", which causes a redirect loop with GitHub Pages; not "Full (strict)".)
6. **Security → Settings → Scrape Shield → Email Address Obfuscation: Off.** It's on by default and rewrites email addresses in the pages with a script; turning it off keeps the site exactly as built. Leave Bot Fight Mode, Rocket Loader and other optional speed/security extras off too.
7. Check that liloutings.com still loads and that a test email to hello@liloutings.com still arrives. If the email doesn't arrive, compare the MX and TXT (SPF) records in Cloudflare against the ones GoDaddy had and add any that are missing.

What changes for visitors: nothing. Same pages and address; GitHub still builds and serves the site, and Cloudflare passes it through. After a deploy, changes can take up to about 10 minutes to show, as before. GitHub's Pages settings may later warn that it can't renew its own HTTPS certificate for the domain; that's expected with Cloudflare in front (visitors get Cloudflare's certificate) and can be ignored.

### 2. Put /admin behind a login
1. In Cloudflare, open **Zero Trust** (left sidebar). The first time, pick a team name (e.g. `liloutings`) and the **Free** plan.
2. Turn on the emailed-code login: **Integrations → Identity providers** (older menus: **Settings → Authentication → Login methods**) **→ Add new → One-time PIN**, save. Some accounts have it already, but newer ones may only offer "Sign in with Cloudflare", which only works for Cloudflare account holders.
3. **Access → Applications → Add an application → Self-hosted**:
   - Application name: `Lil' Outings admin`
   - Session duration: `1 month` (how long before someone has to log in again)
   - Destination: a **Public hostname** (not a private hostname, which is for internal networks reached through Cloudflare's device app and leaves the website open)
   - Domain `liloutings.com`, path `admin` (no slash, so it covers both `/admin` and `/admin/`)
   - Login methods: tick **One-time PIN** only (untick **Cloudflare**), and turn on **Instant Auth** if offered, so people go straight to the email box.
4. Add a policy: name `Team`, action **Allow**, rule **Include → Emails** and list each email address that should get in (yours first).
5. Save. Open liloutings.com/admin/ in a private window: you should see a Cloudflare login page asking for your email, then a code.

## Adding or removing people
**Zero Trust → Access → Applications → Lil' Outings admin → Policies → Team → Edit**, then add or remove email addresses. Changes apply right away. Someone removed is logged out when their session ends; to cut them off at once, use **Zero Trust → My Team → Users → (person) → Revoke sessions**.

## What the dashboard reads
Everything is written by the daily pipeline (the GitHub workflow), so the dashboard is always as fresh as the site:
- `data/events.json`, `data/meta.json`, `data/geo.json`: the site's own data.
- `admin/data/runs.json`: the run log, one entry per pipeline run, kept about a year (`src/runlog.js`; carried between runs in the workflow's cache).
- `admin/data/sources.json`: every configured source, including turned-off ones.
- `admin/data/review.json`: events the tagger was unsure about.
