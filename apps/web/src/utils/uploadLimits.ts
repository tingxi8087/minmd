export { UPLOAD_MAX_BYTES } from "../../../../config/uploads";
import { UPLOAD_MAX_BYTES } from "../../../../config/uploads";
export function assertUploadSize(file: Pick<File, "size">) {
  if (!file.size || file.size > UPLOAD_MAX_BYTES)
    throw new Error("文件不能为空，且不能超过 200 MB");
}
