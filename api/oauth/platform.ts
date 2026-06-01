import { env } from "../lib/env";
import type { UserProfile } from "./types";

async function platformRequest<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T | null> {
  if (token === "mock-access-token") {
    return {
      user_id: env.ownerUnionId || "mock-user-id",
      name: "Local Administrator",
      avatar_url: "https://avatar.iran.liara.run/public/boy",
    } as unknown as T;
  }

  const resp = await fetch(`${env.authPlatformUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.warn(
      `[auth-platform] Request to ${path} failed (${resp.status}): ${text}`,
    );
    return null;
  }
  return resp.json() as Promise<T>;
}

export const users = {
  getProfile: (token: string) =>
    platformRequest<UserProfile>("/v1/users/me/profile", token),
};
