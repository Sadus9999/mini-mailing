import sendHandler from "./send.js";

export default async function panelSend(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    const pass = req.headers["x-panel-password"] || "";
    if (!process.env.PANEL_PASSWORD) {
      return res.status(500).json({ ok: false, error: "Missing PANEL_PASSWORD" });
    }
    if (pass !== process.env.PANEL_PASSWORD) {
      return res.status(401).json({ ok: false, error: "Bad panel password" });
    }

    // Nie pokazujemy SEND_TOKEN w UI — wstrzykujemy go serwerowo:
    req.headers.authorization = `Bearer ${process.env.SEND_TOKEN}`;

    return sendHandler(req, res);
  } catch (e) {
    console.error(e);
    return res.status(500).send(e?.stack || e?.message || String(e));
  }
}
