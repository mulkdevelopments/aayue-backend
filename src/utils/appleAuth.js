const axios = require("axios");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";

let cachedKeys = null;
let cachedAt = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const getEnv = (key) => process.env[key];

const getPrivateKey = () => {
  const raw = getEnv("APPLE_PRIVATE_KEY") || "";
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
};

const generateClientSecret = () => {
  const clientId = getEnv("APPLE_CLIENT_ID");
  const teamId = getEnv("APPLE_TEAM_ID");
  const keyId = getEnv("APPLE_KEY_ID");
  const privateKey = getPrivateKey();

  if (!clientId || !teamId || !keyId || !privateKey) {
    throw new Error("Missing Apple OAuth environment variables");
  }

  return jwt.sign({}, privateKey, {
    algorithm: "ES256",
    keyid: keyId,
    issuer: teamId,
    subject: clientId,
    audience: APPLE_ISSUER,
    expiresIn: "5m",
  });
};

const generateAuthUrl = () => {
  const clientId = getEnv("APPLE_CLIENT_ID");
  const redirectUri = getEnv("APPLE_REDIRECT_URI");

  if (!clientId || !redirectUri) {
    throw new Error("Missing Apple OAuth environment variables");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    response_mode: "form_post",
    scope: "name email",
  });

  return `${APPLE_AUTH_URL}?${params.toString()}`;
};

const exchangeCodeForTokens = async (code) => {
  const clientId = getEnv("APPLE_CLIENT_ID");
  const redirectUri = getEnv("APPLE_REDIRECT_URI");
  const clientSecret = generateClientSecret();

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const res = await axios.post(APPLE_TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return res.data;
};

const getAppleKeys = async () => {
  const now = Date.now();
  if (cachedKeys && now - cachedAt < CACHE_TTL_MS) {
    return cachedKeys;
  }

  const res = await axios.get(APPLE_KEYS_URL);
  cachedKeys = res.data?.keys || [];
  cachedAt = now;
  return cachedKeys;
};

const verifyIdToken = async (idToken) => {
  const decoded = jwt.decode(idToken, { complete: true });
  const kid = decoded?.header?.kid;
  if (!kid) {
    throw new Error("Invalid Apple id_token header");
  }

  const keys = await getAppleKeys();
  const jwk = keys.find((key) => key.kid === kid);
  if (!jwk) {
    throw new Error("Apple public key not found");
  }

  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });

  return jwt.verify(idToken, publicKey, {
    algorithms: ["RS256"],
    audience: getEnv("APPLE_CLIENT_ID"),
    issuer: APPLE_ISSUER,
  });
};

module.exports = {
  generateAuthUrl,
  exchangeCodeForTokens,
  verifyIdToken,
};
