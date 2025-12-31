import Stripe from "stripe";
import twilio from "twilio";
import nodemailer from "nodemailer";
import { buffer } from "micro";

export const config = {
  api: { bodyParser: false },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const smsClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Trigger on completed checkout
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const customerEmail =
      session.customer_details?.email || session.customer_email || "(no email)";

    // Keep content HIPAA-safe: administrative notice only
    const msg = `New membership purchase.
Email: ${customerEmail}
Amount: ${(session.amount_total / 100).toFixed(2)}
Session: ${session.id}`;

    // Email notification
    try {
      await mailer.sendMail({
        from: process.env.NOTIFY_FROM_EMAIL,
        to: process.env.NOTIFY_EMAILS, // comma-separated ok
        subject: "Heat Wave: New membership purchase",
        text: msg,
      });
      console.log("Email notification sent");
    } catch (e) {
      console.error("Email failed:", e);
    }

    // SMS notification
    try {
      await smsClient.messages.create({
        to: process.env.NOTIFY_SMS_TO,
        from: process.env.TWILIO_FROM_NUMBER,
        body: `Heat Wave: New membership purchase. ${customerEmail}`,
      });
      console.log("SMS notification sent");
    } catch (e) {
      console.error("SMS failed:", e);
    }
  }

  res.json({ received: true });
}
