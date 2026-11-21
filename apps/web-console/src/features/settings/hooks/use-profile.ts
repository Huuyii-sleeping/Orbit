import { getErrorMessage } from "../../../lib/errors/error-factory";
import { useEffect, useState } from "react";
import {
  defaultUserProfile,
  fetchProfile,
  updateProfile,
  type UserProfile,
} from "../../../api";
import {
  getNextTheme,
  readStoredTheme,
  writeStoredTheme,
  type ThemeMode,
} from "../../../theme";

/** 管理个人资料编辑和主题偏好。 */
export function useProfile(setError: (error: string | null) => void) {
  const [profile, setProfile] = useState<UserProfile>(defaultUserProfile);
  const [profileDraft, setProfileDraft] = useState<UserProfile>(profile);
  const [editingProfile, setEditingProfile] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() =>
    typeof window === "undefined"
      ? "dark"
      : readStoredTheme(window.localStorage),
  );

  async function refreshProfile(): Promise<void> {
    const nextProfile = await fetchProfile();
    setProfile(nextProfile);
    setProfileDraft(nextProfile);
  }

  function handleThemeToggle(): void {
    setTheme((current) => {
      const next = getNextTheme(current);
      writeStoredTheme(window.localStorage, next);
      return next;
    });
  }

  function toggleProfileEdit(): void {
    setProfileDraft(profile);
    setEditingProfile((current) => !current);
  }

  function cancelProfileEdit(): void {
    setProfileDraft(profile);
    setEditingProfile(false);
  }

  async function saveProfile(): Promise<void> {
    try {
      const nextProfile = await updateProfile(profileDraft);
      setProfile(nextProfile);
      setProfileDraft(nextProfile);
      setEditingProfile(false);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return {
    profile,
    profileDraft,
    setProfileDraft,
    editingProfile,
    theme,
    refreshProfile,
    handleThemeToggle,
    toggleProfileEdit,
    cancelProfileEdit,
    saveProfile,
  };
}
