import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readTemplate() {
  const p = path.join(process.cwd(), "templates", "xmas.html");
  return fs.readFileSync(p, "utf8");
}

function must(envName) {
  const v = process.env[envName];
  if (!v) throw new Error(`Missing env: ${envName}`);
  return v;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== process.env.SEND_TOKEN) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const { subject, fromName, fromEmail, recipients, delayMs = 2500 } = req.body || {};
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ ok: false, error: "recipients[] required" });
  }

  const SMTP_HOST = must("SMTP_HOST");
  const SMTP_PORT = Number(must("SMTP_PORT"));
  const SMTP_USER = must("SMTP_USER");
  const SMTP_PASS = must("SMTP_PASS");

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: "TLSv1.2" }
  });

  const tpl = readTemplate();

  const results = [];
  for (let i = 0; i < recipients.length; i++) {
    const { email, name } = recipients[i] || {};
    if (!email) {
      results.push({ email: null, ok: false, error: "Missing email" });
      continue;
    }

    const html = tpl.replaceAll("{{name}}", name || "");

    try {
      await transporter.sendMail({
        from: `"${fromName || process.env.FROM_NAME || "N42 Group"}" <${fromEmail || process.env.FROM_EMAIL || SMTP_USER}>`,
        to: email,
        subject: subject || process.env.SUBJECT || "Wiadomość",
        html,
        text: "Wersja tekstowa: Świąteczna wiadomość od N42 Group."
      });

      results.push({ email, ok: true });
    } catch (e) {
      results.push({ email, ok: false, error: e?.message || String(e) });
    }

    if (i < recipients.length - 1) await sleep(delayMs);
  }

  return res.status(200).json({ ok: true, sent: results });
}
