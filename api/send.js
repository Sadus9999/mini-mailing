import nodemailer from "nodemailer";
import { parse } from "csv-parse/sync";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function parseRecipientsFromCSV(csvText) {
  return parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
}

async function readRawBody(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  // usuń BOM jeśli PowerShell dodał
  data = data.replace(/^\uFEFF/, "");
  return data;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    // AUTH: pasuje do panelu (header X-Panel-Password)
const token = (process.env.SEND_TOKEN || "").toString();
const passHeader = (req.headers["x-panel-password"] || "").toString();
const auth = (req.headers.authorization || "").toString();
const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";

if (!token) {
  return res.status(500).json({ ok: false, error: "Missing env: SEND_TOKEN" });
}

if (passHeader !== token && bearer !== token) {
  return res.status(401).json({ ok: false, error: "Unauthorized" });
}
    const raw = await readRawBody(req);

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid JSON body" });
    }

    const {
      csv,
      html, // <-- HTML mailingu przychodzi z panelu
      batchSize = 30,
      delayMs = 4000,
      subject,
    } = body || {};

    if (!csv || typeof csv !== "string") {
      return res.status(400).json({ ok: false, error: "Missing csv in body" });
    }

    if (!html || typeof html !== "string" || !html.trim()) {
      return res.status(400).json({ ok: false, error: "Missing html in body" });
    }

    const SMTP_HOST = must("SMTP_HOST");
    const SMTP_PORT = Number(must("SMTP_PORT"));
    const SMTP_USER = must("SMTP_USER");
    const SMTP_PASS = must("SMTP_PASS");
    const FROM_NAME = process.env.FROM_NAME || "N42 Group";
    const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

const transporter = nodemailer.createTransport({
  host: "n42-pl.mail.protection.outlook.com",
  port: 25,
  secure: false,
  tls: { minVersion: "TLSv1.2" },
});

const template = html;
const recipients = parseRecipientsFromCSV(csv).filter((r) => r.email);

    let sent = 0;

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);

      for (const r of batch) {
        const personalized = template.replaceAll("{{name}}", r.name || "");
await transporter.sendMail({
  from: `"N42 Group" <n42@n42.pl>`,
  to: "klient@gmail.com",
  subject: "Test",
  html: "<b>Test</b>",
});

        sent++;
        await sleep(delayMs);
      }

      // mała przerwa między batchami (żeby nie wyglądało jak spam)
      if (i + batchSize < recipients.length) await sleep(10000);
    }

    return res.status(200).json({ ok: true, sent });
  } catch (e) {
    console.error(e);
    return res.status(500).send(e?.stack || e?.message || String(e));
  }
}




