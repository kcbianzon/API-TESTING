import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAdminDb } from "../_firebase-admin.js";
import { allowCors, rejectUnlessPost } from "../_http.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (rejectUnlessPost(request, response)) return;

  const callbackToken = process.env.XENDIT_CALLBACK_TOKEN;
  if (!callbackToken || request.headers["x-callback-token"] !== callbackToken) {
    response.status(401).json({ error: "Invalid callback token." });
    return;
  }

  try {
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
    response.status(500).json({ error: error instanceof Error ? error.message : "Webhook handling failed." });
  }
}