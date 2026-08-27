import type { VercelRequest, VercelResponse } from "@vercel/node";

export function allowCors(response: VercelResponse) {
  response.setHeader("Access-Control-Allow-Origin", process.env.APP_ORIGIN || "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Callback-Token");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

export function rejectUnlessPost(request: VercelRequest, response: VercelResponse) {
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

export async function requireUser(request: VercelRequest) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    throw new Error("Missing Firebase authentication token.");
  }
  return getUserFromToken(authorization.slice("Bearer ".length));
}

async function getUserFromToken(token: string) {
  const { getAdminAuth } = await import("./_firebase-admin");
  return getAdminAuth().verifyIdToken(token);
}