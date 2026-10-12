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
	"metadata_revision" integer DEFAULT 1 NOT NULL,
	"deleted_batch" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_kind" CHECK ("files"."kind" in ('doc','sheet','slide','folder')),
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
CREATE INDEX "file_visits_user_time_idx" ON "file_visits" USING btree ("user_id","visited_at");--> statement-breakpoint
CREATE INDEX "files_tree_idx" ON "files" USING btree ("space_id","parent_id","deleted_at","position");--> statement-breakpoint
CREATE INDEX "files_deleted_batch_idx" ON "files" USING btree ("space_id","deleted_batch");--> statement-breakpoint
CREATE UNIQUE INDEX "document_updates_revision_idx" ON "document_updates" USING btree ("file_id","epoch","revision");--> statement-breakpoint
CREATE INDEX "file_versions_file_idx" ON "file_versions" USING btree ("file_id","created_at");
--> statement-breakpoint
COMMENT ON TABLE files IS '空间文件树元数据';
COMMENT ON COLUMN files.space_id IS '所属空间';
COMMENT ON COLUMN files.kind IS '文档、表格、幻灯片或文件夹';
COMMENT ON COLUMN files.name IS '文件标题';
COMMENT ON COLUMN files.parent_id IS '父文件夹或父文档，根目录为空';
COMMENT ON COLUMN files.position IS '同级节点排序位置';
COMMENT ON COLUMN files.created_by IS '创建账号，仅展示不授予额外权限';
COMMENT ON COLUMN files.visibility IS '公开或私有可见性';
COMMENT ON COLUMN files.metadata_revision IS '元数据乐观并发修订号';
COMMENT ON COLUMN files.deleted_batch IS '父子文件软删除批次';
COMMENT ON COLUMN files.deleted_at IS '移入回收站时间';
COMMENT ON TABLE file_favorites IS '账号独立的文件收藏';
COMMENT ON COLUMN file_favorites.user_id IS '收藏账号';
COMMENT ON COLUMN file_favorites.file_id IS '收藏文件';
COMMENT ON TABLE file_visits IS '账号独立的最近访问';
COMMENT ON COLUMN file_visits.user_id IS '访问账号';
COMMENT ON COLUMN file_visits.file_id IS '访问文件';
COMMENT ON COLUMN file_visits.visited_at IS '最后访问时间';
COMMENT ON TABLE file_contents IS '协作引擎权威状态与同修订读取投影';
COMMENT ON COLUMN file_contents.file_id IS '所属文件';
COMMENT ON COLUMN file_contents.engine IS '权威内容引擎类型';
COMMENT ON COLUMN file_contents.schema_version IS '内容结构版本';
COMMENT ON COLUMN file_contents.revision IS '已持久化内容修订号';
COMMENT ON COLUMN file_contents.epoch IS '整体恢复或替换后的内容世代';
COMMENT ON COLUMN file_contents.projection IS '权威状态生成的读取投影';
COMMENT ON COLUMN file_contents.projection_revision IS '读取投影对应的持久化修订号';
COMMENT ON COLUMN file_contents.document_state IS 'Yjs 完整可恢复检查点';
COMMENT ON COLUMN file_contents.engine_state IS '表格引擎协作恢复状态';
COMMENT ON TABLE document_updates IS 'Yjs 已持久化更新日志';
COMMENT ON COLUMN document_updates.file_id IS '所属文档';
COMMENT ON COLUMN document_updates.epoch IS '更新所属内容世代';
COMMENT ON COLUMN document_updates.revision IS '更新持久化序号';
COMMENT ON COLUMN document_updates.update IS 'Yjs 二进制更新';
COMMENT ON TABLE file_versions IS '不可变的完整历史检查点';
COMMENT ON COLUMN file_versions.file_id IS '所属文件';
COMMENT ON COLUMN file_versions.revision IS '内容持久化修订号';
COMMENT ON COLUMN file_versions.epoch IS '内容世代';
COMMENT ON COLUMN file_versions.source IS '初始、自动、手动、AI、导入或恢复来源';
COMMENT ON COLUMN file_versions.actor_id IS '操作账号，AI 来源可为空';
COMMENT ON COLUMN file_versions.note IS '手动版本备注';
COMMENT ON COLUMN file_versions.projection IS '隔离预览使用的读取快照';
COMMENT ON COLUMN file_versions.document_state IS '文档完整恢复数据';
COMMENT ON COLUMN file_versions.engine_state IS '表格完整恢复数据';
