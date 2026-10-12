CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"storage_key" varchar(80) NOT NULL,
	"filename" varchar(200) NOT NULL,
	"mime" varchar(120) NOT NULL,
	"size" bigint NOT NULL,
	"checksum" varchar(64) NOT NULL,
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
ALTER TABLE "assets" ADD CONSTRAINT "assets_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_app_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_assets" ADD CONSTRAINT "version_assets_version_id_file_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_assets" ADD CONSTRAINT "version_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_unbound_idx" ON "assets" USING btree ("created_at");
--> statement-breakpoint
COMMENT ON TABLE assets IS '空间私有原文件元数据';
COMMENT ON COLUMN assets.space_id IS '所属空间';
COMMENT ON COLUMN assets.storage_key IS '服务端生成的私有存储键';
COMMENT ON COLUMN assets.filename IS '下载展示原文件名，不作为磁盘路径';
COMMENT ON COLUMN assets.mime IS '实际检测的MIME类型';
COMMENT ON COLUMN assets.size IS '原文件字节数';
COMMENT ON COLUMN assets.checksum IS 'SHA256校验和';
COMMENT ON COLUMN assets.uploaded_by IS '上传账号';
COMMENT ON TABLE file_assets IS '当前内容附件引用和访客授权边界';
COMMENT ON COLUMN file_assets.file_id IS '引用文件';
COMMENT ON COLUMN file_assets.asset_id IS '引用附件';
COMMENT ON TABLE version_assets IS '历史版本永久保留的附件引用';
COMMENT ON COLUMN version_assets.version_id IS '历史版本';
COMMENT ON COLUMN version_assets.asset_id IS '历史附件';
