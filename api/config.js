export default function handler(req, res) {
  const pk = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!pk) return res.status(500).json({ error: "Missing STRIPE_PUBLISHABLE_KEY" });
  res.status(200).json({ publishableKey: pk });
}
