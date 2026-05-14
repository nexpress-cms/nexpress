import { UserManagement } from "@nexpress/admin/client";

export const dynamic = "force-dynamic";

/**
 * Admin "Users" listing — staff/operator accounts (rows in
 * `np_users`, distinct from members in `np_members`). The
 * sidebar nav points here (`/admin/users`); without this page
 * the link falls through to the site 404. The list/edit UI
 * itself lives in `@nexpress/admin`'s `<UserManagement />`
 * client component — same surface already embedded in
 * `/admin/settings`'s Users tab; this just gives the sidebar
 * link a dedicated route so operators don't have to walk
 * through Settings.
 */
export default function AdminUsersPage() {
  return <UserManagement />;
}
