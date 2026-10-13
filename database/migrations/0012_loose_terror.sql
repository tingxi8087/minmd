CREATE TABLE "app_installation" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"initialized_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_installation_singleton" CHECK ("app_installation"."id" = 1)
);
--> statement-breakpoint
COMMENT ON TABLE "app_installation" IS '首次初始化完成标记，删除全部前台账号也不会重新开放匿名初始化';
--> statement-breakpoint
COMMENT ON COLUMN "app_installation"."initialized_at" IS '初始化完成时间';
--> statement-breakpoint
INSERT INTO "app_installation" ("id") SELECT 1 WHERE EXISTS (SELECT 1 FROM "app_users") ON CONFLICT DO NOTHING;
