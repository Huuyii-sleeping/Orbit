import { describe, expect, it, vi, afterEach } from "vitest";
import { compileWorkflow } from "@orbit/workflow-core";
import { createOrganizationApprovalWorkflow, organizationApprovalText } from "./approval-workflow";
import { ORGANIZATION_WORKFLOW_APPROVAL_POLICY } from "@orbit/runtime-contracts";
import { cancelWorkflowRun, createSopDraftRemote, createWorkflowRunEventStream } from "../../api/workflows";

afterEach(() => vi.unstubAllGlobals());
describe("组织审批页面的真实协议", () => {
  it("审批模板能编译，正文中的模板标记保持字面值，拒绝也能结束", () => {
    const draft = createOrganizationApprovalWorkflow("采购审批", "保留 {{original}} 正文");
    const compiled = compileWorkflow(draft, { approvalPolicies: { hasPolicy: (id) => id === ORGANIZATION_WORKFLOW_APPROVAL_POLICY } });
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.ok).toBe(true);
    expect(organizationApprovalText(JSON.parse(JSON.stringify(draft)))).toBe("保留 {{original}} 正文");
    expect(draft.nodes.find((node) => node.kind === "builtin" && node.type === "variable")).toMatchObject({ config: { assignments: [{ key: "text", value: { kind: "literal", value: "保留 {{original}} 正文" } }] } });
    expect(draft.edges.some((edge) => edge.source.portId === "rejected")).toBe(true);
  });

  it("其他编辑器改变结构后保持只读，不会用简化表单覆盖原流程", () => {
    const draft = createOrganizationApprovalWorkflow("审批", "正文");
    draft.edges.pop();
    expect(organizationApprovalText(draft)).toBeUndefined();
    const empty = createOrganizationApprovalWorkflow("审批", "正文");
    const content = empty.nodes.find((node) => node.kind === "builtin" && node.type === "variable");
    if (content?.kind === "builtin" && content.type === "variable") content.config.assignments = [];
    expect(organizationApprovalText(empty)).toBeUndefined();
  });

  it("取消携带 JSON，并附带页面打开时的组织预期，防止切换 Cookie 后错写组织", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: "run", workflowId: "workflow", mode: "production", status: "cancelled" } })));
    vi.stubGlobal("fetch", fetch);
    const scope = { issuer: "https://issuer.test", user: { subject: "alice" }, tenantId: "alpha" };
    await cancelWorkflowRun("run", scope);
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST"); expect(init.body).toBe("{}");
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(decodeURIComponent(headers.get("x-orbit-organization-context")!))).toEqual([scope.issuer, "alice", "alpha"]);
  });

  it("草稿创建复用服务端协议；SSE 也绑定同一组织预期", async () => {
    const draft = createOrganizationApprovalWorkflow("测试", "正文");
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: draft })));
    vi.stubGlobal("fetch", fetch);
    const scope = { issuer: "issuer", user: { subject: "alice" }, tenantId: "alpha" };
    await expect(createSopDraftRemote(draft, scope)).resolves.toMatchObject({ id: draft.id });
    let url = "";
    class Source {
      onopen = null; onerror = null;
      constructor(value: string) { url = value; }
      addEventListener() {} close() {}
    }
    createWorkflowRunEventStream({ runId: "run", scope, onEvent: () => {}, eventSourceCtor: Source });
    const expected = new URL(url, "https://app.test").searchParams.get("organizationContext")!;
    expect(JSON.parse(decodeURIComponent(expected))).toEqual(["issuer", "alice", "alpha"]);
  });
});
