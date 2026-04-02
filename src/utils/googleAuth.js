// utils/googleOAuth.js
const axios = require("axios");
const qs = require("qs");
dotenv = require("dotenv");
dotenv.config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const SCOPE = "openid email profile";

function generateAuthUrl() {
  const base = "https://accounts.google.com/o/oauth2/v2/auth";
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline", // ask for refresh token on first consent
    prompt: "consent", // forces consent to get refresh_token (optional)
  });
  return `${base}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const url = "https://oauth2.googleapis.com/token";
  const data = {
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  };

  const res = await axios.post(url, qs.stringify(data), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return res.data; // contains access_token, id_token, refresh_token (maybe)
}

async function getUserInfo(accessToken) {
  const url = "https://www.googleapis.com/oauth2/v3/userinfo";
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // Normalize object to fields we expect
  return {
    sub: res.data.sub,
    email: res.data.email,
    name: res.data.name,
    picture: res.data.picture,
    email_verified: res.data.email_verified,
  };
}

module.exports = { generateAuthUrl, exchangeCodeForTokens, getUserInfo };
