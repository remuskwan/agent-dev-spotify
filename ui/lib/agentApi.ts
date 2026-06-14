import type { CreateSessionResponse, TurnResponse, SnapshotResponse } from "./types";

const BASE_URL =
  process.env.NEXT_PUBLIC_AGENT_API_URL ?? "http://localhost:8787";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function createSession(userId?: string): Promise<CreateSessionResponse> {
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(userId ? { userId } : {}),
  });
  return handleResponse<CreateSessionResponse>(res);
}

export async function sendMessage(
  conversationId: string,
  message: string
): Promise<TurnResponse> {
  const res = await fetch(`${BASE_URL}/sessions/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  return handleResponse<TurnResponse>(res);
}

export async function getSnapshot(conversationId: string): Promise<SnapshotResponse> {
  const res = await fetch(`${BASE_URL}/sessions/${conversationId}`);
  return handleResponse<SnapshotResponse>(res);
}

export async function deleteSession(conversationId: string): Promise<void> {
  await fetch(`${BASE_URL}/sessions/${conversationId}`, { method: "DELETE" });
}
