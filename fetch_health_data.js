// Minimal example: OAuth against the Google Health API and fetch exercise data points.
//
// Setup:
//   export GOOGLE_HEALTH_CLIENT_ID="..."
//   export GOOGLE_HEALTH_CLIENT_SECRET="..."
//   node fetch_health_data.js

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile, writeFile } from "node:fs/promises";

const CLIENT_ID = process.env.GOOGLE_HEALTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_HEALTH_CLIENT_SECRET;
const REDIRECT_URI = "https://www.google.com";
const SCOPE = "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://health.googleapis.com/v4";
const TOKEN_FILE = new URL("./.tokens.json", import.meta.url);

async function getAuthorizationCode() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: SCOPE,
  });
  const url = `${AUTH_URL}?${params}`;
  console.log(`Open this URL, sign in, and grant access:\n\n${url}\n`);

  const rl = createInterface({ input: stdin, output: stdout });
  const redirectedUrl = await rl.question(
    "After granting access, paste the full URL you land on (starts with https://www.google.com/?code=...): "
  );
  rl.close();

  const code = new URL(redirectedUrl.trim()).searchParams.get("code");
  if (!code) {
    console.error("Could not find an authorization code in that URL.");
    process.exit(1);
  }
  return code;
}

async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function loadRefreshToken() {
  try {
    const raw = await readFile(TOKEN_FILE, "utf8");
    return JSON.parse(raw).refresh_token ?? null;
  } catch {
    return null;
  }
}

async function saveRefreshToken(refreshToken) {
  await writeFile(TOKEN_FILE, JSON.stringify({ refresh_token: refreshToken }, null, 2));
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function getWeightData(accessToken) {
  const response = await fetch(`${API_BASE}/users/me/dataTypes/weight/dataPoints`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`API call failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error(
      "Set GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET environment variables first."
    );
    process.exit(1);
  }

  let accessToken;
  const savedRefreshToken = await loadRefreshToken();

  if (savedRefreshToken) {
    try {
      const tokens = await refreshAccessToken(savedRefreshToken);
      accessToken = tokens.access_token;
      console.log("Reused saved refresh token — no browser needed.\n");
    } catch {
      console.log("Saved refresh token no longer works, re-authorizing...\n");
    }
  }

  if (!accessToken) {
    const code = await getAuthorizationCode();
    const tokens = await exchangeCodeForTokens(code);
    accessToken = tokens.access_token;
    if (tokens.refresh_token) {
      await saveRefreshToken(tokens.refresh_token);
    }
  }

  const data = await getWeightData(accessToken);

  console.log(JSON.stringify(data, null, 2));
}

main();
