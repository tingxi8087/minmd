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
-- 保留升级前空间成员均可编辑的行为；后续新文件默认只读。
ALTER TABLE "files" ADD COLUMN "member_permission" varchar(16) DEFAULT 'read' NOT NULL;--> statement-breakpoint
UPDATE "files" SET "member_permission" = 'edit';--> statement-breakpoint
ALTER TABLE "file_shares" ADD COLUMN "audience" varchar(20) DEFAULT 'anyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "file_shares" ADD COLUMN "permission" varchar(16) DEFAULT 'read' NOT NULL;--> statement-breakpoint
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
CREATE INDEX "app_notifications_user_idx" ON "app_notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "file_access_grants_user_idx" ON "file_access_grants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_access_requests_file_user_idx" ON "file_access_requests" USING btree ("file_id","user_id");--> statement-breakpoint
CREATE INDEX "file_access_requests_status_idx" ON "file_access_requests" USING btree ("file_id","status");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_member_permission" CHECK ("files"."member_permission" in ('read','edit'));
--> statement-breakpoint
COMMENT ON TABLE "file_access_grants" IS '指定用户的单文件只读或编辑授权，不授予空间资格';
--> statement-breakpoint
COMMENT ON TABLE "file_access_requests" IS '文件访问和编辑申请及审批结果';
--> statement-breakpoint
COMMENT ON TABLE "share_user_sessions" IS '登录用户验证公开分享链接后的短期授权';
--> statement-breakpoint
COMMENT ON TABLE "app_notifications" IS '按接收账号隔离的站内通知';
--> statement-breakpoint
COMMENT ON COLUMN "files"."member_permission" IS '空间成员默认访问权限，指定授权优先';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."audience" IS '公开链接访问范围：登录用户或所有人';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."permission" IS '已登录用户通过公开链接获得的权限；匿名始终只读';
--> statement-breakpoint
COMMENT ON COLUMN "file_access_grants"."permission" IS '指定账号的只读或编辑权限';
--> statement-breakpoint
COMMENT ON COLUMN "file_access_requests"."status" IS '申请状态：待处理、批准、拒绝或取消';
--> statement-breakpoint
COMMENT ON COLUMN "file_access_requests"."reason" IS '申请人填写的说明';
--> statement-breakpoint
COMMENT ON COLUMN "app_notifications"."message" IS '授权申请和审批的站内通知内容';
