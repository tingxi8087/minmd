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
ALTER TABLE "demo_imports" ADD CONSTRAINT "demo_imports_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_imports" ADD CONSTRAINT "demo_imports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_imports_identity_key_idx" ON "demo_imports" USING btree ("user_id","space_id","idempotency_key");
--> statement-breakpoint
COMMENT ON TABLE "demo_imports" IS '本地演示导入任务映射与逐文件结果';
--> statement-breakpoint
COMMENT ON COLUMN "demo_imports"."user_id" IS '发起账号，不能跨账号读取任务';
--> statement-breakpoint
COMMENT ON COLUMN "demo_imports"."space_id" IS '目标空间';
--> statement-breakpoint
COMMENT ON COLUMN "demo_imports"."idempotency_key" IS '目标账号空间内幂等任务键';
--> statement-breakpoint
COMMENT ON COLUMN "demo_imports"."manifest_hash" IS '元数据清单内容哈希，成功项不覆盖';
--> statement-breakpoint
COMMENT ON COLUMN "demo_imports"."mapping" IS '旧ID到新UUID映射';
--> statement-breakpoint
COMMENT ON COLUMN "demo_imports"."results" IS '每个文件成功或失败结果，不保存本地凭证正文';
