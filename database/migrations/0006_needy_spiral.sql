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
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_ai_policies" ADD CONSTRAINT "space_ai_policies_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_space_idx" ON "api_keys" USING btree ("space_id","created_by");
--> statement-breakpoint
COMMENT ON TABLE "ai_requests" IS 'AI写命令成功结果与请求幂等记录';
--> statement-breakpoint
COMMENT ON COLUMN "ai_requests"."key_id" IS '请求所属密钥';
--> statement-breakpoint
COMMENT ON COLUMN "ai_requests"."request_id" IS '客户端幂等键';
--> statement-breakpoint
COMMENT ON COLUMN "ai_requests"."fingerprint" IS '规范请求内容哈希';
--> statement-breakpoint
COMMENT ON COLUMN "ai_requests"."result" IS '已提交操作结果';
--> statement-breakpoint
COMMENT ON TABLE "api_keys" IS '空间限定API密钥，只保存哈希';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."space_id" IS '绑定空间';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."created_by" IS '签发账号';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."name" IS '显示名称';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."prefix" IS '可展示的密钥前缀';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."token_hash" IS '高熵密钥SHA256哈希';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."permissions" IS '签发时显式权限集合';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."expires_at" IS '到期时间，空值表示长期有效';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."revoked_at" IS '撤销时间';
--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."last_used_at" IS '最后成功调用时间';
--> statement-breakpoint
COMMENT ON TABLE "space_ai_policies" IS '空间AI实时授权策略';
--> statement-breakpoint
COMMENT ON COLUMN "space_ai_policies"."space_id" IS '空间标识';
--> statement-breakpoint
COMMENT ON COLUMN "space_ai_policies"."enabled" IS '外部AI总开关，默认关闭';
--> statement-breakpoint
COMMENT ON COLUMN "space_ai_policies"."permissions" IS '空间允许操作集合，默认只读';
