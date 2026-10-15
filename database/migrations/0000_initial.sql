-- 当前完整结构的初始化基线；已完成旧迁移的数据库通过保留的末次迁移时间跳过本文件。
CREATE TABLE "sys_admin_roles" (
	"admin_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "sys_admin_roles_admin_id_role_id_pk" PRIMARY KEY("admin_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "sys_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account" varchar(64) NOT NULL,
	"display_name" varchar(64) NOT NULL,
	"password_hash" text NOT NULL,
	"status" varchar(16) DEFAULT 'enabled' NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sys_admins_account_unique" UNIQUE("account"),
	CONSTRAINT "sys_admin_status" CHECK ("sys_admins"."status" in ('enabled', 'disabled')),
	CONSTRAINT "sys_admin_account_lower" CHECK ("sys_admins"."account" = lower("sys_admins"."account"))
);
--> statement-breakpoint
CREATE TABLE "sys_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_account" varchar(64),
	"action" varchar(100) NOT NULL,
	"target_type" varchar(64) NOT NULL,
	"target_id" varchar(100),
	"result" varchar(16) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"request_id" varchar(100),
	"environment" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sys_role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_code" varchar(100) NOT NULL,
	CONSTRAINT "sys_role_permissions_role_id_permission_code_pk" PRIMARY KEY("role_id","permission_code")
);
--> statement-breakpoint
CREATE TABLE "sys_roles" (
	"scope" varchar(16) DEFAULT 'admin' NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(500) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sys_roles_code_unique" UNIQUE("code"),
	CONSTRAINT "sys_roles_name_unique" UNIQUE("name"),
	CONSTRAINT "sys_role_scope" CHECK ("sys_roles"."scope" in ('admin', 'app'))
);
--> statement-breakpoint
CREATE TABLE "sys_runtime_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" varchar(16) NOT NULL,
	"message" text NOT NULL,
	"request_id" varchar(100) NOT NULL,
	"method" varchar(16) NOT NULL,
	"path" varchar(500) NOT NULL,
	"status_code" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"environment" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sys_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"transport" varchar(16) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sys_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sys_session_transport" CHECK ("sys_sessions"."transport" in ('bearer', 'cookie'))
);
--> statement-breakpoint
CREATE TABLE "app_installation" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"initialized_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_installation_singleton" CHECK ("app_installation"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "app_user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "app_user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "app_user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"transport" varchar(16) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "app_session_transport" CHECK ("app_user_sessions"."transport" in ('bearer', 'cookie'))
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account" varchar(64) NOT NULL,
	"password_hash" text NOT NULL,
	"nickname" varchar(64) DEFAULT '' NOT NULL,
	"avatar" varchar(1000) DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'enabled' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_account_unique" UNIQUE("account"),
	CONSTRAINT "app_user_status" CHECK ("app_users"."status" in ('enabled', 'disabled')),
	CONSTRAINT "app_user_account_lower" CHECK ("app_users"."account" = lower("app_users"."account")),
	CONSTRAINT "app_user_metadata_object" CHECK (jsonb_typeof("app_users"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "space_members" (
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_members_space_id_user_id_pk" PRIMARY KEY("space_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_favorites" (
	"user_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_favorites_user_id_file_id_pk" PRIMARY KEY("user_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "file_visits" (
	"user_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_visits_user_id_file_id_pk" PRIMARY KEY("user_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"name" varchar(200) NOT NULL,
	"parent_id" uuid,
	"position" double precision DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"visibility" varchar(16) DEFAULT 'private' NOT NULL,
	"member_permission" varchar(16) DEFAULT 'read' NOT NULL,
	"metadata_revision" integer DEFAULT 1 NOT NULL,
	"deleted_batch" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_member_permission" CHECK ("files"."member_permission" in ('read','edit')),
	CONSTRAINT "files_kind" CHECK ("files"."kind" in ('doc','sheet','slide','folder','pdf','video','image')),
	CONSTRAINT "files_visibility" CHECK ("files"."visibility" in ('public','private'))
);
--> statement-breakpoint
CREATE TABLE "document_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"epoch" integer NOT NULL,
	"revision" integer NOT NULL,
	"update" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_contents" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"engine" varchar(20) NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"epoch" integer DEFAULT 1 NOT NULL,
	"projection" jsonb NOT NULL,
	"projection_revision" integer DEFAULT 1 NOT NULL,
	"document_state" "bytea",
	"engine_state" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"epoch" integer NOT NULL,
	"source" varchar(20) NOT NULL,
	"actor_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"projection" jsonb NOT NULL,
	"document_state" "bytea",
	"engine_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"storage_key" varchar(80) NOT NULL,
	"filename" varchar(200) NOT NULL,
	"mime" varchar(120) NOT NULL,
	"size" bigint NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"uploaded_for_file_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "file_assets" (
	"file_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "file_assets_file_id_asset_id_pk" PRIMARY KEY("file_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "version_assets" (
	"version_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "version_assets_version_id_asset_id_pk" PRIMARY KEY("version_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"key_id" uuid NOT NULL,
	"request_id" varchar(100) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_requests_key_id_request_id_pk" PRIMARY KEY("key_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"prefix" varchar(20) NOT NULL,
	"encrypted_secret" varchar(512),
	"token_hash" varchar(64) NOT NULL,
	"permissions" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "space_ai_policies" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"permissions" jsonb DEFAULT '["read"]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"audience" varchar(20) DEFAULT 'anyone' NOT NULL,
	"permission" varchar(16) DEFAULT 'read' NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"password_hash" varchar(300),
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_shares_file_id_unique" UNIQUE("file_id"),
	CONSTRAINT "file_shares_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "share_guest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_guest_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "demo_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"manifest_hash" varchar(64) NOT NULL,
	"mapping" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"file_id" uuid,
	"message" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_access_grants" (
	"file_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission" varchar(16) NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_access_grants_file_id_user_id_pk" PRIMARY KEY("file_id","user_id"),
	CONSTRAINT "file_access_grants_permission" CHECK ("file_access_grants"."permission" in ('read','edit'))
);
--> statement-breakpoint
CREATE TABLE "file_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission" varchar(16) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_access_requests_permission" CHECK ("file_access_requests"."permission" in ('read','edit')),
	CONSTRAINT "file_access_requests_status" CHECK ("file_access_requests"."status" in ('pending','approved','rejected','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "share_user_sessions" (
	"share_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "share_user_sessions_share_id_user_id_pk" PRIMARY KEY("share_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "sys_admin_roles" ADD CONSTRAINT "sys_admin_roles_admin_id_sys_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."sys_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_admin_roles" ADD CONSTRAINT "sys_admin_roles_role_id_sys_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."sys_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_role_permissions" ADD CONSTRAINT "sys_role_permissions_role_id_sys_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."sys_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_sessions" ADD CONSTRAINT "sys_sessions_admin_id_sys_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."sys_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_roles" ADD CONSTRAINT "app_user_roles_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_roles" ADD CONSTRAINT "app_user_roles_role_id_sys_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."sys_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_sessions" ADD CONSTRAINT "app_user_sessions_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_favorites" ADD CONSTRAINT "file_favorites_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_favorites" ADD CONSTRAINT "file_favorites_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_visits" ADD CONSTRAINT "file_visits_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_visits" ADD CONSTRAINT "file_visits_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_parent_id_files_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_updates" ADD CONSTRAINT "document_updates_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_contents" ADD CONSTRAINT "file_contents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_actor_id_app_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_for_file_id_files_id_fk" FOREIGN KEY ("uploaded_for_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_app_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_assets" ADD CONSTRAINT "version_assets_version_id_file_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_assets" ADD CONSTRAINT "version_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_ai_policies" ADD CONSTRAINT "space_ai_policies_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_guest_sessions" ADD CONSTRAINT "share_guest_sessions_share_id_file_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."file_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_imports" ADD CONSTRAINT "demo_imports_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_imports" ADD CONSTRAINT "demo_imports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_notifications" ADD CONSTRAINT "app_notifications_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_notifications" ADD CONSTRAINT "app_notifications_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_access_grants" ADD CONSTRAINT "file_access_grants_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_access_grants" ADD CONSTRAINT "file_access_grants_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_access_grants" ADD CONSTRAINT "file_access_grants_granted_by_app_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_access_requests" ADD CONSTRAINT "file_access_requests_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_access_requests" ADD CONSTRAINT "file_access_requests_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_access_requests" ADD CONSTRAINT "file_access_requests_decided_by_app_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_user_sessions" ADD CONSTRAINT "share_user_sessions_share_id_file_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."file_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_user_sessions" ADD CONSTRAINT "share_user_sessions_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sys_admin_roles_role_idx" ON "sys_admin_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "sys_audit_created_idx" ON "sys_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sys_audit_request_idx" ON "sys_audit_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "sys_audit_actor_idx" ON "sys_audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "sys_runtime_created_idx" ON "sys_runtime_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sys_runtime_request_idx" ON "sys_runtime_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "sys_runtime_level_idx" ON "sys_runtime_logs" USING btree ("level","created_at");--> statement-breakpoint
CREATE INDEX "sys_sessions_admin_idx" ON "sys_sessions" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "sys_sessions_expiry_idx" ON "sys_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "app_user_roles_role_idx" ON "app_user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "app_user_sessions_user_idx" ON "app_user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "app_user_sessions_expiry_idx" ON "app_user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "space_members_user_idx" ON "space_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "file_visits_user_time_idx" ON "file_visits" USING btree ("user_id","visited_at");--> statement-breakpoint
CREATE INDEX "files_tree_idx" ON "files" USING btree ("space_id","parent_id","deleted_at","position");--> statement-breakpoint
CREATE INDEX "files_deleted_batch_idx" ON "files" USING btree ("space_id","deleted_batch");--> statement-breakpoint
CREATE UNIQUE INDEX "document_updates_revision_idx" ON "document_updates" USING btree ("file_id","epoch","revision");--> statement-breakpoint
CREATE INDEX "file_versions_file_idx" ON "file_versions" USING btree ("file_id","created_at");--> statement-breakpoint
CREATE INDEX "assets_unbound_idx" ON "assets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_keys_space_idx" ON "api_keys" USING btree ("space_id","created_by");--> statement-breakpoint
CREATE INDEX "share_guest_sessions_share_idx" ON "share_guest_sessions" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "share_guest_sessions_expiry_idx" ON "share_guest_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "demo_imports_identity_key_idx" ON "demo_imports" USING btree ("user_id","space_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "app_notifications_user_idx" ON "app_notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "file_access_grants_user_idx" ON "file_access_grants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_access_requests_file_user_idx" ON "file_access_requests" USING btree ("file_id","user_id");--> statement-breakpoint
CREATE INDEX "file_access_requests_status_idx" ON "file_access_requests" USING btree ("file_id","status");
--> statement-breakpoint
COMMENT ON TABLE "ai_requests" IS 'AI写命令成功结果与请求幂等记录';
--> statement-breakpoint
COMMENT ON TABLE "api_keys" IS '空间限定API密钥，只保存哈希';
--> statement-breakpoint
COMMENT ON TABLE "app_installation" IS '首次初始化完成标记，删除全部前台账号也不会重新开放匿名初始化';
--> statement-breakpoint
COMMENT ON TABLE "app_notifications" IS '按接收账号隔离的站内通知';
--> statement-breakpoint
COMMENT ON TABLE "app_user_roles" IS '前台用户角色关联';
--> statement-breakpoint
COMMENT ON TABLE "app_user_sessions" IS '前台登录会话';
--> statement-breakpoint
COMMENT ON TABLE "app_users" IS '前台用户';
--> statement-breakpoint
COMMENT ON TABLE "assets" IS '空间私有原文件元数据';
--> statement-breakpoint
COMMENT ON TABLE "demo_imports" IS '本地演示导入任务映射与逐文件结果';
--> statement-breakpoint
COMMENT ON TABLE "document_updates" IS 'Yjs 已持久化更新日志';
--> statement-breakpoint
COMMENT ON TABLE "file_access_grants" IS '指定用户的单文件只读或编辑授权，不授予空间资格';
--> statement-breakpoint
COMMENT ON TABLE "file_access_requests" IS '文件访问和编辑申请及审批结果';
--> statement-breakpoint
COMMENT ON TABLE "file_assets" IS '当前内容附件引用和访客授权边界';
--> statement-breakpoint
COMMENT ON TABLE "file_contents" IS '协作引擎权威状态与同修订读取投影';
--> statement-breakpoint
COMMENT ON TABLE "file_favorites" IS '账号独立的文件收藏';
--> statement-breakpoint
COMMENT ON TABLE "file_shares" IS '单文件分享设置与凭证哈希';
--> statement-breakpoint
COMMENT ON TABLE "file_versions" IS '不可变的完整历史检查点';
--> statement-breakpoint
COMMENT ON TABLE "file_visits" IS '账号独立的最近访问';
--> statement-breakpoint
COMMENT ON TABLE "files" IS '空间文件树元数据';
--> statement-breakpoint
COMMENT ON TABLE "share_guest_sessions" IS '分享访客短期授权，独立于成员身份';
--> statement-breakpoint
COMMENT ON TABLE "share_user_sessions" IS '登录用户验证公开分享链接后的短期授权';
--> statement-breakpoint
COMMENT ON TABLE "space_ai_policies" IS '空间AI实时授权策略';
--> statement-breakpoint
COMMENT ON TABLE "space_members" IS '空间成员归属和资源访问授权';
--> statement-breakpoint
COMMENT ON TABLE "spaces" IS '成员共享的文档空间';
--> statement-breakpoint
COMMENT ON TABLE "sys_roles" IS '角色';
--> statement-breakpoint
COMMENT ON TABLE "version_assets" IS '历史版本永久保留的附件引用';
--> statement-breakpoint
COMMENT ON COLUMN "ai_requests"."fingerprint" IS '规范请求内容哈希';
--> statement-breakpoint
COMMENT ON COLUMN "ai_requests"."key_id" IS '请求所属密钥';
--> statement-breakpoint
COMMENT ON COLUMN "ai_requests"."request_id" IS '客户端幂等键';
--> statement-breakpoint
COMMENT ON COLUMN "ai_requests"."result" IS '已提交操作结果';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."created_by" IS '签发账号';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."encrypted_secret" IS 'AES-256-GCM加密密钥原文；旧密钥为空，哈希仍用于认证';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."expires_at" IS '到期时间，空值表示长期有效';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."last_used_at" IS '最后成功调用时间';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."name" IS '显示名称';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."permissions" IS '签发时显式权限集合';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."prefix" IS '可展示的密钥前缀';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."revoked_at" IS '撤销时间';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."space_id" IS '绑定空间';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."token_hash" IS '高熵密钥SHA256哈希';
--> statement-breakpoint
COMMENT ON COLUMN "app_installation"."initialized_at" IS '初始化完成时间';
--> statement-breakpoint
COMMENT ON COLUMN "app_notifications"."message" IS '授权申请和审批的站内通知内容';
--> statement-breakpoint
COMMENT ON COLUMN "app_user_roles"."role_id" IS '前台角色';
--> statement-breakpoint
COMMENT ON COLUMN "app_user_roles"."user_id" IS '前台用户';
--> statement-breakpoint
COMMENT ON COLUMN "app_user_sessions"."expires_at" IS '过期时间';
--> statement-breakpoint
COMMENT ON COLUMN "app_user_sessions"."revoked_at" IS '撤销时间';
--> statement-breakpoint
COMMENT ON COLUMN "app_user_sessions"."token_hash" IS '令牌哈希';
--> statement-breakpoint
COMMENT ON COLUMN "app_user_sessions"."transport" IS '认证传递方式';
--> statement-breakpoint
COMMENT ON COLUMN "app_user_sessions"."user_id" IS '前台用户';
--> statement-breakpoint
COMMENT ON COLUMN "app_users"."account" IS '登录账号';
--> statement-breakpoint
COMMENT ON COLUMN "app_users"."avatar" IS '头像地址';
--> statement-breakpoint
COMMENT ON COLUMN "app_users"."last_login_at" IS '最近登录时间';
--> statement-breakpoint
COMMENT ON COLUMN "app_users"."metadata" IS '额外资料';
--> statement-breakpoint
COMMENT ON COLUMN "app_users"."nickname" IS '昵称';
--> statement-breakpoint
COMMENT ON COLUMN "app_users"."password_hash" IS '密码哈希';
--> statement-breakpoint
COMMENT ON COLUMN "app_users"."status" IS '账号状态';
--> statement-breakpoint
COMMENT ON COLUMN "assets"."checksum" IS 'SHA256校验和';
--> statement-breakpoint
COMMENT ON COLUMN "assets"."filename" IS '下载展示原文件名，不作为磁盘路径';
--> statement-breakpoint
COMMENT ON COLUMN "assets"."mime" IS '实际检测的MIME类型';
--> statement-breakpoint
COMMENT ON COLUMN "assets"."size" IS '原文件字节数';
--> statement-breakpoint
COMMENT ON COLUMN "assets"."space_id" IS '所属空间';
--> statement-breakpoint
COMMENT ON COLUMN "assets"."storage_key" IS '服务端生成的私有存储键';
--> statement-breakpoint
COMMENT ON COLUMN "assets"."uploaded_by" IS '上传账号';
--> statement-breakpoint
COMMENT ON COLUMN "assets"."uploaded_for_file_id" IS '上传时绑定的编辑目标，用于临时附件授权，不授予匿名访问';
--> statement-breakpoint
COMMENT ON COLUMN "demo_imports"."idempotency_key" IS '目标账号空间内幂等任务键';
--> statement-breakpoint
COMMENT ON COLUMN "demo_imports"."manifest_hash" IS '元数据清单内容哈希，成功项不覆盖';
--> statement-breakpoint
COMMENT ON COLUMN "demo_imports"."mapping" IS '旧ID到新UUID映射';
--> statement-breakpoint
COMMENT ON COLUMN "demo_imports"."results" IS '每个文件成功或失败结果，不保存本地凭证正文';
--> statement-breakpoint
COMMENT ON COLUMN "demo_imports"."space_id" IS '目标空间';
--> statement-breakpoint
COMMENT ON COLUMN "demo_imports"."user_id" IS '发起账号，不能跨账号读取任务';
--> statement-breakpoint
COMMENT ON COLUMN "document_updates"."epoch" IS '更新所属内容世代';
--> statement-breakpoint
COMMENT ON COLUMN "document_updates"."file_id" IS '所属文档';
--> statement-breakpoint
COMMENT ON COLUMN "document_updates"."revision" IS '更新持久化序号';
--> statement-breakpoint
COMMENT ON COLUMN "document_updates"."update" IS 'Yjs 二进制更新';
--> statement-breakpoint
COMMENT ON COLUMN "file_access_grants"."permission" IS '指定账号的只读或编辑权限';
--> statement-breakpoint
COMMENT ON COLUMN "file_access_requests"."reason" IS '申请人填写的说明';
--> statement-breakpoint
COMMENT ON COLUMN "file_access_requests"."status" IS '申请状态：待处理、批准、拒绝或取消';
--> statement-breakpoint
COMMENT ON COLUMN "file_assets"."asset_id" IS '引用附件';
--> statement-breakpoint
COMMENT ON COLUMN "file_assets"."file_id" IS '引用文件';
--> statement-breakpoint
COMMENT ON COLUMN "file_contents"."document_state" IS 'Yjs 完整可恢复检查点';
--> statement-breakpoint
COMMENT ON COLUMN "file_contents"."engine" IS '权威内容引擎类型';
--> statement-breakpoint
COMMENT ON COLUMN "file_contents"."engine_state" IS '表格引擎协作恢复状态';
--> statement-breakpoint
COMMENT ON COLUMN "file_contents"."epoch" IS '整体恢复或替换后的内容世代';
--> statement-breakpoint
COMMENT ON COLUMN "file_contents"."file_id" IS '所属文件';
--> statement-breakpoint
COMMENT ON COLUMN "file_contents"."projection" IS '权威状态生成的读取投影';
--> statement-breakpoint
COMMENT ON COLUMN "file_contents"."projection_revision" IS '读取投影对应的持久化修订号';
--> statement-breakpoint
COMMENT ON COLUMN "file_contents"."revision" IS '已持久化内容修订号';
--> statement-breakpoint
COMMENT ON COLUMN "file_contents"."schema_version" IS '内容结构版本';
--> statement-breakpoint
COMMENT ON COLUMN "file_favorites"."file_id" IS '收藏文件';
--> statement-breakpoint
COMMENT ON COLUMN "file_favorites"."user_id" IS '收藏账号';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."audience" IS '公开链接访问范围：登录用户或所有人';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."expires_at" IS '分享有效期';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."file_id" IS '公开目标文件，不继承目录';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."generation" IS '授权世代，修改密码或链接递增';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."password_hash" IS '分享密码哈希，空值无需密码';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."permission" IS '已登录用户通过公开链接获得的权限；匿名始终只读';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."revoked_at" IS '撤销时间';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."token_hash" IS '分享链接高熵Token哈希';
--> statement-breakpoint
COMMENT ON COLUMN "file_versions"."actor_id" IS '操作账号，AI 来源可为空';
--> statement-breakpoint
COMMENT ON COLUMN "file_versions"."document_state" IS '文档完整恢复数据';
--> statement-breakpoint
COMMENT ON COLUMN "file_versions"."engine_state" IS '表格完整恢复数据';
--> statement-breakpoint
COMMENT ON COLUMN "file_versions"."epoch" IS '内容世代';
--> statement-breakpoint
COMMENT ON COLUMN "file_versions"."file_id" IS '所属文件';
--> statement-breakpoint
COMMENT ON COLUMN "file_versions"."note" IS '手动版本备注';
--> statement-breakpoint
COMMENT ON COLUMN "file_versions"."projection" IS '隔离预览使用的读取快照';
--> statement-breakpoint
COMMENT ON COLUMN "file_versions"."revision" IS '内容持久化修订号';
--> statement-breakpoint
COMMENT ON COLUMN "file_versions"."source" IS '初始、自动、手动、AI、导入或恢复来源';
--> statement-breakpoint
COMMENT ON COLUMN "file_visits"."file_id" IS '访问文件';
--> statement-breakpoint
COMMENT ON COLUMN "file_visits"."user_id" IS '访问账号';
--> statement-breakpoint
COMMENT ON COLUMN "file_visits"."visited_at" IS '最后访问时间';
--> statement-breakpoint
COMMENT ON COLUMN "files"."created_by" IS '创建账号，仅展示不授予额外权限';
--> statement-breakpoint
COMMENT ON COLUMN "files"."deleted_at" IS '移入回收站时间';
--> statement-breakpoint
COMMENT ON COLUMN "files"."deleted_batch" IS '父子文件软删除批次';
--> statement-breakpoint
COMMENT ON COLUMN "files"."kind" IS '文档、表格、幻灯片或文件夹';
--> statement-breakpoint
COMMENT ON COLUMN "files"."member_permission" IS '空间成员默认访问权限，指定授权优先';
--> statement-breakpoint
COMMENT ON COLUMN "files"."metadata_revision" IS '元数据乐观并发修订号';
--> statement-breakpoint
COMMENT ON COLUMN "files"."name" IS '文件标题';
--> statement-breakpoint
COMMENT ON COLUMN "files"."parent_id" IS '父文件夹或父文档，根目录为空';
--> statement-breakpoint
COMMENT ON COLUMN "files"."position" IS '同级节点排序位置';
--> statement-breakpoint
COMMENT ON COLUMN "files"."space_id" IS '所属空间';
--> statement-breakpoint
COMMENT ON COLUMN "files"."visibility" IS '公开或私有可见性';
--> statement-breakpoint
COMMENT ON COLUMN "share_guest_sessions"."expires_at" IS '有效期，不超过分享有效期';
--> statement-breakpoint
COMMENT ON COLUMN "share_guest_sessions"."generation" IS '签发时分享世代';
--> statement-breakpoint
COMMENT ON COLUMN "share_guest_sessions"."share_id" IS '所属分享';
--> statement-breakpoint
COMMENT ON COLUMN "share_guest_sessions"."token_hash" IS '访客会话令牌哈希';
--> statement-breakpoint
COMMENT ON COLUMN "space_ai_policies"."enabled" IS '外部AI总开关，默认关闭';
--> statement-breakpoint
COMMENT ON COLUMN "space_ai_policies"."permissions" IS '空间允许操作集合，默认只读';
--> statement-breakpoint
COMMENT ON COLUMN "space_ai_policies"."space_id" IS '空间标识';
--> statement-breakpoint
COMMENT ON COLUMN "space_members"."joined_at" IS '加入时间';
--> statement-breakpoint
COMMENT ON COLUMN "space_members"."space_id" IS '所属空间';
--> statement-breakpoint
COMMENT ON COLUMN "space_members"."user_id" IS '前台账号';
--> statement-breakpoint
COMMENT ON COLUMN "spaces"."description" IS '空间描述';
--> statement-breakpoint
COMMENT ON COLUMN "spaces"."name" IS '空间名称';
--> statement-breakpoint
COMMENT ON COLUMN "spaces"."owner_id" IS '空间负责人，必须同时为成员';
--> statement-breakpoint
COMMENT ON COLUMN "sys_roles"."scope" IS '角色归属';
--> statement-breakpoint
COMMENT ON COLUMN "version_assets"."asset_id" IS '历史附件';
--> statement-breakpoint
COMMENT ON COLUMN "version_assets"."version_id" IS '历史版本';
