import { parse } from "csv-parse/sync";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function detectDelimiter(text) {
  const firstLine = (text || "").split(/\r?\n/)[0] || "";
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  return semicolons > commas ? ";" : ",";
}

function parseRecipientsFromCSV(csvText) {
  const delimiter = detectDelimiter(csvText);
  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter,
  });
}

async function readRawBody(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  data = data.replace(/^\uFEFF/, ""); // usuń BOM
  return data;
}

// Prosty cache tokenu (działa w ramach "ciepłego" serverless)
let tokenCache = { accessToken: "", expiresAt: 0 };

async function getGraphAccessToken() {
  const tenantId = must("M365_TENANT_ID");
  const clientId = must("M365_CLIENT_ID");
  const clientSecret = must("M365_CLIENT_SECRET");

  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.accessToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Token error ${res.status}: ${JSON.stringify(json)}`);
  }

  tokenCache.accessToken = json.access_token;
  tokenCache.expiresAt = Date.now() + (Number(json.expires_in || 3600) * 1000);
  return tokenCache.accessToken;
}

async function graphSendMail({ accessToken, sender, fromName, toEmail, subject, html }) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`;

  const payload = {
    message: {
      subject,
      body: { contentType: "HTML", content: html },
      toRecipients: [{ emailAddress: { address: toEmail } }],
    },
    saveToSentItems: true,
  };

  // "from" w Graph dla app-permissions jest związane z /users/{sender}, więc fromName to kosmetyka:
  // nazwa nadawcy zwykle pochodzi z ustawień skrzynki / kontaktu. Zostawiamy subject/body/to.
  // Jeśli chcesz, możemy dorobić wymuszenie displayName przez ustawienia mailboxa.

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph sendMail ${res.status}: ${text}`);
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    // AUTH do panelu (działa i z X-Panel-Password i z Authorization: Bearer)
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

    const { csv, html, batchSize = 30, delayMs = 4000, subject } = body || {};

    if (!csv || typeof csv !== "string") {
      return res.status(400).json({ ok: false, error: "Missing csv in body" });
    }
    if (!html || typeof html !== "string" || !html.trim()) {
      return res.status(400).json({ ok: false, error: "Missing html in body" });
    }

    const sender = must("M365_SENDER");
    const fromName = process.env.FROM_NAME || "N42 Group";
    const finalSubject = subject || process.env.SUBJECT || "Wiadomość";

    const recipients = parseRecipientsFromCSV(csv)
      .map((r) => ({
        email: String(r.email || "").trim(),
        name: String(r.name || "").trim(),
      }))
      .filter((r) => r.email && r.email.includes("@"));

    const accessToken = await getGraphAccessToken();

    let sent = 0;

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);

      for (const r of batch) {
        const personalized = html.replaceAll("{{name}}", r.name || "");
        await graphSendMail({
          accessToken,
          sender,
          fromName,
          toEmail: r.email,
          subject: finalSubject,
          html: personalized,
        });

        sent++;
        await sleep(delayMs);
      }

      if (i + batchSize < recipients.length) await sleep(8000);
    }

    return res.status(200).json({ ok: true, sent });
  } catch (e) {
    console.error(e);
    return res.status(500).send(e?.stack || e?.message || String(e));
  }
}



