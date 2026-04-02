module.exports.isValidEmail = (email) => {
    if (!email) return false;

    // 1️⃣ Basic email regex check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return false;

    // 2️⃣ Disallowed disposable email domains
    const disallowedDomains = [
        // "yopmail.com",
        "mailinator.com",
        "tempmail.com",
        "10minutemail.com",
        "guerrillamail.com"
        // add more if needed
    ];

    const domain = email.split("@")[1].toLowerCase();
    if (disallowedDomains.includes(domain)) return false;

    return true;
};

module.exports.isValidUUID = (uuid) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
}

module.exports.isValidRedirectUrl = (url) => {
    if (!url) return false;
    try {
        const parsedUrl = new URL(url);
        const origin = parsedUrl.origin;
        const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",");
        return allowedOrigins.includes(origin);
    } catch (e) {
        return false;
    }
};

