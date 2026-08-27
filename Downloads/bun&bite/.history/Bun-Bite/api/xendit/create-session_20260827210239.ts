import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowCors, rejectUnlessPost, requireUser } from "../_http.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (rejectUnlessPost(request, response)) return;

  try {
    const user = await requireUser(request);
    const secretKey = process.env.XENDIT_SECRET_KEY;
    if (!secretKey) throw new Error("XENDIT_SECRET_KEY is not configured.");

    const { orderId, amount, customer, lineItems, origin } = request.body || {};
    const numericAmount = Number(amount);
    if (
      !orderId ||
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0 ||
      customer?.email !== user.email ||
      typeof origin !== "string" ||
      !origin.startsWith("https://")
    ) {
      response.status(400).json({ error: "Invalid payment session request." });
      return;
    }

    const { getAdminDb } = await import("../_firebase-admin.js");
    const orderSnapshot = await getAdminDb().collection("orders").doc(orderId).get();
    const order = orderSnapshot.data();
    if (!orderSnapshot.exists || order?.userId !== user.uid || Number(order.total) !== numericAmount) {
      response.status(400).json({ error: "Order details do not match the authenticated customer." });
      return;
    }

    const xenditResponse = await fetch("https://api.xendit.co/sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reference_id: orderId,
        session_type: "PAY",
        mode: "COMPONENTS",
        amount: numericAmount,
        currency: "PHP",
        country: "PH",
        locale: "en",
        customer: {
          reference_id: user.uid,
          type: "INDIVIDUAL",
          email: customer.email,
          mobile_number: customer.mobile,
          individual_detail: {
            given_names: customer.name,
          },
        },
        items: Array.isArray(lineItems)
          ? lineItems.map((item) => ({
              reference_id: String(item.name || "item").replace(/[^a-zA-Z0-9]/g, "").slice(0, 64) || "item",
              type: "PHYSICAL_PRODUCT",
              name: String(item.name || "Bun & Bite item"),
              net_unit_amount: Number(item.unitPrice),
              quantity: Number(item.quantity),
              currency: "PHP",
              category: "FOOD",
            }))
          : [],
        components_configuration: {
          origins: [origin],
        },
      }),
    });

    const result = await xenditResponse.json();
    if (!xenditResponse.ok || !result.components_sdk_key) {
      response.status(502).json({ error: result?.message || "Xendit payment session creation failed." });
      return;
    }

    allowCors(response);
    response.status(200).json({
      paymentSessionId: result.payment_session_id,
      componentsSdkKey: result.components_sdk_key,
    });
  } catch (error) {
    allowCors(response);
    response.status(500).json({ error: error instanceof Error ? error.message : "Payment session setup failed." });
  }
}