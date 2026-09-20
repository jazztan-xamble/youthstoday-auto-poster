# YouthsToday Auto-Poster

A small, no-subscription pipeline that posts your "Resourceful Content
Creator" calendar to Instagram and Facebook automatically, three times a
week, using Meta's own Graph API directly — no third-party scheduler, no
monthly fee.

Once it's set up, you never touch it again for day-to-day posting. The only
recurring task is adding a graphic for each future date (see "Adding new
graphics" below) and, roughly once every couple of months, confirming the
access token hasn't been revoked (see "Token maintenance").

## How it works

- `data/posts.json` — all 44 captions from the content calendar, one entry
  per date, with a flag for whether that date's image exists yet and
  whether it's already been posted to each platform.
- `images/` — the JPEGs that get posted. Filenames are `<date>.jpg`
  (e.g. `2026-09-21.jpg`). Instagram's API only accepts JPEG, so PNGs must
  be converted (already done for the four September samples).
- `scripts/post.js` — the poster. On each run it finds today's entry,
  publishes it to Instagram (two-step: create a media container, then
  publish it) and to Facebook (single photo-post call), then marks it
  posted in `data/posts.json` so it's never posted twice.
- `.github/workflows/post.yml` — a GitHub Actions schedule that runs
  `post.js` automatically every Monday, Wednesday, and Friday at 10:00am
  Malaysia time. This is what makes it hands-off — GitHub runs it for you
  in the cloud, for free, whether or not your own computer is on.

Nothing here ever asks you to paste an access token into a chat with
Claude. Every credential lives only in GitHub's encrypted repository
secrets, which you enter directly into GitHub's own UI.

## One-time setup

### 1. Create the repo

Create a new **private** GitHub repository (e.g. `youthstoday-auto-poster`)
and push this folder's contents to it. Private is fine — GitHub Actions
works the same either way, and it keeps your content calendar off the
public internet except for the specific image files (step 5 explains why
those need to be public).

### 2. Create a Meta Developer app

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) and log in with the Facebook account that manages your YouthsToday Page.
2. Click **Create App** → choose **Other** → **Business** as the app type.
3. Name it something like "YouthsToday Poster." It can stay in **Development** mode the whole time — you do not need to submit it for App Review, because you're only ever posting to your own Page and Instagram account, not anyone else's.
4. From the app dashboard, add the **Instagram** product (not "Instagram Basic Display" — you want the Instagram API / Graph API product for content publishing).

### 3. Add your Instagram account as a tester

Because the app stays in Development mode, Meta requires your own Instagram
account to be explicitly added as a tester before the app can post to it:

1. In the app dashboard, go to **Instagram → API setup with Instagram business login** (or **Roles → Roles**, depending on which layout Meta shows you) and add the YouthsToday Instagram account as an **Instagram Tester**.
2. Log into Instagram (the YouthsToday account) in a browser, go to **Settings → Apps and Websites → Tester Invites**, and accept the invite from your new app.
3. Confirm the YouthsToday Instagram account is set to a **Business** or **Creator** account (not Personal) and is linked to your Facebook Page — this is required for the Graph API to see it at all. Instagram's own settings menu (Settings → Account type) shows and controls this link.

### 4. Get your Page ID, Instagram Business Account ID, and a long-lived Page access token

All of this happens in Meta's **Graph API Explorer**, not in this codebase:

1. Go to [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer), and in the top-right dropdowns select your new app and your Facebook user.
2. Click **Generate Access Token** and grant these permissions when prompted: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_business_content_publish`. This gives you a **short-lived** user token (good for about an hour) — that's expected, the next steps trade it up.
3. With that token still selected, query `GET /me/accounts`. The response lists your Pages; find YouthsToday's entry and note its `id` (this is your **Page ID**) — ignore the `access_token` shown here, it's short-lived too.
4. Query `GET /<PAGE_ID>?fields=instagram_business_account`. The `id` in the response is your **Instagram Business Account ID**.
5. Now exchange the short-lived user token for a long-lived one. In a browser or terminal, hit:
   `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=<APP_ID>&client_secret=<APP_SECRET>&fb_exchange_token=<SHORT_LIVED_USER_TOKEN>`
   (App ID and App Secret are on your app's **Settings → Basic** page.) This returns a long-lived **user** token, valid about 60 days.
6. Query `GET /me/accounts` **again**, but this time using that long-lived user token as the `access_token` parameter. The `access_token` field in this response for YouthsToday's Page is your long-lived **Page** access token — this is the one you'll actually use. Per Meta's documentation, a Page token obtained this way does not have a fixed expiration date; it only stops working if the Page's permissions are revoked, your password changes, or (per Meta's stated policy) it goes unused for an extended period.

Steps 2–6 are Meta's process, done entirely on Meta's own site — nothing
here automates it, since it involves your login and can't safely be
scripted.

### 5. Host the images publicly

Instagram's API requires `image_url` to be a public, direct link to a
JPEG — it can't reach into a private repo or your computer. This project
uses your GitHub repo itself as the host, served through the free
[jsDelivr](https://www.jsdelivr.com/) CDN, so there's nothing extra to pay
for or maintain:

1. Push this repo to GitHub (if you haven't already) with the `images/` folder included.
2. Your public image URL pattern is:
   `https://cdn.jsdelivr.net/gh/<your-github-username>/<repo-name>@main/images/<date>.jpg`
3. That base URL (everything up to and including `/images`) is what you'll store as the `IMAGE_BASE_URL` secret below.

Note: jsDelivr caches files for up to ~7 days once fetched. If you ever
overwrite an existing date's image after it's already been fetched, force a
refresh by purging that URL at `https://purge.jsdelivr.net/`.

If you'd rather host images on Vercel instead (since you already use it for
other projects), that works too — just point `IMAGE_BASE_URL` at wherever
you deploy the `images/` folder.

### 6. Add the secrets to GitHub

In your repo: **Settings → Secrets and variables → Actions → New repository
secret**. Add these four (paste each value directly into GitHub's form —
never into a chat with Claude or anyone else):

| Secret name | Value |
|---|---|
| `META_PAGE_ACCESS_TOKEN` | the long-lived Page token from step 4.6 |
| `META_PAGE_ID` | the Page ID from step 4.3 |
| `META_IG_USER_ID` | the Instagram Business Account ID from step 4.4 |
| `IMAGE_BASE_URL` | e.g. `https://cdn.jsdelivr.net/gh/yourname/youthstoday-auto-poster@main/images` |

### 7. Test it before trusting it

From the repo's **Actions** tab, open "Post to Instagram & Facebook" and
click **Run workflow**. Tick **dry_run** the first time — it logs exactly
what it would post without calling Meta's API at all, so you can confirm
the image URL and caption look right. Once that looks good, run it again
with dry_run off but a specific past date you don't mind testing with
(e.g. `2026-09-21`) to confirm a real post goes through, then check
Instagram and the Facebook Page to see it live.

After that, leave it alone — the Monday/Wednesday/Friday schedule in
`post.yml` takes over.

## Adding new graphics for October–December

Only September's four sample dates have images checked in so far. For
every other date in `data/posts.json`, `has_image` is `false` and the
poster will skip that date and log a warning rather than post a broken
image or a caption with nothing attached.

To add one: design or export a 1080×1080 JPEG, name it `<date>.jpg`
(matching the `date` field in `data/posts.json`, e.g. `2026-10-02.jpg`),
drop it in `images/`, then re-run:

```
python3 scripts/build_posts_json.py
```

This refreshes `has_image` for that date. Commit and push both the image
and the updated `data/posts.json`.

## Token maintenance

The long-lived Page token from step 4.6 is designed to keep working
indefinitely, but Meta can still invalidate it if you change your
Facebook password, remove the app's permissions, or don't use it for a
long stretch. If a scheduled run ever fails with an authorization error,
that's the signal to redo steps 4.5–4.6 (getting a fresh long-lived token)
and update the `META_PAGE_ACCESS_TOKEN` secret — everything else stays the
same. GitHub Actions will show a red X on the run and, if you have
notifications on for the repo, email you when that happens.

## Manual runs and backfilling

- Post a specific date on demand: **Actions → Run workflow**, fill in the `date` input.
- Run locally for debugging: `IMAGE_BASE_URL=... META_PAGE_ACCESS_TOKEN=... META_PAGE_ID=... META_IG_USER_ID=... node scripts/post.js --dry-run`
