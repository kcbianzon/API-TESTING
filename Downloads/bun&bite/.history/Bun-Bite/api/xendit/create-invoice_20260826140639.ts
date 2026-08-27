import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowCors, rejectUnlessPost, requireUser } from "../_http.js";
import { getAdminDb } from "../_firebase-admin.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (rejectUnlessPost(request, response)) return;

  try {
    const user = await requireUser(request);
    const secretKey = process.env.XENDIT_SECRET_KEY;
    if (!secretKey) throw new Error("XENDIT_SECRET_KEY is not configured.");

    const { orderId, amount, customer, lineItems, successUrl, cancelUrl } = request.body || {};
    const numericAmount = Number(amount);
    if (!orderId || !Number.isFinite(numericAmount) || numericAmount <= 0 || customer?.email !== user.email) {
      response.status(400).json({ error: "Invalid invoice request." });
      return;
    }

    const orderSnapshot = await getAdminDb().collection("orders").doc(orderId).get();
    const order = orderSnapshot.data();
    if (!orderSnapshot.exists || order?.userId !== user.uid || Number(order.total) !== numericAmount) {
      response.status(400).json({ error: "Order details do not match the authenticated customer." });
      return;
    }

    const xenditResponse = await fetch("https://api.xendit.co/v2/invoices", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        external_id: orderId,
        amount: numericAmount,
        payer_email: customer.email,
        description: `Bun & Bite order ${orderId}`,
        success_redirect_url: successUrl,
        failure_redirect_url: cancelUrl,
        items: Array.isArray(lineItems) ? lineItems : [],
      }),
    });

    const result = await xenditResponse.json();
    if (!xenditResponse.ok) {
      response.status(502).json({ error: result?.message || "Xendit invoice creation failed." });
      return;
    }

    allowCors(response);
    response.status(200).json({ invoiceUrl: result.invoice_url, invoiceId: result.id });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Payment setup failed." });
  }
}