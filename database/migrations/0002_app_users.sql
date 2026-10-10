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
ALTER TABLE "example_book" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "example_book";--> statement-breakpoint
ALTER TABLE "sys_roles" ADD COLUMN "scope" varchar(16) DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_user_roles" ADD CONSTRAINT "app_user_roles_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_roles" ADD CONSTRAINT "app_user_roles_role_id_sys_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."sys_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_sessions" ADD CONSTRAINT "app_user_sessions_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_user_roles_role_idx" ON "app_user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "app_user_sessions_user_idx" ON "app_user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "app_user_sessions_expiry_idx" ON "app_user_sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "sys_roles" ADD CONSTRAINT "sys_role_scope" CHECK ("sys_roles"."scope" in ('admin', 'app'));
--> statement-breakpoint
COMMENT ON TABLE "app_users" IS '前台用户';
--> statement-breakpoint
COMMENT ON COLUMN "app_users"."account" IS '登录账号';
--> statement-breakpoint
COMMENT ON COLUMN "app_users"."password_hash" IS '密码哈希';
--> statement-breakpoint
COMMENT ON COLUMN "app_users"."nickname" IS '昵称';
--> statement-breakpoint
COMMENT ON COLUMN "app_users"."avatar" IS '头像地址';
--> statement-breakpoint
COMMENT ON COLUMN "app_users"."status" IS '账号状态';
--> statement-breakpoint
COMMENT ON COLUMN "app_users"."metadata" IS '额外资料';
--> statement-breakpoint
COMMENT ON COLUMN "app_users"."last_login_at" IS '最近登录时间';
--> statement-breakpoint
COMMENT ON TABLE "app_user_roles" IS '前台用户角色关联';
--> statement-breakpoint
COMMENT ON COLUMN "app_user_roles"."user_id" IS '前台用户';
--> statement-breakpoint
COMMENT ON COLUMN "app_user_roles"."role_id" IS '前台角色';
--> statement-breakpoint
COMMENT ON TABLE "app_user_sessions" IS '前台登录会话';
--> statement-breakpoint
COMMENT ON COLUMN "app_user_sessions"."user_id" IS '前台用户';
--> statement-breakpoint
COMMENT ON COLUMN "app_user_sessions"."token_hash" IS '令牌哈希';
--> statement-breakpoint
COMMENT ON COLUMN "app_user_sessions"."transport" IS '认证传递方式';
--> statement-breakpoint
COMMENT ON COLUMN "app_user_sessions"."expires_at" IS '过期时间';
--> statement-breakpoint
COMMENT ON COLUMN "app_user_sessions"."revoked_at" IS '撤销时间';
--> statement-breakpoint
COMMENT ON TABLE "sys_roles" IS '角色';
--> statement-breakpoint
COMMENT ON COLUMN "sys_roles"."scope" IS '角色归属';
