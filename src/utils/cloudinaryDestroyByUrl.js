const cloudinary = require("../config/cloudinary");

/**
 * Best-effort destroy by full Cloudinary delivery URL (same logic as banner cleanup).
 */
async function destroyCloudinaryAssetByUrl(assetUrl) {
  if (!assetUrl || !String(assetUrl).includes("cloudinary.com")) return;
  let parsedUrl;
  try {
    parsedUrl = new URL(assetUrl);
  } catch {
    return;
  }
  const parts = parsedUrl.pathname.split("/").filter(Boolean);
  const uploadIndex = parts.findIndex((part) => part === "upload");
  if (uploadIndex === -1 || uploadIndex + 1 >= parts.length) return;
  const resourceType = parts[uploadIndex - 1] || "image";
  let publicParts = parts.slice(uploadIndex + 1);
  if (publicParts[0] && /^v\d+$/.test(publicParts[0])) {
    publicParts = publicParts.slice(1);
  }
  const filename = publicParts.join("/");
  const publicId = filename.replace(/\.[^/.]+$/, "");
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    invalidate: true,
  });
}

module.exports = { destroyCloudinaryAssetByUrl };
