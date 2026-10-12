CREATE TABLE "file_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
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
ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_guest_sessions" ADD CONSTRAINT "share_guest_sessions_share_id_file_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."file_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_guest_sessions_share_idx" ON "share_guest_sessions" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "share_guest_sessions_expiry_idx" ON "share_guest_sessions" USING btree ("expires_at");
--> statement-breakpoint
COMMENT ON TABLE "file_shares" IS '单文件分享设置与凭证哈希';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."file_id" IS '公开目标文件，不继承目录';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."token_hash" IS '分享链接高熵Token哈希';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."generation" IS '授权世代，修改密码或链接递增';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."password_hash" IS '分享密码哈希，空值无需密码';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."expires_at" IS '分享有效期';
--> statement-breakpoint
COMMENT ON COLUMN "file_shares"."revoked_at" IS '撤销时间';
--> statement-breakpoint
COMMENT ON TABLE "share_guest_sessions" IS '分享访客短期授权，独立于成员身份';
--> statement-breakpoint
COMMENT ON COLUMN "share_guest_sessions"."share_id" IS '所属分享';
--> statement-breakpoint
COMMENT ON COLUMN "share_guest_sessions"."generation" IS '签发时分享世代';
--> statement-breakpoint
COMMENT ON COLUMN "share_guest_sessions"."token_hash" IS '访客会话令牌哈希';
--> statement-breakpoint
COMMENT ON COLUMN "share_guest_sessions"."expires_at" IS '有效期，不超过分享有效期';
