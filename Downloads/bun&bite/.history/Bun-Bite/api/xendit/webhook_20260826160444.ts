import type { VercelRequest, VercelResponse } from "@vercel/node";

function allowCors(response: VercelResponse) {
  response.setHeader("Access-Control-Allow-Origin", process.env.APP_ORIGIN || "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Callback-Token");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function rejectUnlessPost(request: VercelRequest, response: VercelResponse) {
  allowCors(response);
  if (request.method === "OPTIONS") {
    response.status(204).end();
    return true;
  }
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return true;
  }
  return false;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (rejectUnlessPost(request, response)) return;

  const callbackToken = process.env.XENDIT_CALLBACK_TOKEN;
  if (!callbackToken || request.headers["x-callback-token"] !== callbackToken) {
    response.status(401).json({ error: "Invalid callback token." });
    return;
  }

  try {
    const { getAdminDb } = await import("../_firebase-admin.js");
    const { external_id: orderId, status } = request.body || {};
    if (!orderId || !["PAID", "SETTLED", "EXPIRED"].includes(status)) {
      response.status(400).json({ error: "Invalid webhook payload." });
      return;
    }

    const paymentStatus = status === "EXPIRED" ? "failed" : "paid";
    const orderStatus = status === "EXPIRED" ? "cancelled" : "preparing";
    const db = getAdminDb();
    const orderSnapshot = await db.collection("orders").doc(orderId).get();
    if (!orderSnapshot.exists) {
      response.status(404).json({ error: "Order not found." });
      return;
    }

    const order = orderSnapshot.data() || {};
    const updates = { paymentStatus, orderStatus, updatedAt: new Date().toISOString() };
    await orderSnapshot.ref.update(updates);
    if (order.userId) {
      await db.collection("users").doc(order.userId).collection("orders").doc(orderId).update(updates);
    }

    allowCors(response);
    response.status(200).json({ ok: true });
  } catch (error) {
    allowCors(response);
    response.status(500).json({ error: error instanceof Error ? error.message : "Webhook handling failed." });
  }
}