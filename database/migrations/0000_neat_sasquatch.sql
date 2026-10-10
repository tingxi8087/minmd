CREATE TABLE "examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(500) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sys_roles_code_unique" UNIQUE("code"),
	CONSTRAINT "sys_roles_name_unique" UNIQUE("name")
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
ALTER TABLE "sys_admin_roles" ADD CONSTRAINT "sys_admin_roles_admin_id_sys_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."sys_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_admin_roles" ADD CONSTRAINT "sys_admin_roles_role_id_sys_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."sys_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_role_permissions" ADD CONSTRAINT "sys_role_permissions_role_id_sys_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."sys_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sys_sessions" ADD CONSTRAINT "sys_sessions_admin_id_sys_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."sys_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sys_admin_roles_role_idx" ON "sys_admin_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "sys_audit_created_idx" ON "sys_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sys_audit_request_idx" ON "sys_audit_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "sys_audit_actor_idx" ON "sys_audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "sys_runtime_created_idx" ON "sys_runtime_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sys_runtime_request_idx" ON "sys_runtime_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "sys_runtime_level_idx" ON "sys_runtime_logs" USING btree ("level","created_at");--> statement-breakpoint
CREATE INDEX "sys_sessions_admin_idx" ON "sys_sessions" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "sys_sessions_expiry_idx" ON "sys_sessions" USING btree ("expires_at");