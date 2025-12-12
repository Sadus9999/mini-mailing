import nodemailer from "nodemailer";
import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function readTemplate() {
  return fs.readFileSync(
    path.join(process.cwd(), "templates", "xmas.html"),
    "utf8"
  );
}

function parseRecipientsFromCSV(csvText) {
  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${process.env.SEND_TOKEN}`) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const { csv, batchSize = 30, delayMs = 4000, subject } = req.body || {};
    if (!csv || typeof csv !== "string") {
      return res.status(400).json({ ok: false, error: "Missing csv in body" });
    }

    const SMTP_HOST = must("SMTP_HOST");
    const SMTP_PORT = Number(must("SMTP_PORT"));
    const SMTP_USER = must("SMTP_USER");
    const SMTP_PASS = must("SMTP_PASS");
    const FROM_NAME = process.env.FROM_NAME || "N42 Group";
    const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { minVersion: "TLSv1.2" },
    });

    await transporter.verify();

    const template = readTemplate();
    const recipients = parseRecipientsFromCSV(csv).filter((r) => r.email);

    let sent = 0;
    const results = [];

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);

      for (const r of batch) {
        const html = template.replaceAll("{{name}}", r.name || "");

        try {
          await transporter.sendMail({
            from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
            to: r.email,
            subject: subject || process.env.SUBJECT || "Wiadomość",
            html,
            text: "Świąteczna wiadomość od N42 Group.",
          });

          sent++;
          results.push({ email: r.email, ok: true });
        } catch (e) {
          results.push({ email: r.email, ok: false, error: e?.message || String(e) });
        }

        await sleep(delayMs);
      }

      // przerwa między paczkami (10s)
      if (i + batchSize < recipients.length) await sleep(10000);
    }

    return res.status(200).json({ ok: true, sent, results });
  } catch (e) {
    console.error(e);
    return res.status(500).send(e?.stack || e?.message || String(e));
  }
}
