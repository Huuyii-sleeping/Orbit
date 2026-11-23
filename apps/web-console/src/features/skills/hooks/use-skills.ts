import { getErrorMessage } from "../../../lib/errors/error-factory";
import { useMemo, useRef, useState } from "react";
import {
  downloadSkill,
  fetchSkillAuditEvents,
  fetchSkills,
  installSkill,
  syncSkillRegistry,
  uninstallSkill,
  updateSkill,
  uploadSkillPackage,
  type SkillAuditEvent,
  type SkillPackageInput,
  type SkillRegistryItem,
} from "../../../api/index";

/** 管理真实 Skill Hub 数据和互斥的技能生命周期操作。 */
export function useSkills(setError: (error: string | null) => void) {
  const [skillRegistry, setSkillRegistry] = useState<SkillRegistryItem[]>([]);
  const [skillAuditEvents, setSkillAuditEvents] = useState<SkillAuditEvent[]>(
    [],
  );
  const [skillRegistryRefreshing, setSkillRegistryRefreshing] = useState(false);
  const [skillUploadOpen, setSkillUploadOpen] = useState(false);
  const refreshing = useRef(false);
  const operationInFlight = useRef(false);
  const installedSkills = useMemo(
    () => skillRegistry.filter((skill) => skill.installed),
    [skillRegistry],
  );

  async function refreshSkills() {
    if (refreshing.current) return;
    refreshing.current = true;
    setSkillRegistryRefreshing(true);
    try {
      await syncSkillRegistry();
      const [skills, auditEvents] = await Promise.all([
        fetchSkills(),
        fetchSkillAuditEvents(),
      ]);
      setSkillRegistry(skills);
      setSkillAuditEvents(auditEvents);
    } finally {
      refreshing.current = false;
      setSkillRegistryRefreshing(false);
    }
  }

  async function refreshSkillAuditEvents(): Promise<void> {
    setSkillAuditEvents(await fetchSkillAuditEvents());
  }

  async function handleRefreshSkillRegistry(): Promise<void> {
    try {
      await refreshSkills();
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleSkillAction(skill: SkillRegistryItem): Promise<void> {
    if (operationInFlight.current) return;
    operationInFlight.current = true;

    try {
      const nextSkill =
        skill.status === "available"
          ? await downloadSkill(skill.id)
          : skill.status === "updateAvailable"
            ? await updateSkill(skill.id)
            : skill.installed
              ? await uninstallSkill(skill.id)
              : await installSkill(skill.id);
      setSkillRegistry((current) =>
        current.map((item) => (item.id === skill.id ? nextSkill : item)),
      );
      await refreshSkillAuditEvents();
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      operationInFlight.current = false;
    }
  }

  async function handleUploadSkillPackage(
    input: SkillPackageInput,
  ): Promise<void> {
    try {
      const nextSkill = await uploadSkillPackage(input);
      setSkillRegistry((current) => {
        const exists = current.some((skill) => skill.id === nextSkill.id);
        return exists
          ? current.map((skill) =>
              skill.id === nextSkill.id ? nextSkill : skill,
            )
          : [...current, nextSkill];
      });
      await refreshSkillAuditEvents();
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return {
    skillRegistry,
    skillAuditEvents,
    installedSkills,
    skillRegistryRefreshing,
    skillUploadOpen,
    setSkillUploadOpen,
    refreshSkills,
    handleRefreshSkillRegistry,
    handleSkillAction,
    handleUploadSkillPackage,
  };
}
