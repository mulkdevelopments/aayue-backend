/**
 * Fetches carrier shipment events via 17TRACK API (optional).
 * Set SEVENTEEN_TRACK_API_KEY in env — https://www.17track.net/en/api
 */

const axios = require("axios");

const GET_TRACK = "https://api.17track.net/track/v2.2/gettrackinfo";
const REGISTER = "https://api.17track.net/track/v2.2/register";

/** Carrier hint → 17TRACK key; omit = auto-detect (safer for DHL/UPS variants) */
function carrierHintToKey(carrierName) {
  if (!carrierName || typeof carrierName !== "string") return undefined;
  const n = carrierName.toLowerCase();
  if (n.includes("fedex")) return 100003;
  return undefined;
}

function normalizeEvents(accepted) {
  if (!accepted?.track_info) return { events: [], latestStatus: null, milestones: [] };

  const ti = accepted.track_info;
  const latestStatus = ti.latest_status || null;
  const milestones = Array.isArray(ti.milestone) ? ti.milestone : [];

  const providers = ti.tracking?.providers || [];
  const raw = [];
  for (const p of providers) {
    const provName = p.provider?.name || p.provider?.alias || "Carrier";
    for (const e of p.events || []) {
      const loc =
        e.location ||
        [e.address?.city, e.address?.state, e.address?.country]
          .filter(Boolean)
          .join(", ") ||
        null;
      raw.push({
        timeUtc: e.time_utc || e.time_iso || null,
        timeIso: e.time_iso || null,
        description:
          e.description_translation?.description || e.description || e.stage || "Update",
        location: loc,
        stage: e.stage || null,
        provider: provName,
      });
    }
  }

  const seen = new Set();
  const events = [];
  for (const ev of raw) {
    const k = `${ev.timeUtc}|${ev.description}|${ev.location}`;
    if (seen.has(k)) continue;
    seen.add(k);
    events.push(ev);
  }
  events.sort((a, b) => {
    const ta = a.timeUtc ? new Date(a.timeUtc).getTime() : 0;
    const tb = b.timeUtc ? new Date(b.timeUtc).getTime() : 0;
    return tb - ta;
  });

  return { events, latestStatus, milestones };
}

function formatAddr(addr) {
  if (!addr || typeof addr !== "object") return null;
  const parts = [addr.city, addr.state, addr.country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** ETA, service type, route — for admin shipment summary */
function buildShipmentSummary(accepted) {
  if (!accepted?.track_info) return null;
  const ti = accepted.track_info;
  const tm = ti.time_metrics || {};
  const edd = tm.estimated_delivery_date;
  let estimatedFrom = null;
  let estimatedTo = null;
  if (edd && typeof edd === "object") {
    estimatedFrom = edd.from || null;
    estimatedTo = edd.to || edd.from || null;
  }
  const misc = ti.misc_info || {};
  const ship = ti.shipping_info || {};
  const le = ti.latest_event || {};
  return {
    estimatedFrom,
    estimatedTo,
    estimatedSource: edd?.source || null,
    serviceType: misc.service_type || null,
    weight: misc.weight_raw || misc.weight_kg || null,
    pieces: misc.pieces || null,
    origin: formatAddr(ship.shipper_address),
    destination: formatAddr(ship.recipient_address),
    lastScanDescription:
      le.description_translation?.description || le.description || null,
    lastScanTimeUtc: le.time_utc || le.time_iso || null,
    lastScanLocation: le.location || formatAddr(le.address) || null,
  };
}

/**
 * @param {string} number - tracking number
 * @param {string} [carrierName] - e.g. FedEx
 * @returns {Promise<{ configured: boolean, events: Array, milestones?: Array, latestStatus?: object, message?: string, error?: string }>}
 */
async function fetchCarrierTimeline(number, carrierName) {
  const key = process.env.SEVENTEEN_TRACK_API_KEY || process.env.TRACK17_API_KEY;
  const trimmed = String(number || "").trim();
  if (!trimmed) {
    return { configured: !!key, events: [], message: "Missing tracking number" };
  }
  if (!key) {
    return {
      configured: false,
      events: [],
      message:
        "Carrier timelines need SEVENTEEN_TRACK_API_KEY (17TRACK). Add key in server env or track on carrier site.",
    };
  }

  const headers = {
    "17token": key,
    "Content-Type": "application/json",
  };

  const carrierKey = carrierHintToKey(carrierName);
  const payload = carrierKey ? [{ number: trimmed, carrier: carrierKey }] : [{ number: trimmed }];

  try {
    await axios.post(REGISTER, [{ number: trimmed }], { headers, timeout: 15000 }).catch(() => {});

    const { data } = await axios.post(GET_TRACK, payload, {
      headers,
      timeout: 25000,
    });

    if (data.code !== 0 && data.code !== undefined) {
      return {
        configured: true,
        events: [],
        error: data.message || `17TRACK code ${data.code}`,
      };
    }

    const accepted = data.data?.accepted?.[0];
    if (!accepted) {
      return {
        configured: true,
        events: [],
        message: "No tracking data from carrier yet. Try again in a few hours.",
      };
    }

    let { events, latestStatus, milestones } = normalizeEvents(accepted);
    if (events.length === 0 && milestoneHasAnyTime(milestones)) {
      events = milestonesToEvents(milestones);
    }
    const shipmentSummary = buildShipmentSummary(accepted);
    return {
      configured: true,
      events,
      latestStatus,
      milestones,
      shipmentSummary,
      message:
        events.length === 0
          ? "No scan events yet. Register may take a few minutes — try again shortly."
          : undefined,
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.message || "Tracking request failed";
    return { configured: true, events: [], error: msg };
  }
}

function milestoneHasAnyTime(milestones) {
  return milestones.some((m) => m.time_utc || m.time_iso);
}

function milestonesToEvents(milestones) {
  const labels = {
    InfoReceived: "Info received",
    PickedUp: "Picked up",
    Departure: "Departed",
    Arrival: "Arrived",
    OutForDelivery: "Out for delivery",
    Delivered: "Delivered",
    AvailableForPickup: "Available for pickup",
    Returning: "Returning",
    Returned: "Returned",
  };
  return milestones
    .filter((m) => m.time_utc || m.time_iso)
    .map((m) => ({
      timeUtc: m.time_utc || m.time_iso,
      timeIso: m.time_iso,
      description: labels[m.key_stage] || m.key_stage || "Milestone",
      location: null,
      stage: m.key_stage,
      provider: "Milestone",
    }))
    .sort((a, b) => new Date(b.timeUtc) - new Date(a.timeUtc));
}

module.exports = { fetchCarrierTimeline, carrierHintToKey };
