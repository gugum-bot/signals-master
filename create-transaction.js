// netlify/functions/create-transaction.js
// Membuat token transaksi Midtrans Snap
// Dipanggil dari frontend saat user klik "Bayar"

const https = require("https");

// ── KONFIGURASI ──────────────────────────────────────────────
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const IS_PRODUCTION       = process.env.MIDTRANS_ENV === "production";
const MIDTRANS_BASE_URL   = IS_PRODUCTION
  ? "https://app.midtrans.com/snap/v1/transactions"
  : "https://app.sandbox.midtrans.com/snap/v1/transactions";
// ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Method Not Allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return respond(400, { error: "Invalid JSON" });
  }

  const { name, email, phone, amount, product } = body;

  if (!name || !email || !phone || !amount) {
    return respond(400, { error: "Data tidak lengkap" });
  }

  // Generate order ID unik
  const orderId = `SMP-${Date.now()}-${Math.random().toString(36).substr(2,5).toUpperCase()}`;

  const payload = {
    transaction_details: {
      order_id: orderId,
      gross_amount: parseInt(amount),
    },
    customer_details: {
      first_name: name,
      email: email,
      phone: phone,
    },
    item_details: [
      {
        id: "SMP-3BULAN",
        price: parseInt(amount),
        quantity: 1,
        name: product || "SignalMaster Pro - 3 Bulan",
      },
    ],
    // Data dikirim ke webhook untuk proses invite link
    custom_field1: email,
    custom_field2: name,
    custom_field3: phone,
    // Metode pembayaran aktif
    enabled_payments: [
      "bca_va", "bni_va", "bri_va", "mandiri_bill",
      "permata_va", "other_va",
      "gopay", "shopeepay", "dana", "ovo",
      "qris", "credit_card",
    ],
    // Kadaluarsa 24 jam
    expiry: {
      unit: "hours",
      duration: 24,
    },
  };

  try {
    const token = await createMidtransToken(payload);
    return respond(200, { token, order_id: orderId });
  } catch (err) {
    console.error("Midtrans error:", err.message);
    return respond(500, { error: "Gagal membuat transaksi. Coba lagi." });
  }
};

function createMidtransToken(payload) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(payload);
    const auth    = Buffer.from(`${MIDTRANS_SERVER_KEY}:`).toString("base64");
    const url     = new URL(MIDTRANS_BASE_URL);

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
        "Authorization": `Basic ${auth}`,
        "Accept": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.token) resolve(json.token);
          else reject(new Error(JSON.stringify(json)));
        } catch (e) { reject(e); }
      });
    });

    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
    body: JSON.stringify(body),
  };
}
