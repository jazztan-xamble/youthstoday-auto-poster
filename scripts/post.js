#!/usr/bin/env node
/**
 * YouthsToday automated poster.
 *
 * Reads data/posts.json, finds the entry whose date matches today (or a
 * date passed with --date=YYYY-MM-DD), and publishes it to:
 *   - Instagram (via the two-step Content Publishing API: create a media
 *     container, then publish it)
 *   - Facebook Page (via a single photo-post call)
 *
 * Images must already be hosted at a public URL — this script builds that
 * URL from IMAGE_BASE_URL + the post's "image" filename (see README for the
 * jsDelivr setup). Instagram's API requires the image to be a JPEG.
 *
 * Required environment variables (set as GitHub Actions repo secrets, never
 * committed to the repo and never pasted into chat):
 *   META_PAGE_ACCESS_TOKEN   - long-lived Facebook Page access token
 *   META_PAGE_ID             - Facebook Page ID
 *   META_IG_USER_ID          - Instagram Business Account ID (linked to the Page)
 *   IMAGE_BASE_URL           - public base URL where images/<date>.jpg are hosted
 *
 * Usage:
 *   node scripts/post.js                  # posts today's entry, if one exists
 *   node scripts/post.js --date=2026-09-21
 *   node scripts/post.js --dry-run         # prints what it would do, calls no API
 */

const fs = require("fs");
const path = require("path");

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function todayISO() {
  // Uses UTC date on purpose: GitHub Actions cron runs in UTC, so the
  // workflow schedule and this default should agree. Pass --date=... to
  // override for local testing or backfilling.
  return new Date().toISOString().slice(0, 10);
}

const DRY_RUN = process.argv.includes("--dry-run");
const TARGET_DATE = arg("date") || todayISO();

function loadPosts() {
  const file = path.join(__dirname, "..", "data", "posts.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function savePosts(posts) {
  const file = path.join(__dirname, "..", "data", "posts.json");
  fs.writeFileSync(file, JSON.stringify(posts, null, 2) + "\n");
}

function requireEnv(name) {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

async function graphPost(pathSegment, params) {
  const url = `${GRAPH_BASE}/${pathSegment}`;
  const body = new URLSearchParams(params);
  const res = await fetch(url, { method: "POST", body });
  const json = await res.json();
  if (!res.ok || json.error) {
    const msg = json.error ? json.error.message : `HTTP ${res.status}`;
    throw new Error(`Graph API error on ${pathSegment}: ${msg}`);
  }
  return json;
}

async function postToInstagram({ igUserId, accessToken, imageUrl, caption }) {
  // Step 1: create a media container
  const container = await graphPost(`${igUserId}/media`, {
    image_url: imageUrl,
    caption,
    access_token: accessToken,
  });
  // Step 2: publish the container
  const published = await graphPost(`${igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: accessToken,
  });
  return published;
}

async function postToFacebook({ pageId, accessToken, imageUrl, caption }) {
  const result = await graphPost(`${pageId}/photos`, {
    url: imageUrl,
    caption,
    access_token: accessToken,
  });
  return result;
}

async function main() {
  const posts = loadPosts();
  const entry = posts.find((p) => p.date === TARGET_DATE);

  if (!entry) {
    console.log(`No post scheduled for ${TARGET_DATE}. Nothing to do.`);
    return;
  }

  if (entry.posted && entry.posted.instagram && entry.posted.facebook) {
    console.log(`${TARGET_DATE} ("${entry.title}") is already marked posted on both platforms. Skipping.`);
    return;
  }

  if (!entry.has_image) {
    console.error(
      `No image found for ${TARGET_DATE} ("${entry.title}"). ` +
      `Add images/${entry.image} (1080x1080 JPEG) and re-run ` +
      `scripts/build_posts_json.py before this date's scheduled run.`
    );
    process.exitCode = 1;
    return;
  }

  const imageBaseUrl = requireEnv("IMAGE_BASE_URL").replace(/\/$/, "");
  const imageUrl = `${imageBaseUrl}/${entry.image}`;

  console.log(`Posting ${TARGET_DATE} — "${entry.title}"`);
  console.log(`Image URL: ${imageUrl}`);

  if (DRY_RUN) {
    console.log("--dry-run set: not calling the Graph API. Caption that would be posted:\n");
    console.log(entry.caption);
    return;
  }

  const pageAccessToken = requireEnv("META_PAGE_ACCESS_TOKEN");
  const pageId = requireEnv("META_PAGE_ID");
  const igUserId = requireEnv("META_IG_USER_ID");

  let igResult, fbResult;
  const errors = [];

  if (!entry.posted.instagram) {
    try {
      igResult = await postToInstagram({
        igUserId,
        accessToken: pageAccessToken,
        imageUrl,
        caption: entry.caption,
      });
      entry.posted.instagram = true;
      console.log(`Instagram: published, media id ${igResult.id}`);
    } catch (err) {
      errors.push(`Instagram failed: ${err.message}`);
      console.error(`Instagram: FAILED — ${err.message}`);
    }
  }

  if (!entry.posted.facebook) {
    try {
      fbResult = await postToFacebook({
        pageId,
        accessToken: pageAccessToken,
        imageUrl,
        caption: entry.caption,
      });
      entry.posted.facebook = true;
      console.log(`Facebook: published, post id ${fbResult.id || fbResult.post_id}`);
    } catch (err) {
      errors.push(`Facebook failed: ${err.message}`);
      console.error(`Facebook: FAILED — ${err.message}`);
    }
  }

  savePosts(posts);

  if (errors.length) {
    // Non-zero exit so the GitHub Actions run shows red and Jazz gets notified.
    throw new Error(errors.join(" | "));
  }
}

main().catch((err) => {
  console.error("Poster run failed:", err.message);
  process.exit(1);
});
