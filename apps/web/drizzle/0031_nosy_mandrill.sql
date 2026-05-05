ALTER TYPE "public"."nx_ban_kind" RENAME TO "np_ban_kind";--> statement-breakpoint
ALTER TYPE "public"."nx_ban_scope" RENAME TO "np_ban_scope";--> statement-breakpoint
ALTER TYPE "public"."nx_comment_status" RENAME TO "np_comment_status";--> statement-breakpoint
ALTER TYPE "public"."nx_media_status" RENAME TO "np_media_status";--> statement-breakpoint
ALTER TYPE "public"."nx_member_role_scope" RENAME TO "np_member_role_scope";--> statement-breakpoint
ALTER TYPE "public"."nx_member_status" RENAME TO "np_member_status";--> statement-breakpoint
ALTER TYPE "public"."nx_password_reset_purpose" RENAME TO "np_password_reset_purpose";--> statement-breakpoint
ALTER TYPE "public"."nx_revision_status" RENAME TO "np_revision_status";--> statement-breakpoint
ALTER TYPE "public"."nx_user_role" RENAME TO "np_user_role";--> statement-breakpoint
ALTER TABLE "nx_audit_events" RENAME TO "np_audit_events";--> statement-breakpoint
ALTER TABLE "nx_bans" RENAME TO "np_bans";--> statement-breakpoint
ALTER TABLE "nx_comments" RENAME TO "np_comments";--> statement-breakpoint
ALTER TABLE "nx_follows" RENAME TO "np_follows";--> statement-breakpoint
ALTER TABLE "nx_job_logs" RENAME TO "np_job_logs";--> statement-breakpoint
ALTER TABLE "nx_media" RENAME TO "np_media";--> statement-breakpoint
ALTER TABLE "nx_media_folders" RENAME TO "np_media_folders";--> statement-breakpoint
ALTER TABLE "nx_media_refs" RENAME TO "np_media_refs";--> statement-breakpoint
ALTER TABLE "nx_member_identities" RENAME TO "np_member_identities";--> statement-breakpoint
ALTER TABLE "nx_member_mutes" RENAME TO "np_member_mutes";--> statement-breakpoint
ALTER TABLE "nx_member_roles" RENAME TO "np_member_roles";--> statement-breakpoint
ALTER TABLE "nx_member_sessions" RENAME TO "np_member_sessions";--> statement-breakpoint
ALTER TABLE "nx_members" RENAME TO "np_members";--> statement-breakpoint
ALTER TABLE "nx_navigation" RENAME TO "np_navigation";--> statement-breakpoint
ALTER TABLE "nx_notifications" RENAME TO "np_notifications";--> statement-breakpoint
ALTER TABLE "nx_plugin_storage" RENAME TO "np_plugin_storage";--> statement-breakpoint
ALTER TABLE "nx_plugins" RENAME TO "np_plugins";--> statement-breakpoint
ALTER TABLE "nx_reactions" RENAME TO "np_reactions";--> statement-breakpoint
ALTER TABLE "nx_reports" RENAME TO "np_reports";--> statement-breakpoint
ALTER TABLE "nx_revisions" RENAME TO "np_revisions";--> statement-breakpoint
ALTER TABLE "nx_sessions" RENAME TO "np_sessions";--> statement-breakpoint
ALTER TABLE "nx_settings" RENAME TO "np_settings";--> statement-breakpoint
ALTER TABLE "nx_site_memberships" RENAME TO "np_site_memberships";--> statement-breakpoint
ALTER TABLE "nx_sites" RENAME TO "np_sites";--> statement-breakpoint
ALTER TABLE "nx_slug_history" RENAME TO "np_slug_history";--> statement-breakpoint
ALTER TABLE "nx_string_overrides" RENAME TO "np_string_overrides";--> statement-breakpoint
ALTER TABLE "nx_user_oauth_identities" RENAME TO "np_user_oauth_identities";--> statement-breakpoint
ALTER TABLE "nx_users" RENAME TO "np_users";--> statement-breakpoint
ALTER TABLE "nx_worker_heartbeats" RENAME TO "np_worker_heartbeats";--> statement-breakpoint
ALTER TABLE "nx_c_discussions" RENAME TO "np_c_discussions";--> statement-breakpoint
ALTER TABLE "nx_c_localized-pages" RENAME TO "np_c_localized-pages";--> statement-breakpoint
ALTER TABLE "nx_c_pages" RENAME TO "np_c_pages";--> statement-breakpoint
ALTER TABLE "nx_c_posts__categories" RENAME TO "np_c_posts__categories";--> statement-breakpoint
ALTER TABLE "nx_c_posts" RENAME TO "np_c_posts";--> statement-breakpoint
ALTER TABLE "nx_c_posts__tags" RENAME TO "np_c_posts__tags";--> statement-breakpoint
ALTER TABLE "nx_c_taxonomies" RENAME TO "np_c_taxonomies";--> statement-breakpoint
ALTER TABLE "np_follows" DROP CONSTRAINT "nx_follows_unique";--> statement-breakpoint
ALTER TABLE "np_member_identities" DROP CONSTRAINT "nx_member_identities_provider_subject_uq";--> statement-breakpoint
ALTER TABLE "np_member_identities" DROP CONSTRAINT "nx_member_identities_member_provider_uq";--> statement-breakpoint
ALTER TABLE "np_member_roles" DROP CONSTRAINT "nx_member_roles_grant_uq";--> statement-breakpoint
ALTER TABLE "np_members" DROP CONSTRAINT "nx_members_handle_unique";--> statement-breakpoint
ALTER TABLE "np_members" DROP CONSTRAINT "nx_members_email_unique";--> statement-breakpoint
ALTER TABLE "np_navigation" DROP CONSTRAINT "nx_navigation_site_location_idx";--> statement-breakpoint
ALTER TABLE "np_reactions" DROP CONSTRAINT "nx_reactions_unique";--> statement-breakpoint
ALTER TABLE "np_revisions" DROP CONSTRAINT "nx_revisions_document_id_version_unique";--> statement-breakpoint
ALTER TABLE "np_sites" DROP CONSTRAINT "nx_sites_hostname_idx";--> statement-breakpoint
ALTER TABLE "np_user_oauth_identities" DROP CONSTRAINT "nx_user_oauth_identities_provider_subject_unique";--> statement-breakpoint
ALTER TABLE "np_user_oauth_identities" DROP CONSTRAINT "nx_user_oauth_identities_user_provider_unique";--> statement-breakpoint
ALTER TABLE "np_users" DROP CONSTRAINT "nx_users_email_unique";--> statement-breakpoint
ALTER TABLE "np_audit_events" DROP CONSTRAINT "nx_audit_events_actor_user_id_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_audit_events" DROP CONSTRAINT "nx_audit_events_actor_member_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_bans" DROP CONSTRAINT "nx_bans_member_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_bans" DROP CONSTRAINT "nx_bans_by_user_id_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_bans" DROP CONSTRAINT "nx_bans_by_member_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_comments" DROP CONSTRAINT "nx_comments_parent_id_nx_comments_id_fk";
--> statement-breakpoint
ALTER TABLE "np_comments" DROP CONSTRAINT "nx_comments_member_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_comments" DROP CONSTRAINT "nx_comments_hidden_by_user_id_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_comments" DROP CONSTRAINT "nx_comments_hidden_by_member_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_follows" DROP CONSTRAINT "nx_follows_follower_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_media" DROP CONSTRAINT "nx_media_folder_id_nx_media_folders_id_fk";
--> statement-breakpoint
ALTER TABLE "np_media" DROP CONSTRAINT "nx_media_uploaded_by_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_media" DROP CONSTRAINT "nx_media_uploaded_by_member_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_media_folders" DROP CONSTRAINT "nx_media_folders_parent_id_nx_media_folders_id_fk";
--> statement-breakpoint
ALTER TABLE "np_media_refs" DROP CONSTRAINT "nx_media_refs_media_id_nx_media_id_fk";
--> statement-breakpoint
ALTER TABLE "np_member_identities" DROP CONSTRAINT "nx_member_identities_member_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_member_mutes" DROP CONSTRAINT "nx_member_mutes_member_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_member_mutes" DROP CONSTRAINT "nx_member_mutes_target_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_member_roles" DROP CONSTRAINT "nx_member_roles_member_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_member_roles" DROP CONSTRAINT "nx_member_roles_granted_by_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_member_sessions" DROP CONSTRAINT "nx_member_sessions_member_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_members" DROP CONSTRAINT "nx_members_avatar_nx_media_id_fk";
--> statement-breakpoint
ALTER TABLE "np_navigation" DROP CONSTRAINT "nx_navigation_updated_by_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_notifications" DROP CONSTRAINT "nx_notifications_member_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_reactions" DROP CONSTRAINT "nx_reactions_member_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_reports" DROP CONSTRAINT "nx_reports_reporter_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_reports" DROP CONSTRAINT "nx_reports_resolved_by_user_id_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_reports" DROP CONSTRAINT "nx_reports_resolved_by_member_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_revisions" DROP CONSTRAINT "nx_revisions_author_id_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_sessions" DROP CONSTRAINT "nx_sessions_user_id_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_settings" DROP CONSTRAINT "nx_settings_updated_by_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_site_memberships" DROP CONSTRAINT "nx_site_memberships_user_id_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_string_overrides" DROP CONSTRAINT "nx_string_overrides_updated_by_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_user_oauth_identities" DROP CONSTRAINT "nx_user_oauth_identities_user_id_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_users" DROP CONSTRAINT "nx_users_avatar_nx_media_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_discussions" DROP CONSTRAINT "nx_c_discussions_created_by_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_discussions" DROP CONSTRAINT "nx_c_discussions_updated_by_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_discussions" DROP CONSTRAINT "nx_c_discussions_member_author_id_nx_members_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_localized-pages" DROP CONSTRAINT "nx_c_localized-pages_created_by_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_localized-pages" DROP CONSTRAINT "nx_c_localized-pages_updated_by_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_pages" DROP CONSTRAINT "nx_c_pages_created_by_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_pages" DROP CONSTRAINT "nx_c_pages_updated_by_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_posts__categories" DROP CONSTRAINT "nx_c_posts__categories_posts_id_nx_c_posts_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_posts__categories" DROP CONSTRAINT "nx_c_posts__categories_target_id_nx_c_taxonomies_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_posts" DROP CONSTRAINT "nx_c_posts_created_by_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_posts" DROP CONSTRAINT "nx_c_posts_updated_by_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_posts" DROP CONSTRAINT "nx_c_posts_cover_image_nx_media_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_posts" DROP CONSTRAINT "nx_c_posts_author_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_posts__tags" DROP CONSTRAINT "nx_c_posts__tags_posts_id_nx_c_posts_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_posts__tags" DROP CONSTRAINT "nx_c_posts__tags_target_id_nx_c_taxonomies_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_taxonomies" DROP CONSTRAINT "nx_c_taxonomies_created_by_nx_users_id_fk";
--> statement-breakpoint
ALTER TABLE "np_c_taxonomies" DROP CONSTRAINT "nx_c_taxonomies_updated_by_nx_users_id_fk";
--> statement-breakpoint
DROP INDEX "nx_audit_target_idx";--> statement-breakpoint
DROP INDEX "nx_audit_actor_user_idx";--> statement-breakpoint
DROP INDEX "nx_audit_actor_member_idx";--> statement-breakpoint
DROP INDEX "nx_audit_site_idx";--> statement-breakpoint
DROP INDEX "nx_bans_member_scope_idx";--> statement-breakpoint
DROP INDEX "nx_bans_active_idx";--> statement-breakpoint
DROP INDEX "nx_bans_site_idx";--> statement-breakpoint
DROP INDEX "nx_comments_target_idx";--> statement-breakpoint
DROP INDEX "nx_comments_member_idx";--> statement-breakpoint
DROP INDEX "nx_comments_site_idx";--> statement-breakpoint
DROP INDEX "nx_follows_target_idx";--> statement-breakpoint
DROP INDEX "nx_follows_site_idx";--> statement-breakpoint
DROP INDEX "nx_job_logs_job_idx";--> statement-breakpoint
DROP INDEX "nx_job_logs_created_idx";--> statement-breakpoint
DROP INDEX "nx_media_hash_idx";--> statement-breakpoint
DROP INDEX "nx_media_status_idx";--> statement-breakpoint
DROP INDEX "nx_media_uploaded_by_member_idx";--> statement-breakpoint
DROP INDEX "nx_media_refs_media_id_idx";--> statement-breakpoint
DROP INDEX "nx_media_refs_document_id_idx";--> statement-breakpoint
DROP INDEX "nx_member_identities_member_idx";--> statement-breakpoint
DROP INDEX "nx_member_mutes_target_idx";--> statement-breakpoint
DROP INDEX "nx_member_roles_member_idx";--> statement-breakpoint
DROP INDEX "nx_member_roles_scope_idx";--> statement-breakpoint
DROP INDEX "nx_member_roles_site_idx";--> statement-breakpoint
DROP INDEX "nx_members_status_idx";--> statement-breakpoint
DROP INDEX "nx_notifications_inbox_idx";--> statement-breakpoint
DROP INDEX "nx_notifications_site_inbox_idx";--> statement-breakpoint
DROP INDEX "nx_plugin_storage_plugin_id_idx";--> statement-breakpoint
DROP INDEX "nx_plugin_storage_site_idx";--> statement-breakpoint
DROP INDEX "nx_reactions_target_idx";--> statement-breakpoint
DROP INDEX "nx_reactions_site_idx";--> statement-breakpoint
DROP INDEX "nx_reports_queue_idx";--> statement-breakpoint
DROP INDEX "nx_reports_target_idx";--> statement-breakpoint
DROP INDEX "nx_reports_site_queue_idx";--> statement-breakpoint
DROP INDEX "nx_revisions_collection_idx";--> statement-breakpoint
DROP INDEX "nx_revisions_document_id_idx";--> statement-breakpoint
DROP INDEX "nx_slug_history_lookup_idx";--> statement-breakpoint
DROP INDEX "nx_slug_history_doc_idx";--> statement-breakpoint
DROP INDEX "nx_user_oauth_identities_user_idx";--> statement-breakpoint
DROP INDEX "nx_c_discussions_status_idx";--> statement-breakpoint
DROP INDEX "nx_c_discussions_member_author_idx";--> statement-breakpoint
DROP INDEX "nx_c_discussions_site_slug_idx";--> statement-breakpoint
DROP INDEX "nx_c_discussions_site_idx";--> statement-breakpoint
DROP INDEX "nx_c_localized-pages_status_idx";--> statement-breakpoint
DROP INDEX "nx_c_localized-pages_site_locale_slug_idx";--> statement-breakpoint
DROP INDEX "nx_c_localized-pages_translation_group_idx";--> statement-breakpoint
DROP INDEX "nx_c_localized-pages_locale_idx";--> statement-breakpoint
DROP INDEX "nx_c_localized-pages_site_idx";--> statement-breakpoint
DROP INDEX "nx_c_pages_status_idx";--> statement-breakpoint
DROP INDEX "nx_c_pages_site_slug_idx";--> statement-breakpoint
DROP INDEX "nx_c_pages_site_idx";--> statement-breakpoint
DROP INDEX "nx_c_posts__categories_posts_id_idx";--> statement-breakpoint
DROP INDEX "nx_c_posts__categories_parent_target_uidx";--> statement-breakpoint
DROP INDEX "nx_c_posts_status_idx";--> statement-breakpoint
DROP INDEX "nx_c_posts_site_slug_idx";--> statement-breakpoint
DROP INDEX "nx_c_posts_site_idx";--> statement-breakpoint
DROP INDEX "nx_c_posts__tags_posts_id_idx";--> statement-breakpoint
DROP INDEX "nx_c_posts__tags_parent_target_uidx";--> statement-breakpoint
DROP INDEX "nx_c_taxonomies_status_idx";--> statement-breakpoint
DROP INDEX "nx_c_taxonomies_site_slug_idx";--> statement-breakpoint
DROP INDEX "nx_c_taxonomies_site_idx";--> statement-breakpoint
ALTER TABLE "np_member_mutes" DROP CONSTRAINT "nx_member_mutes_member_id_target_id_site_id_pk";--> statement-breakpoint
ALTER TABLE "np_plugin_storage" DROP CONSTRAINT "nx_plugin_storage_plugin_id_site_id_key_pk";--> statement-breakpoint
ALTER TABLE "np_settings" DROP CONSTRAINT "nx_settings_site_id_key_pk";--> statement-breakpoint
ALTER TABLE "np_site_memberships" DROP CONSTRAINT "nx_site_memberships_site_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "np_string_overrides" DROP CONSTRAINT "nx_string_overrides_site_id_locale_key_pk";--> statement-breakpoint
ALTER TABLE "np_member_mutes" ADD CONSTRAINT "np_member_mutes_member_id_target_id_site_id_pk" PRIMARY KEY("member_id","target_id","site_id");--> statement-breakpoint
ALTER TABLE "np_plugin_storage" ADD CONSTRAINT "np_plugin_storage_plugin_id_site_id_key_pk" PRIMARY KEY("plugin_id","site_id","key");--> statement-breakpoint
ALTER TABLE "np_settings" ADD CONSTRAINT "np_settings_site_id_key_pk" PRIMARY KEY("site_id","key");--> statement-breakpoint
ALTER TABLE "np_site_memberships" ADD CONSTRAINT "np_site_memberships_site_id_user_id_pk" PRIMARY KEY("site_id","user_id");--> statement-breakpoint
ALTER TABLE "np_string_overrides" ADD CONSTRAINT "np_string_overrides_site_id_locale_key_pk" PRIMARY KEY("site_id","locale","key");--> statement-breakpoint
ALTER TABLE "np_audit_events" ADD CONSTRAINT "np_audit_events_actor_user_id_np_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_audit_events" ADD CONSTRAINT "np_audit_events_actor_member_id_np_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."np_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_bans" ADD CONSTRAINT "np_bans_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_bans" ADD CONSTRAINT "np_bans_by_user_id_np_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_bans" ADD CONSTRAINT "np_bans_by_member_id_np_members_id_fk" FOREIGN KEY ("by_member_id") REFERENCES "public"."np_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_comments" ADD CONSTRAINT "np_comments_parent_id_np_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."np_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_comments" ADD CONSTRAINT "np_comments_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_comments" ADD CONSTRAINT "np_comments_hidden_by_user_id_np_users_id_fk" FOREIGN KEY ("hidden_by_user_id") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_comments" ADD CONSTRAINT "np_comments_hidden_by_member_id_np_members_id_fk" FOREIGN KEY ("hidden_by_member_id") REFERENCES "public"."np_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_follows" ADD CONSTRAINT "np_follows_follower_id_np_members_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_media" ADD CONSTRAINT "np_media_folder_id_np_media_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."np_media_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_media" ADD CONSTRAINT "np_media_uploaded_by_np_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_media" ADD CONSTRAINT "np_media_uploaded_by_member_id_np_members_id_fk" FOREIGN KEY ("uploaded_by_member_id") REFERENCES "public"."np_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_media_folders" ADD CONSTRAINT "np_media_folders_parent_id_np_media_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."np_media_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_media_refs" ADD CONSTRAINT "np_media_refs_media_id_np_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."np_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_member_identities" ADD CONSTRAINT "np_member_identities_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_member_mutes" ADD CONSTRAINT "np_member_mutes_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_member_mutes" ADD CONSTRAINT "np_member_mutes_target_id_np_members_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_member_roles" ADD CONSTRAINT "np_member_roles_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_member_roles" ADD CONSTRAINT "np_member_roles_granted_by_np_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_member_sessions" ADD CONSTRAINT "np_member_sessions_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_members" ADD CONSTRAINT "np_members_avatar_np_media_id_fk" FOREIGN KEY ("avatar") REFERENCES "public"."np_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_navigation" ADD CONSTRAINT "np_navigation_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_notifications" ADD CONSTRAINT "np_notifications_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_reactions" ADD CONSTRAINT "np_reactions_member_id_np_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_reports" ADD CONSTRAINT "np_reports_reporter_id_np_members_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."np_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_reports" ADD CONSTRAINT "np_reports_resolved_by_user_id_np_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_reports" ADD CONSTRAINT "np_reports_resolved_by_member_id_np_members_id_fk" FOREIGN KEY ("resolved_by_member_id") REFERENCES "public"."np_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_revisions" ADD CONSTRAINT "np_revisions_author_id_np_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_sessions" ADD CONSTRAINT "np_sessions_user_id_np_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."np_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_settings" ADD CONSTRAINT "np_settings_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_site_memberships" ADD CONSTRAINT "np_site_memberships_user_id_np_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."np_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_string_overrides" ADD CONSTRAINT "np_string_overrides_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_user_oauth_identities" ADD CONSTRAINT "np_user_oauth_identities_user_id_np_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."np_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_users" ADD CONSTRAINT "np_users_avatar_np_media_id_fk" FOREIGN KEY ("avatar") REFERENCES "public"."np_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_discussions" ADD CONSTRAINT "np_c_discussions_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_discussions" ADD CONSTRAINT "np_c_discussions_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_discussions" ADD CONSTRAINT "np_c_discussions_member_author_id_np_members_id_fk" FOREIGN KEY ("member_author_id") REFERENCES "public"."np_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_localized-pages" ADD CONSTRAINT "np_c_localized-pages_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_localized-pages" ADD CONSTRAINT "np_c_localized-pages_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_pages" ADD CONSTRAINT "np_c_pages_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_pages" ADD CONSTRAINT "np_c_pages_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts__categories" ADD CONSTRAINT "np_c_posts__categories_posts_id_np_c_posts_id_fk" FOREIGN KEY ("posts_id") REFERENCES "public"."np_c_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts__categories" ADD CONSTRAINT "np_c_posts__categories_target_id_np_c_taxonomies_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."np_c_taxonomies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD CONSTRAINT "np_c_posts_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD CONSTRAINT "np_c_posts_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD CONSTRAINT "np_c_posts_cover_image_np_media_id_fk" FOREIGN KEY ("cover_image") REFERENCES "public"."np_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts" ADD CONSTRAINT "np_c_posts_author_np_users_id_fk" FOREIGN KEY ("author") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts__tags" ADD CONSTRAINT "np_c_posts__tags_posts_id_np_c_posts_id_fk" FOREIGN KEY ("posts_id") REFERENCES "public"."np_c_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_posts__tags" ADD CONSTRAINT "np_c_posts__tags_target_id_np_c_taxonomies_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."np_c_taxonomies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_taxonomies" ADD CONSTRAINT "np_c_taxonomies_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_c_taxonomies" ADD CONSTRAINT "np_c_taxonomies_updated_by_np_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."np_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_audit_target_idx" ON "np_audit_events" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "np_audit_actor_user_idx" ON "np_audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "np_audit_actor_member_idx" ON "np_audit_events" USING btree ("actor_member_id","created_at");--> statement-breakpoint
CREATE INDEX "np_audit_site_idx" ON "np_audit_events" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "np_bans_member_scope_idx" ON "np_bans" USING btree ("member_id","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "np_bans_active_idx" ON "np_bans" USING btree ("member_id","expires_at");--> statement-breakpoint
CREATE INDEX "np_bans_site_idx" ON "np_bans" USING btree ("site_id","member_id");--> statement-breakpoint
CREATE INDEX "np_comments_target_idx" ON "np_comments" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "np_comments_member_idx" ON "np_comments" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "np_comments_site_idx" ON "np_comments" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "np_follows_target_idx" ON "np_follows" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "np_follows_site_idx" ON "np_follows" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_job_logs_job_idx" ON "np_job_logs" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "np_job_logs_created_idx" ON "np_job_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "np_media_hash_idx" ON "np_media" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "np_media_status_idx" ON "np_media" USING btree ("status");--> statement-breakpoint
CREATE INDEX "np_media_uploaded_by_member_idx" ON "np_media" USING btree ("uploaded_by_member_id");--> statement-breakpoint
CREATE INDEX "np_media_refs_media_id_idx" ON "np_media_refs" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "np_media_refs_document_id_idx" ON "np_media_refs" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "np_member_identities_member_idx" ON "np_member_identities" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "np_member_mutes_target_idx" ON "np_member_mutes" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "np_member_roles_member_idx" ON "np_member_roles" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "np_member_roles_scope_idx" ON "np_member_roles" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "np_member_roles_site_idx" ON "np_member_roles" USING btree ("site_id","member_id");--> statement-breakpoint
CREATE INDEX "np_members_status_idx" ON "np_members" USING btree ("status");--> statement-breakpoint
CREATE INDEX "np_notifications_inbox_idx" ON "np_notifications" USING btree ("member_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "np_notifications_site_inbox_idx" ON "np_notifications" USING btree ("site_id","member_id","read_at");--> statement-breakpoint
CREATE INDEX "np_plugin_storage_plugin_id_idx" ON "np_plugin_storage" USING btree ("plugin_id");--> statement-breakpoint
CREATE INDEX "np_plugin_storage_site_idx" ON "np_plugin_storage" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_reactions_target_idx" ON "np_reactions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "np_reactions_site_idx" ON "np_reactions" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_reports_queue_idx" ON "np_reports" USING btree ("resolved_at","created_at");--> statement-breakpoint
CREATE INDEX "np_reports_target_idx" ON "np_reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "np_reports_site_queue_idx" ON "np_reports" USING btree ("site_id","resolved_at");--> statement-breakpoint
CREATE INDEX "np_revisions_collection_idx" ON "np_revisions" USING btree ("collection");--> statement-breakpoint
CREATE INDEX "np_revisions_document_id_idx" ON "np_revisions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "np_slug_history_lookup_idx" ON "np_slug_history" USING btree ("site_id","collection","old_slug");--> statement-breakpoint
CREATE INDEX "np_slug_history_doc_idx" ON "np_slug_history" USING btree ("site_id","collection","document_id");--> statement-breakpoint
CREATE INDEX "np_user_oauth_identities_user_idx" ON "np_user_oauth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "np_c_discussions_status_idx" ON "np_c_discussions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "np_c_discussions_member_author_idx" ON "np_c_discussions" USING btree ("member_author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_discussions_site_slug_idx" ON "np_c_discussions" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "np_c_discussions_site_idx" ON "np_c_discussions" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_c_localized-pages_status_idx" ON "np_c_localized-pages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_localized-pages_site_locale_slug_idx" ON "np_c_localized-pages" USING btree ("site_id","locale","slug");--> statement-breakpoint
CREATE INDEX "np_c_localized-pages_translation_group_idx" ON "np_c_localized-pages" USING btree ("translation_group_id");--> statement-breakpoint
CREATE INDEX "np_c_localized-pages_locale_idx" ON "np_c_localized-pages" USING btree ("locale");--> statement-breakpoint
CREATE INDEX "np_c_localized-pages_site_idx" ON "np_c_localized-pages" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_c_pages_status_idx" ON "np_c_pages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_pages_site_slug_idx" ON "np_c_pages" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "np_c_pages_site_idx" ON "np_c_pages" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_c_posts__categories_posts_id_idx" ON "np_c_posts__categories" USING btree ("posts_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_posts__categories_parent_target_uidx" ON "np_c_posts__categories" USING btree ("posts_id","target_id");--> statement-breakpoint
CREATE INDEX "np_c_posts_status_idx" ON "np_c_posts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_posts_site_slug_idx" ON "np_c_posts" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "np_c_posts_site_idx" ON "np_c_posts" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "np_c_posts__tags_posts_id_idx" ON "np_c_posts__tags" USING btree ("posts_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_posts__tags_parent_target_uidx" ON "np_c_posts__tags" USING btree ("posts_id","target_id");--> statement-breakpoint
CREATE INDEX "np_c_taxonomies_status_idx" ON "np_c_taxonomies" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "np_c_taxonomies_site_slug_idx" ON "np_c_taxonomies" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "np_c_taxonomies_site_idx" ON "np_c_taxonomies" USING btree ("site_id");--> statement-breakpoint
ALTER TABLE "np_follows" ADD CONSTRAINT "np_follows_unique" UNIQUE("follower_id","target_type","target_id","site_id");--> statement-breakpoint
ALTER TABLE "np_member_identities" ADD CONSTRAINT "np_member_identities_provider_subject_uq" UNIQUE("provider","subject");--> statement-breakpoint
ALTER TABLE "np_member_identities" ADD CONSTRAINT "np_member_identities_member_provider_uq" UNIQUE("member_id","provider");--> statement-breakpoint
ALTER TABLE "np_member_roles" ADD CONSTRAINT "np_member_roles_grant_uq" UNIQUE NULLS NOT DISTINCT("member_id","role","scope_type","scope_id","site_id");--> statement-breakpoint
ALTER TABLE "np_members" ADD CONSTRAINT "np_members_handle_unique" UNIQUE("handle");--> statement-breakpoint
ALTER TABLE "np_members" ADD CONSTRAINT "np_members_email_unique" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "np_navigation" ADD CONSTRAINT "np_navigation_site_location_idx" UNIQUE("site_id","location");--> statement-breakpoint
ALTER TABLE "np_reactions" ADD CONSTRAINT "np_reactions_unique" UNIQUE("target_type","target_id","member_id","kind");--> statement-breakpoint
ALTER TABLE "np_revisions" ADD CONSTRAINT "np_revisions_document_id_version_unique" UNIQUE("document_id","version");--> statement-breakpoint
ALTER TABLE "np_sites" ADD CONSTRAINT "np_sites_hostname_idx" UNIQUE("hostname");--> statement-breakpoint
ALTER TABLE "np_user_oauth_identities" ADD CONSTRAINT "np_user_oauth_identities_provider_subject_unique" UNIQUE("provider","provider_user_id");--> statement-breakpoint
ALTER TABLE "np_user_oauth_identities" ADD CONSTRAINT "np_user_oauth_identities_user_provider_unique" UNIQUE("user_id","provider");--> statement-breakpoint
ALTER TABLE "np_users" ADD CONSTRAINT "np_users_email_unique" UNIQUE("email");