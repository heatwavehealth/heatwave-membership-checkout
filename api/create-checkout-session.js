// api/create-checkout-session.js

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-07-30.basil",
});

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const { plan, billing, addons, service_state } = body;

    // --- WA/OR eligibility gate (server-side hard block)
    const allowedStates = ["WA", "OR"];
    if (!allowedStates.includes(service_state)) {
      return res
        .status(400)
        .json({ error: "Heat Wave Health currently provides care only in WA and OR." });
    }

    // --- Validate inputs
    const validPlans = ["essence", "radiance"];
    const validBilling = ["monthly", "annual"];
    const validAddons = ["nutrition", "metabolic", "sexual", "skinhair"];

    if (!validPlans.includes(plan)) throw new Error("Invalid plan selected");
    if (!validBilling.includes(billing)) throw new Error("Invalid billing selected");

    const selectedAddons = Array.isArray(addons)
      ? addons.filter((a) => validAddons.includes(a))
      : [];

    // --- Price IDs from env
    const PRICE_MAP = {
      essence_monthly: process.env.PRICE_ESSENCE_MONTHLY,
      essence_annual: process.env.PRICE_ESSENCE_ANNUAL,
      radiance_monthly: process.env.PRICE_RADIANCE_MONTHLY,
      radiance_annual: process.env.PRICE_RADIANCE_ANNUAL,
      addon_nutrition: process.env.PRICE_ADDON_NUTRITION,
      addon_metabolic: process.env.PRICE_ADDON_METABOLIC,
      addon_sexual: process.env.PRICE_ADDON_SEXUAL,
      addon_skinhair: process.env.PRICE_ADDON_SKINHAIR,
    };

    for (const [k, v] of Object.entries(PRICE_MAP)) {
      if (!v) throw new Error(`Missing env var for ${k}. Check Vercel env vars.`);
    }

    const planLabel = plan === "essence" ? "Essence" : "Radiance";
    const billingLabel = billing === "monthly" ? "Monthly" : "Annual";

    // --- Build line items
    const line_items = [];

    // Base membership price
    if (plan === "essence" && billing === "monthly") line_items.push({ price: PRICE_MAP.essence_monthly, quantity: 1 });
    if (plan === "essence" && billing === "annual")  line_items.push({ price: PRICE_MAP.essence_annual,  quantity: 1 });
    if (plan === "radiance" && billing === "monthly") line_items.push({ price: PRICE_MAP.radiance_monthly, quantity: 1 });
    if (plan === "radiance" && billing === "annual")  line_items.push({ price: PRICE_MAP.radiance_annual,  quantity: 1 });

    // Add-ons:
    // - If billing is monthly, we can include monthly add-ons in the SAME checkout
    // - If billing is annual, we MUST defer add-ons to webhook (Stripe Checkout limitation)
    const deferAddonsToWebhook = billing === "annual" && selectedAddons.length > 0;

    if (!deferAddonsToWebhook) {
      if (selectedAddons.includes("nutrition")) line_items.push({ price: PRICE_MAP.addon_nutrition, quantity: 1 });
      if (selectedAddons.includes("metabolic")) line_items.push({ price: PRICE_MAP.addon_metabolic, quantity: 1 });
      if (selectedAddons.includes("sexual")) line_items.push({ price: PRICE_MAP.addon_sexual, quantity: 1 });
      if (selectedAddons.includes("skinhair")) line_items.push({ price: PRICE_MAP.addon_skinhair, quantity: 1 });
    }

    const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      billing_address_collection: "required",
      allow_promotion_codes: true,

      // Ensure payment method is saved so webhook can charge add-ons subscription
      subscription_data: {
        payment_settings: { save_default_payment_method: "on_subscription" },
        metadata: {
          // clean labels for Make / internal alerts
          plan: planLabel,
          billing: billingLabel,

          // If annual+addons, store them for webhook to create 2nd subscription
          addons: selectedAddons.length ? selectedAddons.join(", ") : "None",
          addons_deferred: deferAddonsToWebhook ? "true" : "false",

          service_state: String(service_state || ""),
          state_attestation: "true",
        },
      },

      line_items,
      success_url: `${FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/cancel.html`,
    });

    return res.status(200).json({ id: session.id });
  } catch (err) {
    console.error("Error in create-checkout-session:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
