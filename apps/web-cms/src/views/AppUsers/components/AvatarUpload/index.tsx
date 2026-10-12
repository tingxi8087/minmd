import { useEffect, useRef, useState } from "react";
import { Avatar, Button, Space, Upload, message } from "antd";
import { UploadOutlined, UserOutlined } from "@ant-design/icons";
import { uploadAppUserAvatar } from "@/http/services/appUsers";
export default function AvatarUpload({
  value,
  onChange,
  disabled,
  onBusyChange,
}: {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const pending = useRef<AbortController>();
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );
  return (
    <Space align="center">
      <Avatar size={56} src={value} icon={<UserOutlined />} />
      {!disabled && (
        <>
          <Upload
            accept="image/png,image/jpeg,image/webp,image/gif"
            showUploadList={false}
            disabled={uploading}
            beforeUpload={async (file) => {
              if (
                ![
                  "image/png",
                  "image/jpeg",
                  "image/webp",
                  "image/gif",
                ].includes(file.type) ||
                file.size > 1024 * 1024
              ) {
                message.error("请选择1MB以内的PNG、JPEG、WebP或GIF图片");
                return Upload.LIST_IGNORE;
              }
              const controller = new AbortController();
              pending.current = controller;
              setUploading(true);
              onBusyChange(true);
              try {
                const result = await uploadAppUserAvatar(
                  file,
                  controller.signal,
                );
                if (!controller.signal.aborted) onChange?.(result.url);
              } catch (error) {
                if (!controller.signal.aborted)
                  message.error(
                    error instanceof Error ? error.message : "头像上传失败",
                  );
              } finally {
                if (!controller.signal.aborted) {
                  setUploading(false);
                  onBusyChange(false);
                }
              }
              return Upload.LIST_IGNORE;
            }}
          >
            <Button icon={<UploadOutlined />} loading={uploading}>
              {value ? "更换头像" : "上传头像"}
            </Button>
          </Upload>
          {value && (
            <Button
              type="text"
              disabled={uploading}
              onClick={() => onChange?.("")}
            >
              移除
            </Button>
          )}
        </>
      )}
    </Space>
  );
}
