// api/webhooks.js

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-07-30.basil",
});

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("Missing STRIPE_WEBHOOK_SECRET env var");
      return res.status(500).send("Server misconfigured");
    }

    // ---- Read RAW body as Buffer (best practice for signature verification) ----
    const rawBody = await getRawBodyBuffer(req);

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      return res.status(400).send("Missing Stripe signature header");
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      console.error("Stripe webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // ---- Handle checkout completion ----
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // In subscription Checkout, these should exist
      if (!session.subscription || !session.customer) {
        return res
          .status(200)
          .json({ received: true, skipped: "No subscription/customer on session" });
      }

      // Retrieve base subscription so we can read subscription_data.metadata
      const baseSub = await stripe.subscriptions.retrieve(session.subscription, {
        expand: ["default_payment_method", "customer"],
      });

      const md = baseSub.metadata || {};

      // NEW KEY: addons_deferred (set by create-checkout-session.js)
      const addonsDeferred = String(md.addons_deferred || "").toLowerCase() === "true";
      const addonsCsv = String(md.addons || "").trim();

      // Only create add-on subscription if we intentionally deferred it
      if (!addonsDeferred) {
        return res.status(200).json({ received: true, skipped: "Add-ons not deferred" });
      }

      if (!addonsCsv || addonsCsv.toLowerCase() === "none") {
        return res
          .status(200)
          .json({ received: true, skipped: "Add-ons metadata empty/None" });
      }

      const addonKeys = addonsCsv
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      // Map addon key -> env var price id
      const PRICE = {
        nutrition: process.env.PRICE_ADDON_NUTRITION,
        metabolic: process.env.PRICE_ADDON_METABOLIC,
        sexual: process.env.PRICE_ADDON_SEXUAL,
        skinhair: process.env.PRICE_ADDON_SKINHAIR,
      };

      // Validate addon price env vars
      for (const k of addonKeys) {
        if (!PRICE[k]) {
          console.error(`Missing PRICE env var for add-on key: ${k}`);
          return res.status(500).send(`Missing env var for add-on price: ${k}`);
        }
      }

      const items = addonKeys.map((k) => ({ price: PRICE[k], quantity: 1 }));

      const customerId =
        typeof baseSub.customer === "string" ? baseSub.customer : baseSub.customer.id;

      // ---- Duplicate protection ----
      // If Stripe retries webhooks, we must not create duplicates.
      // We mark created add-on subs with parent_subscription + source.
      const existing = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 50,
      });

      const alreadyCreated = existing.data.some(
        (s) =>
          s.metadata &&
          s.metadata.parent_subscription === baseSub.id &&
          s.metadata.source === "deferred-addons"
      );

      if (alreadyCreated) {
        return res
          .status(200)
          .json({ received: true, skipped: "Add-on subscription already exists" });
      }

      // ---- Find a payment method to charge without another checkout ----
      let defaultPmId =
        baseSub.default_payment_method && baseSub.default_payment_method.id
          ? baseSub.default_payment_method.id
          : null;

      if (!defaultPmId && baseSub.customer && baseSub.customer.invoice_settings) {
        const cpm = baseSub.customer.invoice_settings.default_payment_method;
        defaultPmId = typeof cpm === "string" ? cpm : cpm?.id || null;
      }

      if (!defaultPmId) {
        const customer = await stripe.customers.retrieve(customerId);
        const cpm = customer?.invoice_settings?.default_payment_method;
        defaultPmId = typeof cpm === "string" ? cpm : cpm?.id || null;
      }

      if (!defaultPmId) {
        console.error("No default payment method found to create add-on subscription.");
        return res.status(500).send("No default payment method available for add-on subscription.");
      }

      // ---- Create the monthly add-on subscription ----
      const addonSub = await stripe.subscriptions.create(
        {
          customer: customerId,
          default_payment_method: defaultPmId,
          items,
          metadata: {
            parent_subscription: baseSub.id,
            parent_checkout_session: session.id,
            source: "deferred-addons",

            // keep internal metadata consistent for Make alerts
            plan: md.plan || "",
            billing: md.billing || "",
            addons: addonsCsv,
            service_state: md.service_state || "",
            state_attestation: md.state_attestation || "",
          },
        },
        {
          // extra idempotency protection per session
          idempotencyKey: `deferred-addons-${session.id}`,
        }
      );

      return res.status(200).json({
        received: true,
        created: true,
        addon_subscription_id: addonSub.id,
      });
    }

    // Acknowledge other events
    return res.status(200).json({ received: true, ignored: event.type });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).send(err.message || "Webhook server error");
  }
};

// ---- Helper: read raw request body as Buffer ----
function getRawBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
