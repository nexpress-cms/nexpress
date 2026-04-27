export { AdminShell } from "./layout/admin-shell.js";
export { AdminTopbar } from "./layout/admin-topbar.js";

export { CollectionListView } from "./collections/collection-list-view.js";
export { CollectionEditView } from "./collections/collection-edit-view.js";
export { CollectionTabs } from "./collections/collection-tabs.js";
export type {
  CollectionTabDescriptor,
  CollectionTabWidget,
  CollectionTabAction,
} from "./collections/collection-tabs.js";
export { FieldRenderer } from "./collections/field-renderer.js";
export { RevisionsPanel } from "./collections/revisions-panel.js";
export { ScheduleDialog } from "./collections/schedule-dialog.js";

export { DashboardView } from "./dashboard/dashboard-view.js";
export { DashboardPluginWidgets } from "./dashboard/plugin-widgets.js";
export type { DashboardPluginWidget } from "./dashboard/plugin-widgets.js";

export { MembersListView } from "./members/members-list-view.js";
export type { MemberListRow } from "./members/members-list-view.js";

export { ReportsQueueView } from "./community/reports-queue-view.js";
export type { ReportRow } from "./community/reports-queue-view.js";
export { AuditLogView } from "./community/audit-log-view.js";
export type { AuditEventRow } from "./community/audit-log-view.js";
export { PendingQueueView } from "./community/pending-queue-view.js";
export type { PendingDocRow } from "./community/pending-queue-view.js";
export { MemberPurgePanel } from "./community/member-purge-panel.js";
export type { MemberPurgeResult } from "./community/member-purge-panel.js";
export { MemberBansPanel } from "./community/member-bans-panel.js";
export type { BanRow } from "./community/member-bans-panel.js";
export { MemberRolesPanel } from "./community/member-roles-panel.js";
export type { MemberRoleGrantRow } from "./community/member-roles-panel.js";
export { CommunitySettingsView } from "./community/community-settings-view.js";
export type { CommunitySettings } from "./community/community-settings-view.js";

export { LinkedIdentitiesPanel } from "./auth/linked-identities-panel.js";
export type { LinkedIdentity } from "./auth/linked-identities-panel.js";

export { JobsView } from "./jobs/jobs-view.js";

export { MediaLibrary } from "./media/media-library.js";
export { MediaUploadZone } from "./media/media-upload-zone.js";

export { SettingsView } from "./settings/settings-view.js";
export { LocalesTab } from "./settings/locales-tab.js";
export { ThemeEditor } from "./settings/theme-editor.js";
export { ThemeSwitcher } from "./settings/theme-switcher.js";
export { TranslationTabs } from "./collections/translation-tabs.js";
export { NavigationEditor } from "./settings/navigation-editor.js";
export { UserManagement } from "./settings/user-management.js";
export { PluginsManager } from "./settings/plugins-manager.js";
export { PluginAdminPage } from "./settings/plugin-admin-page.js";

export { Button } from "./ui/button.js";
export { Input } from "./ui/input.js";
export { Textarea } from "./ui/textarea.js";
export { Label } from "./ui/label.js";
export { Switch } from "./ui/switch.js";
export { Badge } from "./ui/badge.js";
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card.js";
export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog.js";
export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu.js";
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.js";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs.js";
export { Separator } from "./ui/separator.js";
export { ScrollArea } from "./ui/scroll-area.js";
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip.js";
export { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.js";
export { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.js";
export { DataTable } from "./ui/data-table.js";
export { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "./ui/form.js";
export { cn } from "./ui/utils.js";

export { nxFetch } from "./lib/api-client.js";
