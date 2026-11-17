"use client";

import { useEffect, useMemo, useState } from "react";

import { loadAuthSession } from "@/lib/auth";

type SettingsUser = {
  id: string;
  username: string;
  group_name: string;
  role: string;
  status: string;
  last_login_at: string | null;
  created_at: string;
};
type UserSortField = "username" | "group_name" | "role" | "status" | "last_login_at" | "created_at";

type SettingsRole = {
  id: string;
  name: string;
  level: number;
  is_system: boolean;
  permissions: string[];
};

type PermissionPoint = {
  module: string;
  code: string;
  name: string;
  description: string;
};

type SystemSettings = {
  security_policy: Record<string, unknown>;
  storage_upload_policy: Record<string, unknown>;
  trash_download_policy: Record<string, unknown>;
};

const tabs = ["用户管理", "角色配置", "权限点", "安全策略", "存储与上传", "回收站与下载"] as const;
const roles = ["super_admin", "material_admin", "member", "external_collaborator"];

function prettyRole(role: string): string {
  if (role === "super_admin") return "超级管理员";
  if (role === "material_admin") return "素材管理员";
  if (role === "member") return "普通成员";
  if (role === "external_collaborator") return "外部协作者";
  return role;
}

export default function SettingsPage() {
  const apiBaseUrl = useMemo(() => "/api-proxy", []);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("用户管理");
  const [token, setToken] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("等待加载...");

  const [users, setUsers] = useState<SettingsUser[]>([]);
  const [sortField, setSortField] = useState<UserSortField>("created_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [newUsername, setNewUsername] = useState("");
  const [newGroupName, setNewGroupName] = useState("默认分组");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("member");
  const [userGroups, setUserGroups] = useState<string[]>(["默认分组"]);
  const [newUserGroupName, setNewUserGroupName] = useState("");

  const [rolesData, setRolesData] = useState<SettingsRole[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("material_admin");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const [permissionPoints, setPermissionPoints] = useState<PermissionPoint[]>([]);
  const [settingsData, setSettingsData] = useState<SystemSettings | null>(null);

  const btnPrimary =
    "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-40";
  const btnSecondary =
    "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40";
  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  }

  async function loadAll() {
    if (!token) return;
    setBusy(true);
    try {
      const [usersResp, userGroupsResp, rolesResp, permissionsResp, settingsResp] = await Promise.all([
        fetch(`${apiBaseUrl}/settings/users`, { headers: authHeaders() }),
        fetch(`${apiBaseUrl}/settings/user-groups`, { headers: authHeaders() }),
        fetch(`${apiBaseUrl}/settings/roles`, { headers: authHeaders() }),
        fetch(`${apiBaseUrl}/settings/permissions`, { headers: authHeaders() }),
        fetch(`${apiBaseUrl}/settings`, { headers: authHeaders() }),
      ]);

      if (!usersResp.ok || !userGroupsResp.ok || !rolesResp.ok || !permissionsResp.ok || !settingsResp.ok) {
        throw new Error("加载系统设置失败（需要 super_admin 登录）");
      }

      const usersData = (await usersResp.json()) as SettingsUser[];
      const userGroupsData = (await userGroupsResp.json()) as string[];
      const rolesResult = (await rolesResp.json()) as SettingsRole[];
      const permissionsData = (await permissionsResp.json()) as PermissionPoint[];
      const settingsResult = (await settingsResp.json()) as SystemSettings;

      setUsers(usersData);
      setUserGroups(userGroupsData.length ? userGroupsData : ["默认分组"]);
      setNewGroupName((prev) =>
        (userGroupsData.length ? userGroupsData : ["默认分组"]).includes(prev)
          ? prev
          : (userGroupsData[0] || "默认分组"),
      );
      setRolesData(rolesResult);
      setPermissionPoints(permissionsData);
      setSettingsData(settingsResult);

      const currentSelected = rolesResult.find((r) => r.id === selectedRoleId) || rolesResult[0];
      if (currentSelected) {
        setSelectedRoleId(currentSelected.id);
        setSelectedPermissions(currentSelected.permissions);
      }
      setMessage("系统设置加载成功");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function createUser() {
    if (!newUsername || !newGroupName || !newPassword) {
      setMessage("请完整填写新增用户字段");
      return;
    }
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/settings/users`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json", "X-Access-Context": "internal" }),
        body: JSON.stringify({
          username: newUsername,
          group_name: newGroupName,
          password: newPassword,
          role: newRole,
          status: "active",
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setNewUsername("");
      setNewPassword("");
      await loadAll();
      setMessage("新增用户成功");
    } catch (error) {
      setMessage(`新增用户失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function updateUserRole(userId: string, nextRole: string) {
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/settings/users/${userId}/roles`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json", "X-Access-Context": "internal" }),
        body: JSON.stringify({ role: nextRole }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      await loadAll();
      setMessage("修改角色成功");
    } catch (error) {
      setMessage(`修改角色失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function updateUserGroup(userId: string, nextGroup: string) {
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/settings/users/${userId}`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json", "X-Access-Context": "internal" }),
        body: JSON.stringify({ group_name: nextGroup }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      await loadAll();
      setMessage("修改分组成功");
    } catch (error) {
      setMessage(`修改分组失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleUserStatus(userId: string, status: string) {
    setBusy(true);
    try {
      const endpoint = status === "active" ? "disable" : "enable";
      const resp = await fetch(`${apiBaseUrl}/settings/users/${userId}/${endpoint}`, {
        method: "POST",
        headers: authHeaders({ "X-Access-Context": "internal" }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      await loadAll();
      setMessage(status === "active" ? "禁用成功" : "启用成功");
    } catch (error) {
      setMessage(`状态切换失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(userId: string) {
    const pass = window.prompt("请输入新密码（至少6位）");
    if (!pass) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/settings/users/${userId}/reset-password`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json", "X-Access-Context": "internal" }),
        body: JSON.stringify({ new_password: pass }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setMessage("重置密码成功");
    } catch (error) {
      setMessage(`重置密码失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteDisabledUser(user: SettingsUser) {
    if (role !== "super_admin") {
      setMessage("仅超级管理员可删除用户");
      return;
    }
    if (user.status === "active") {
      setMessage("仅可删除已禁用用户");
      return;
    }
    const ok = window.confirm(`确认删除用户 ${user.username}？此操作不可恢复。`);
    if (!ok) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/settings/users/${user.id}`, {
        method: "DELETE",
        headers: authHeaders({ "X-Access-Context": "internal" }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      await loadAll();
      setMessage(`已删除用户：${user.username}`);
    } catch (error) {
      setMessage(`删除用户失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function createUserGroup() {
    const name = newUserGroupName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/settings/user-groups`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json", "X-Access-Context": "internal" }),
        body: JSON.stringify({ group_name: name }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const groups = (await resp.json()) as string[];
      setUserGroups(groups);
      setNewUserGroupName("");
      if (!groups.includes(newGroupName)) setNewGroupName(groups[0] || "默认分组");
      setMessage("创建分组成功");
    } catch (error) {
      setMessage(`创建分组失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeUserGroup(name: string) {
    const ok = window.confirm(`确认删除分组「${name}」？分组下有用户时会删除失败。`);
    if (!ok) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/settings/user-groups/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: authHeaders({ "X-Access-Context": "internal" }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const groups = (await resp.json()) as string[];
      setUserGroups(groups);
      if (!groups.includes(newGroupName)) setNewGroupName(groups[0] || "默认分组");
      setMessage("删除分组成功");
    } catch (error) {
      setMessage(`删除分组失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function toggleSort(nextField: UserSortField) {
    if (sortField === nextField) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(nextField);
    setSortDirection(nextField === "created_at" || nextField === "last_login_at" ? "desc" : "asc");
  }

  const sortedUsers = useMemo(() => {
    const list = [...users];
    const sign = sortDirection === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (sortField === "created_at" || sortField === "last_login_at") {
        const at = av ? Date.parse(String(av)) : -Infinity;
        const bt = bv ? Date.parse(String(bv)) : -Infinity;
        return (at - bt) * sign;
      }
      return String(av || "").localeCompare(String(bv || ""), "zh-CN") * sign;
    });
    return list;
  }, [users, sortDirection, sortField]);
  const permissionGroups = useMemo(() => {
    const grouped = new Map<string, PermissionPoint[]>();
    permissionPoints.forEach((p) => {
      const list = grouped.get(p.module) || [];
      list.push(p);
      grouped.set(p.module, list);
    });
    return Array.from(grouped.entries()).map(([module, points]) => ({
      module,
      points: [...points].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    }));
  }, [permissionPoints]);

  function sortMark(field: UserSortField) {
    if (sortField !== field) return "↕";
    return sortDirection === "asc" ? "↑" : "↓";
  }

  function togglePermission(code: string, checked: boolean) {
    if (checked) {
      setSelectedPermissions((prev) => [...new Set([...prev, code])]);
    } else {
      setSelectedPermissions((prev) => prev.filter((x) => x !== code));
    }
  }

  function setModulePermissions(moduleCodes: string[], checked: boolean) {
    if (checked) {
      setSelectedPermissions((prev) => [...new Set([...prev, ...moduleCodes])]);
    } else {
      const moduleSet = new Set(moduleCodes);
      setSelectedPermissions((prev) => prev.filter((x) => !moduleSet.has(x)));
    }
  }

  async function saveRolePermissions() {
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/settings/roles/${selectedRoleId}/permissions`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json", "X-Access-Context": "internal" }),
        body: JSON.stringify({ permissions: selectedPermissions }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      await loadAll();
      setMessage("角色权限保存成功");
    } catch (error) {
      setMessage(`角色权限保存失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    if (!settingsData) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/settings`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json", "X-Access-Context": "internal" }),
        body: JSON.stringify(settingsData),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const updated = (await resp.json()) as SystemSettings;
      setSettingsData(updated);
      setMessage("系统策略保存成功");
    } catch (error) {
      setMessage(`系统策略保存失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const session = loadAuthSession();
    if (session) {
      setToken(session.access_token);
      setRole(session.role);
    }
  }, []);

  useEffect(() => {
    if (token) void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const selected = rolesData.find((item) => item.id === selectedRoleId);
    if (selected) setSelectedPermissions(selected.permissions);
  }, [selectedRoleId, rolesData]);

  if (token && role !== "super_admin") {
    return <main className="mx-auto max-w-5xl p-6">无访问权限</main>;
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-white/10 bg-slate-900/55 p-6 text-slate-100 backdrop-blur-xl">
        <h1 className="text-2xl font-semibold">系统设置</h1>
        <p className="mt-2 text-sm text-slate-300">用于配置用户、角色、权限、安全策略、上传限制、下载与回收站规则。</p>
        <p className="mt-2 text-xs text-slate-400">当前登录角色：{prettyRole(role || "未知")}（仅超级管理员可修改）</p>
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? btnPrimary : btnSecondary}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {activeTab === "用户管理" ? (
          <div className="grid gap-4">
            <h2 className="text-lg font-semibold text-slate-900">用户管理</h2>
            <div className="grid gap-2 md:grid-cols-4">
              <input className={inputClass} placeholder="用户名" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
              <select className={inputClass} value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}>
                {userGroups.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              <input className={inputClass} placeholder="初始密码" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <select className={inputClass} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r} value={r}>{prettyRole(r)}</option>
                ))}
              </select>
            </div>
            <div>
              <button type="button" className={btnPrimary} disabled={busy} onClick={createUser}>新增用户</button>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-sm font-semibold text-slate-700">分组管理</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <input className={inputClass + " max-w-[280px]"} placeholder="新分组名" value={newUserGroupName} onChange={(e) => setNewUserGroupName(e.target.value)} />
                <button type="button" className={btnPrimary} disabled={busy} onClick={createUserGroup}>创建分组</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {userGroups.map((g) => (
                  <span key={g} className="inline-flex items-center gap-2 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700">
                    {g}
                    {g !== "默认分组" ? (
                      <button type="button" className="text-red-600" onClick={() => void removeUserGroup(g)}>删除</button>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2"><button type="button" onClick={() => toggleSort("username")}>用户名 {sortMark("username")}</button></th>
                    <th className="px-3 py-2"><button type="button" onClick={() => toggleSort("group_name")}>分组名 {sortMark("group_name")}</button></th>
                    <th className="px-3 py-2"><button type="button" onClick={() => toggleSort("role")}>角色 {sortMark("role")}</button></th>
                    <th className="px-3 py-2"><button type="button" onClick={() => toggleSort("status")}>账号状态 {sortMark("status")}</button></th>
                    <th className="px-3 py-2"><button type="button" onClick={() => toggleSort("last_login_at")}>最近登录 {sortMark("last_login_at")}</button></th>
                    <th className="px-3 py-2"><button type="button" onClick={() => toggleSort("created_at")}>创建时间 {sortMark("created_at")}</button></th>
                    <th className="px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map((u) => (
                    <tr key={u.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{u.username}</td>
                      <td className="px-3 py-2">
                        <select className={inputClass} value={u.group_name} onChange={(e) => void updateUserGroup(u.id, e.target.value)}>
                          {userGroups.map((g) => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select className={inputClass} value={u.role} onChange={(e) => void updateUserRole(u.id, e.target.value)}>
                          {roles.map((r) => (
                            <option key={r} value={r}>{prettyRole(r)}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">{u.status}</td>
                      <td className="px-3 py-2">{u.last_login_at || "—"}</td>
                      <td className="px-3 py-2">{u.created_at}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className={btnSecondary} onClick={() => void resetPassword(u.id)}>重置密码</button>
                          <button type="button" className={btnSecondary} onClick={() => void toggleUserStatus(u.id, u.status)}>
                            {u.status === "active" ? "禁用" : "启用"}
                          </button>
                          {role === "super_admin" && u.status !== "active" ? (
                            <button type="button" className={btnSecondary} onClick={() => void deleteDisabledUser(u)}>
                              删除
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === "角色配置" ? (
          <div className="grid gap-4 lg:grid-cols-[240px,1fr]">
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-sm font-semibold text-slate-700">角色列表</div>
              <ul className="mt-3 space-y-2">
                {rolesData.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={selectedRoleId === r.id ? `${btnPrimary} w-full` : `${btnSecondary} w-full`}
                      onClick={() => setSelectedRoleId(r.id)}
                    >
                      {r.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="mb-3 text-sm font-semibold text-slate-700">当前角色：{prettyRole(selectedRoleId)}</div>
              <div className="mb-3 text-xs text-slate-500">已选 {selectedPermissions.length} / 共 {permissionPoints.length}</div>
              <div className="grid gap-3">
                {permissionGroups.map((group) => {
                  const moduleCodes = group.points.map((p) => p.code);
                  const selectedCount = moduleCodes.filter((code) => selectedPermissions.includes(code)).length;
                  const allChecked = moduleCodes.length > 0 && selectedCount === moduleCodes.length;
                  const disabled = selectedRoleId === "super_admin";
                  return (
                    <div key={group.module} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-800">
                          {group.module}
                          <span className="ml-2 text-xs font-normal text-slate-500">
                            ({selectedCount}/{moduleCodes.length})
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={btnSecondary + " !px-2 !py-1 !text-xs"}
                            disabled={disabled || allChecked}
                            onClick={() => setModulePermissions(moduleCodes, true)}
                          >
                            本组全选
                          </button>
                          <button
                            type="button"
                            className={btnSecondary + " !px-2 !py-1 !text-xs"}
                            disabled={disabled || selectedCount === 0}
                            onClick={() => setModulePermissions(moduleCodes, false)}
                          >
                            本组清空
                          </button>
                        </div>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {group.points.map((p) => {
                          const checked = selectedPermissions.includes(p.code);
                          return (
                            <label key={p.code} className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={disabled}
                                onChange={(e) => togglePermission(p.code, e.target.checked)}
                              />
                              <span>
                                <span className="font-medium text-slate-800">{p.name}</span>
                                <span className="block text-xs text-slate-500">{p.code}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" className={btnPrimary} disabled={busy || selectedRoleId === "super_admin"} onClick={saveRolePermissions}>保存权限</button>
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => {
                  const roleData = rolesData.find((x) => x.id === selectedRoleId);
                  setSelectedPermissions(roleData?.permissions || []);
                }}>取消修改</button>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "权限点" ? (
          <div className="grid gap-4">
            <h2 className="text-lg font-semibold text-slate-900">权限点（只读）</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">模块</th>
                    <th className="px-3 py-2">权限编码</th>
                    <th className="px-3 py-2">权限名称</th>
                    <th className="px-3 py-2">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {permissionPoints.map((p) => (
                    <tr key={p.code} className="border-t border-slate-100">
                      <td className="px-3 py-2">{p.module}</td>
                      <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                      <td className="px-3 py-2">{p.name}</td>
                      <td className="px-3 py-2 text-slate-600">{p.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === "安全策略" || activeTab === "存储与上传" || activeTab === "回收站与下载" ? (
          <div className="grid gap-4">
            <h2 className="text-lg font-semibold text-slate-900">{activeTab}</h2>
            <p className="text-sm text-slate-600">可编辑 JSON 配置（V1 先完成可用闭环，后续可拆成更细粒度表单）。</p>
            <textarea
              className={inputClass + " min-h-[360px] font-mono text-xs"}
              value={
                activeTab === "安全策略"
                  ? JSON.stringify(settingsData?.security_policy || {}, null, 2)
                  : activeTab === "存储与上传"
                    ? JSON.stringify(settingsData?.storage_upload_policy || {}, null, 2)
                    : JSON.stringify(settingsData?.trash_download_policy || {}, null, 2)
              }
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  if (!settingsData) return;
                  if (activeTab === "安全策略") {
                    setSettingsData({ ...settingsData, security_policy: parsed });
                  } else if (activeTab === "存储与上传") {
                    setSettingsData({ ...settingsData, storage_upload_policy: parsed });
                  } else {
                    setSettingsData({ ...settingsData, trash_download_policy: parsed });
                  }
                } catch {
                  // 输入中间态允许临时非法 JSON
                }
              }}
            />
            <div className="flex gap-2">
              <button type="button" className={btnPrimary} disabled={busy} onClick={saveSettings}>保存</button>
              <button type="button" className={btnSecondary} disabled={busy} onClick={() => void loadAll()}>重置</button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm text-slate-700">{message}</div>
      </section>
    </main>
  );
}
