import { type UserProfile } from "./types";
import { type JsonObject, asObject, cleanText, requestJson } from "./client";

export const defaultUserProfile: UserProfile = {
  displayName: "本地用户",
  description: "Orbit operator",
};

/** Normalize a user profile before it is displayed in the Web console. */
export function normalizeUserProfile(value: unknown): UserProfile {
  const record = asObject(value);
  return {
    displayName: cleanText(
      record.displayName,
      defaultUserProfile.displayName,
    ).slice(0, 24),
    description: cleanText(
      record.description,
      defaultUserProfile.description,
    ).slice(0, 48),
  };
}

/** Fetches the current local Web profile from the BFF business API. */
export async function fetchProfile(): Promise<UserProfile> {
  const response = await requestJson<JsonObject>("/api/profile");
  return normalizeUserProfile(response.profile);
}

/** Saves the current local Web profile through the BFF business API. */
export async function updateProfile(
  profile: UserProfile,
): Promise<UserProfile> {
  const response = await requestJson<JsonObject>("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  return normalizeUserProfile(response.profile);
}
