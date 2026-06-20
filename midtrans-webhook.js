// netlify/functions/midtrans-webhook.js
// Menerima notifikasi pembayaran dari Midtrans
// Lalu generate Telegram invite link & kirim ke email member

const crypto = require("crypto");
const https = require("https");

// ============================================================
// KONFIGURASI — isi sesuai akun Anda
// ============================================================
const CONFIG = {
  // Midtrans
  MIDTRANS_SERVER_KEY: process.env.MIDTRANS_SERVER_KEY, // dari Midtrans Dashboard

  // Telegram Bot
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,  // dari @BotFather
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,       // ID channel/group Anda (misal: -1001234567890)

  // Email via EmailJS
  EMAILJS_SERVICE_ID: process.env.EMAILJS_SERVICE_ID,
  EMAILJS_TEMPLATE_ID: process.env.EMAILJS_TEMPLATE_ID,
  EMAILJS_PUBLIC_KEY: process.env.EMAILJS_PUBLIC_KEY,
  EMAILJS_PRIVATE_KEY: process.env.EMAILJS_PRIVATE_KEY,

  // Nama produk (untuk email)
  PRODUCT_NAME: "SignalMaster Pro",
};
// ============================================================

exports.handler = async (event) => {
  // Hanya terima POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const {
    order_id,
    status_code,
    gross_amount,
    transaction_status,
    fraud_status,
    signature_key,
    custom_field1: memberEmail,  // email dikirim via custom_field1 dari frontend
    custom_field2: memberName,   // nama member via custom_field2
  } = body;

  // ── 1. Verifikasi signature Midtrans ──────────────────────
  const expectedSignature = crypto
    .createHash("sha512")
    .update(`${order_id}${status_code}${gross_amount}${CONFIG.MIDTRANS_SERVER_KEY}`)
    .digest("hex");

  if (signature_key !== expectedSignature) {
    console.error("Signature mismatch!");
    return { statusCode: 403, body: "Forbidden: Invalid signature" };
  }

  // ── 2. Cek status pembayaran ──────────────────────────────
  const isSuccess =
    (transaction_status === "settlement" ||
      transaction_status === "capture") &&
    fraud_status !== "deny";

  if (!isSuccess) {
    console.log(`Payment not settled. Status: ${transaction_status}`);
    return { statusCode: 200, body: "OK - Payment not settled yet" };
  }

  // ── 3. Generate Telegram invite link (1x pakai, 30 hari) ──
  let inviteLink;
  try {
    inviteLink = await generateTelegramInviteLink();
  } catch (err) {
    console.error("Failed to generate invite link:", err);
    return { statusCode: 500, body: "Failed to generate invite link" };
  }

  // ── 4. Kirim email ke member ──────────────────────────────
  if (!memberEmail) {
    console.error("No member email found in custom_field1");
    return { statusCode: 400, body: "No member email" };
  }

  try {
    await sendEmailViaEmailJS({
      to_email: memberEmail,
      to_name: memberName || "Member",
      invite_link: inviteLink,
      order_id,
    });
  } catch (err) {
    console.error("Failed to send email:", err);
    return { statusCode: 500, body: "Failed to send email" };
  }

  console.log(`✅ Invite sent to ${memberEmail} | Link: ${inviteLink}`);
  return { statusCode: 200, body: "OK" };
};

// ─────────────────────────────────────────────────────────────
// Helper: Generate Telegram invite link (1x pakai, expire 30 hari)
// ─────────────────────────────────────────────────────────────
function generateTelegramInviteLink() {
  return new Promise((resolve, reject) => {
    const expireDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30 hari
    const payload = JSON.stringify({
      chat_id: CONFIG.TELEGRAM_CHAT_ID,
      member_limit: 1,        // hanya bisa dipakai 1 orang
      expire_date: expireDate,
    });

    const options = {
      hostname: "api.telegram.org",
      path: `/bot${CONFIG.TELEGRAM_BOT_TOKEN}/createChatInviteLink`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.ok && json.result?.invite_link) {
            resolve(json.result.invite_link);
          } else {
            reject(new Error(JSON.stringify(json)));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────
// Helper: Kirim email via EmailJS REST API
// ─────────────────────────────────────────────────────────────
function sendEmailViaEmailJS({ to_email, to_name, invite_link, order_id }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      service_id: CONFIG.EMAILJS_SERVICE_ID,
      template_id: CONFIG.EMAILJS_TEMPLATE_ID,
      user_id: CONFIG.EMAILJS_PUBLIC_KEY,
      accessToken: CONFIG.EMAILJS_PRIVATE_KEY,
      template_params: {
        to_email,
        to_name,
        invite_link,
        order_id,
        product_name: CONFIG.PRODUCT_NAME,
      },
    });

    const options = {
      hostname: "api.emailjs.com",
      path: "/api/v1.0/email/send",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`EmailJS error: ${res.statusCode} — ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}
