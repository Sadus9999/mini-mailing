import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

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

  return parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${process.env.SEND_TOKEN}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const {
    delayMs = 4000,
    batchSize = 30,
    subject = process.env.SUBJECT,
  } = req.body || {};

  const SMTP_HOST = must("SMTP_HOST");
  const SMTP_PORT = Number(must("SMTP_PORT"));
  const SMTP_USER = must("SMTP_USER");
  const SMTP_PASS = must("SMTP_PASS");

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: "TLSv1.2" },
  });

  await transporter.verify();

  const template = readTemplate();
const { csv } = req.body || {};
if (!csv || typeof csv !== "string") {
  return res.status(400).json({ ok: false, error: "Missing csv in body" });
}
const recipients = parseRecipientsFromCSV(csv);

  let sent = 0;

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);

    for (const r of batch) {
      if (!r.email) continue;

      const html = template.replaceAll("{{name}}", r.name || "");

      await transporter.sendMail({
        from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
        to: r.email,
        subject,
        html,
        text: "Świąteczna wiadomość od N42 Group",
      });

      sent++;
      await sleep(delayMs);
    }

    // przerwa między paczkami
    await sleep(10000);
  }

  return res.json({ ok: true, sent });
}
