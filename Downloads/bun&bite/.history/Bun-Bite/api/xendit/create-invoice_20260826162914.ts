import type { VercelRequest, VercelResponse } from "@vercel/node";

function allowCors(response: VercelResponse) {
  response.setHeader("Access-Control-Allow-Origin", process.env.APP_ORIGIN || "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

async function requireUser(request: VercelRequest) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    throw new Error("Missing Firebase authentication token.");
  }
  const { getAdminAuth } = await import("../_firebase-admin.js");
  return getAdminAuth().verifyIdToken(authorization.slice("Bearer ".length));
}

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

    const { getAdminDb } = await import("../_firebase-admin.js");
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
        items: Array.isArray(lineItems)
          ? lineItems.map((item) => ({
              name: String(item.name || "Bun & Bite item"),
              price: Number(item.unitPrice),
              quantity: Number(item.quantity),
            }))
          : [],
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
    allowCors(response);
    response.status(500).json({ error: error instanceof Error ? error.message : "Payment setup failed." });
  }
}